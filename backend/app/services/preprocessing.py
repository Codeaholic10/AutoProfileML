"""Leakage-free preprocessing: task detection, feature partitioning and pipelines.

Every statistic learned here (imputation values, clipping bounds, encodings)
must be fitted inside a cross-validation fold. Nothing in this module may be
fitted on the full dataset before splitting.
"""

from __future__ import annotations

import warnings

import numpy as np
import polars as pl
from sklearn.base import BaseEstimator, TransformerMixin
from sklearn.compose import ColumnTransformer
from sklearn.impute import KNNImputer, SimpleImputer
from sklearn.model_selection import KFold, StratifiedKFold
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder, StandardScaler, TargetEncoder

from app.models.benchmark import (
    FeaturePartition,
    PreprocessingPlan,
    PreprocessingStep,
    TaskType,
)
from app.models.schemas import ColumnProfile, ProfileReport

RANDOM_SEED = 42
CLASSIFICATION_MAX_UNIQUE = 20
CLASSIFICATION_MAX_RATIO = 0.05
HIGH_CARDINALITY_RATIO = 0.5
HIGH_CARDINALITY_MAX_UNIQUE = 50
KNN_MAX_ROWS = 20_000
MIN_COMPLEX_MISSING_RATE = 0.05
MAX_COMPLEX_MISSING_RATE = 0.50
KNN_NEIGHBORS = 5
TARGET_ENCODER_FOLDS = 5
IQR_K = 1.5


class InvalidTargetError(ValueError):
    """Raised when the chosen target cannot be modelled."""


class NoUsableFeaturesError(ValueError):
    """Raised when no feature columns remain after validation and exclusions."""


def _to_numpy(values: object) -> np.ndarray:
    """Convert a numpy array or Polars frame/series to a numpy array."""

    if isinstance(values, (pl.DataFrame, pl.Series)):
        return values.to_numpy()
    return np.asarray(values)


def _as_float_matrix(values: object) -> np.ndarray:
    return _to_numpy(values).astype(float, copy=False)


class IQRClipper(TransformerMixin, BaseEstimator):
    """Clip each numeric column to bounds learned from the fit fold.

    Missing values are preserved; bounds are computed with nan-aware quantiles
    so NaNs neither shift the bounds nor get filled here.
    """

    def __init__(self, k: float = IQR_K) -> None:
        self.k = k

    def fit(self, X: object, y: object = None) -> IQRClipper:
        values = _as_float_matrix(X)
        with warnings.catch_warnings():
            warnings.simplefilter("ignore", RuntimeWarning)
            q1 = np.nanquantile(values, 0.25, axis=0)
            q3 = np.nanquantile(values, 0.75, axis=0)
        iqr = q3 - q1
        self.lower_ = q1 - self.k * iqr
        self.upper_ = q3 + self.k * iqr
        return self

    def transform(self, X: object) -> np.ndarray:
        values = _as_float_matrix(X).copy()
        for index in range(values.shape[1]):
            lower = float(self.lower_[index])
            upper = float(self.upper_[index])
            if np.isfinite(lower) and np.isfinite(upper):
                values[:, index] = np.clip(values[:, index], lower, upper)
        return values


class AdaptiveNumericImputer(TransformerMixin, BaseEstimator):
    """Choose KNN or median imputation at fit time, per fold.

    KNN imputation exploits inter-column correlation but its cost grows with
    the square of the row count, so it is used only for fit folds up to
    ``knn_max_rows`` whose missing rate falls in the complex-missingness band.
    The chosen strategy is recorded in ``strategy_`` for the preprocessing plan.
    """

    strategy_: str
    imputer_: KNNImputer | SimpleImputer

    def __init__(
        self,
        knn_max_rows: int = KNN_MAX_ROWS,
        min_missing_rate: float = MIN_COMPLEX_MISSING_RATE,
        max_missing_rate: float = MAX_COMPLEX_MISSING_RATE,
        n_neighbors: int = KNN_NEIGHBORS,
    ) -> None:
        self.knn_max_rows = knn_max_rows
        self.min_missing_rate = min_missing_rate
        self.max_missing_rate = max_missing_rate
        self.n_neighbors = n_neighbors

    def fit(self, X: object, y: object = None) -> AdaptiveNumericImputer:
        values = _as_float_matrix(X)
        rows = values.shape[0]
        missing_rate = float(np.isnan(values).mean()) if values.size else 0.0
        use_knn = (
            rows <= self.knn_max_rows
            and self.min_missing_rate <= missing_rate <= self.max_missing_rate
        )

        self.strategy_ = "knn" if use_knn else "median"
        imputer: KNNImputer | SimpleImputer
        if use_knn:
            imputer = KNNImputer(n_neighbors=self.n_neighbors)
        else:
            imputer = SimpleImputer(strategy="median")
        imputer.fit(values)
        self.imputer_ = imputer
        return self

    def transform(self, X: object) -> np.ndarray:
        filled = self.imputer_.transform(_as_float_matrix(X))
        return np.asarray(filled, dtype=float)


def detect_task(
    target_profile: ColumnProfile,
    row_count: int,
    override: TaskType | None = None,
) -> tuple[TaskType, str]:
    """Infer the supervised task for a target, or honour an explicit override."""

    if target_profile.null_count >= row_count and row_count > 0:
        raise InvalidTargetError(f"Target '{target_profile.name}' has no non-null values.")
    if target_profile.is_constant:
        raise InvalidTargetError(
            f"Target '{target_profile.name}' is constant and cannot be modelled."
        )

    if override is not None:
        return override, f"Task type set explicitly to {override.value}."

    if target_profile.semantic_type in ("categorical", "boolean"):
        return (
            TaskType.CLASSIFICATION,
            f"Target '{target_profile.name}' is {target_profile.semantic_type}.",
        )

    if target_profile.semantic_type == "numeric" and row_count > 0:
        unique_ratio = target_profile.unique_count / row_count
        if (
            target_profile.unique_count <= CLASSIFICATION_MAX_UNIQUE
            and unique_ratio <= CLASSIFICATION_MAX_RATIO
        ):
            return (
                TaskType.CLASSIFICATION,
                (
                    f"Target '{target_profile.name}' is numeric with "
                    f"{target_profile.unique_count} distinct values "
                    f"({unique_ratio:.1%} of rows)."
                ),
            )

    return (
        TaskType.REGRESSION,
        (
            f"Target '{target_profile.name}' is {target_profile.semantic_type} with "
            f"{target_profile.unique_count} distinct values; treated as continuous."
        ),
    )


def _is_high_cardinality(column: ColumnProfile, row_count: int) -> bool:
    if row_count <= 0:
        return False
    return (
        column.unique_count / row_count >= HIGH_CARDINALITY_RATIO
        or column.unique_count > HIGH_CARDINALITY_MAX_UNIQUE
    )


def partition_features(
    frame: pl.DataFrame,
    target: str,
    excluded: list[str],
    profile: ProfileReport,
) -> FeaturePartition:
    """Split features into numeric, low/high cardinality and dropped groups."""

    if target not in frame.columns:
        raise InvalidTargetError(f"Target column '{target}' does not exist.")
    if target in excluded:
        raise InvalidTargetError("The target column cannot also be excluded.")

    columns = {column.name: column for column in profile.columns}
    target_profile = columns.get(target)
    if target_profile is None:
        raise InvalidTargetError(f"Target column '{target}' is missing from the profile.")
    if target_profile.null_count == frame.height:
        raise InvalidTargetError(f"Target '{target}' has no non-null values.")
    if target_profile.is_constant:
        raise InvalidTargetError(f"Target '{target}' is constant and cannot be modelled.")

    excluded_set = set(excluded)
    partition = FeaturePartition(target=target, excluded=list(excluded))

    for name in frame.columns:
        if name == target or name in excluded_set:
            continue
        column = columns.get(name)
        if column is None:
            partition.dropped_unsupported.append(name)
            continue
        if column.null_count == frame.height:
            partition.dropped_all_null.append(name)
            continue
        if column.is_constant:
            partition.dropped_constant.append(name)
            continue

        if column.semantic_type == "numeric":
            partition.numeric.append(name)
        elif column.semantic_type in ("categorical", "boolean"):
            if _is_high_cardinality(column, frame.height):
                partition.high_cardinality_categorical.append(name)
            else:
                partition.low_cardinality_categorical.append(name)
        else:
            partition.dropped_unsupported.append(name)

    return partition


def build_preprocessor(
    partition: FeaturePartition,
    task: TaskType,
    *,
    scale_numeric: bool = False,
    random_state: int = RANDOM_SEED,
) -> ColumnTransformer:
    """Build an unfitted, picklable preprocessing pipeline for a partition.

    ``scale_numeric`` is enabled by the benchmark arena for linear models only;
    tree ensembles do not need it.
    """

    transformers: list[tuple[str, Pipeline, list[str]]] = []

    if partition.numeric:
        numeric_steps: list[tuple[str, BaseEstimator]] = [
            ("imputer", AdaptiveNumericImputer()),
            ("clipper", IQRClipper()),
        ]
        if scale_numeric:
            numeric_steps.append(("scaler", StandardScaler()))
        transformers.append(("numeric", Pipeline(numeric_steps), list(partition.numeric)))

    if partition.low_cardinality_categorical:
        transformers.append(
            (
                "low_cardinality",
                Pipeline(
                    [
                        ("imputer", SimpleImputer(strategy="most_frequent")),
                        (
                            "encoder",
                            OneHotEncoder(handle_unknown="ignore", sparse_output=False),
                        ),
                    ]
                ),
                list(partition.low_cardinality_categorical),
            )
        )

    if partition.high_cardinality_categorical:
        target_type = "continuous" if task == TaskType.REGRESSION else "auto"
        cv = (
            StratifiedKFold(
                n_splits=TARGET_ENCODER_FOLDS,
                shuffle=True,
                random_state=random_state,
            )
            if task == TaskType.CLASSIFICATION
            else KFold(
                n_splits=TARGET_ENCODER_FOLDS,
                shuffle=True,
                random_state=random_state,
            )
        )
        transformers.append(
            (
                "high_cardinality",
                Pipeline(
                    [
                        ("imputer", SimpleImputer(strategy="most_frequent")),
                        (
                            "encoder",
                            TargetEncoder(
                                target_type=target_type,
                                smooth="auto",
                                cv=cv,
                            ),
                        ),
                    ]
                ),
                list(partition.high_cardinality_categorical),
            )
        )

    if not transformers:
        raise NoUsableFeaturesError(
            "No usable feature columns remain after validation and exclusions."
        )

    return ColumnTransformer(transformers, remainder="drop", verbose_feature_names_out=False)


def _step_pipeline(preprocessor: ColumnTransformer, name: str) -> Pipeline:
    transformer = preprocessor.named_transformers_[name]
    if not isinstance(transformer, Pipeline):
        raise TypeError(f"Transformer '{name}' is not a Pipeline.")
    return transformer


def describe_preprocessor(
    preprocessor: ColumnTransformer,
    partition: FeaturePartition,
    *,
    random_state: int = RANDOM_SEED,
) -> PreprocessingPlan:
    """Describe a fitted pipeline so the UI can show exactly what ran."""

    steps: list[PreprocessingStep] = []

    if partition.numeric:
        numeric_pipeline = _step_pipeline(preprocessor, "numeric")
        imputer = numeric_pipeline.named_steps["imputer"]
        if not isinstance(imputer, AdaptiveNumericImputer):
            raise TypeError("Numeric imputer is not an AdaptiveNumericImputer.")
        steps.append(
            PreprocessingStep(
                kind="numeric_impute",
                columns=list(partition.numeric),
                strategy=imputer.strategy_,
                parameters={
                    "knn_neighbors": imputer.n_neighbors,
                    "knn_max_rows": imputer.knn_max_rows,
                    "min_missing_rate": imputer.min_missing_rate,
                    "max_missing_rate": imputer.max_missing_rate,
                },
            )
        )

        clipper = numeric_pipeline.named_steps["clipper"]
        if not isinstance(clipper, IQRClipper):
            raise TypeError("Numeric clipper is not an IQRClipper.")
        steps.append(
            PreprocessingStep(
                kind="iqr_clip",
                columns=list(partition.numeric),
                parameters={"k": clipper.k},
            )
        )

        if "scaler" in numeric_pipeline.named_steps:
            steps.append(
                PreprocessingStep(
                    kind="standard_scale",
                    columns=list(partition.numeric),
                )
            )

    for name, columns, encoder_kind in (
        (
            "low_cardinality",
            partition.low_cardinality_categorical,
            "one_hot_encode",
        ),
        (
            "high_cardinality",
            partition.high_cardinality_categorical,
            "target_encode",
        ),
    ):
        if not columns:
            continue
        pipeline = _step_pipeline(preprocessor, name)
        steps.append(
            PreprocessingStep(
                kind="categorical_impute",
                columns=list(columns),
                strategy="most_frequent",
            )
        )
        encoder = pipeline.named_steps["encoder"]
        if encoder_kind == "one_hot_encode":
            steps.append(
                PreprocessingStep(
                    kind="one_hot_encode",
                    columns=list(columns),
                    parameters={"handle_unknown": "ignore"},
                )
            )
        else:
            if not isinstance(encoder, TargetEncoder):
                raise TypeError("High-cardinality encoder is not a TargetEncoder.")
            steps.append(
                PreprocessingStep(
                    kind="target_encode",
                    columns=list(columns),
                    parameters={
                        "smooth": "auto",
                        "cv_folds": TARGET_ENCODER_FOLDS,
                        "random_state": random_state,
                    },
                )
            )

    dropped = (
        list(partition.dropped_constant)
        + list(partition.dropped_all_null)
        + list(partition.dropped_unsupported)
    )
    if dropped:
        steps.append(
            PreprocessingStep(
                kind="drop",
                columns=dropped,
                parameters={
                    "constant": len(partition.dropped_constant),
                    "all_null": len(partition.dropped_all_null),
                    "unsupported": len(partition.dropped_unsupported),
                },
            )
        )

    notes: list[str] = []
    if partition.dropped_constant:
        notes.append(
            f"{len(partition.dropped_constant)} constant column(s) dropped: "
            + ", ".join(partition.dropped_constant)
        )
    if partition.dropped_all_null:
        notes.append(
            f"{len(partition.dropped_all_null)} all-null column(s) dropped: "
            + ", ".join(partition.dropped_all_null)
        )
    if partition.dropped_unsupported:
        notes.append(
            f"{len(partition.dropped_unsupported)} unsupported column(s) dropped: "
            + ", ".join(partition.dropped_unsupported)
        )

    return PreprocessingPlan(
        numeric_features=list(partition.numeric),
        categorical_features=list(partition.low_cardinality_categorical)
        + list(partition.high_cardinality_categorical),
        excluded_features=list(partition.excluded),
        target_encoding=list(partition.high_cardinality_categorical),
        one_hot_encoding=list(partition.low_cardinality_categorical),
        steps=steps,
        notes=notes,
    )
