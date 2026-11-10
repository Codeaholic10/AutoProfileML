"""Benchmark arena: model registry, cross-validation, ranking and persistence.

Models train sequentially in a single job (ADR-9). Each model is isolated: a
failure marks only that model, while a run-level failure (unreadable data,
invalid target) fails the job. Every learned transformer lives inside the
pipeline, so preprocessing is fitted within each CV fold.
"""

from __future__ import annotations

import re
import uuid
from collections import Counter
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Literal

import joblib
import numpy as np
import polars as pl
from lightgbm import LGBMClassifier, LGBMRegressor
from sklearn import metrics as sk_metrics
from sklearn.base import BaseEstimator, ClassifierMixin, clone
from sklearn.ensemble import RandomForestClassifier, RandomForestRegressor
from sklearn.linear_model import LogisticRegression, Ridge
from sklearn.metrics import make_scorer
from sklearn.model_selection import KFold, StratifiedKFold, cross_validate
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import LabelEncoder
from sklearn.utils.validation import check_is_fitted
from xgboost import XGBClassifier, XGBRegressor

from app.core.config import Settings, get_settings
from app.core.jobs import JobStore, get_job_store
from app.models.benchmark import (
    BenchmarkCreateRequest,
    BenchmarkRun,
    BenchmarkSummary,
    FeaturePartition,
    ModelResult,
    OutOfFoldPrediction,
    OutOfFoldPredictions,
    TaskType,
)
from app.models.schemas import JobRecord, JobStatus
from app.services import ingestion
from app.services.datasets import DatasetService, ProfileNotFoundError
from app.services.preprocessing import (
    RANDOM_SEED,
    build_preprocessor,
    describe_preprocessor,
    detect_task,
    partition_features,
)
from app.storage.base import Storage
from app.storage.factory import get_storage

MAX_TRAIN_ROWS = 250_000
PREDICTION_CAP = 20_000
PRIMARY_METRIC: dict[TaskType, str] = {
    TaskType.CLASSIFICATION: "f1_macro",
    TaskType.REGRESSION: "rmse",
}
NEGATED_METRICS = {"log_loss", "rmse", "mae"}
_ID_PATTERN = re.compile(r"^[0-9a-f]{32}$")


class BenchmarkNotFoundError(KeyError):
    """Raised when a benchmark document does not exist."""


class PredictionNotFoundError(KeyError):
    """Raised when stored out-of-fold predictions do not exist."""


class ModelNotFoundError(KeyError):
    """Raised when a served model artifact does not exist."""


class PredictionsUnsupportedError(ValueError):
    """Raised for prediction requests against regression runs."""


class BenchmarkNotReadyError(RuntimeError):
    """Raised when a benchmark has not finished yet."""


# --------------------------------------------------------------------------- #
# Metrics
# --------------------------------------------------------------------------- #


def accuracy(y_true: np.ndarray, y_pred: np.ndarray) -> float:
    return float(sk_metrics.accuracy_score(y_true, y_pred))


def macro_f1(y_true: np.ndarray, y_pred: np.ndarray) -> float:
    return float(sk_metrics.f1_score(y_true, y_pred, average="macro"))


def roc_auc(y_true: np.ndarray, y_score: np.ndarray) -> float:
    classes = np.unique(y_true)
    if classes.size == 2:
        scores = y_score[:, 1] if y_score.ndim > 1 else y_score
        return float(sk_metrics.roc_auc_score(y_true, scores))
    return float(
        sk_metrics.roc_auc_score(
            y_true,
            y_score,
            multi_class="ovr",
            average="weighted",
        )
    )


def log_loss(y_true: np.ndarray, y_score: np.ndarray) -> float:
    return float(sk_metrics.log_loss(y_true, y_score))


def rmse(y_true: np.ndarray, y_pred: np.ndarray) -> float:
    return float(sk_metrics.root_mean_squared_error(y_true, y_pred))


def mae(y_true: np.ndarray, y_pred: np.ndarray) -> float:
    return float(sk_metrics.mean_absolute_error(y_true, y_pred))


def r2(y_true: np.ndarray, y_pred: np.ndarray) -> float:
    return float(sk_metrics.r2_score(y_true, y_pred))


def _classification_scorers() -> dict[str, object]:
    return {
        "accuracy": make_scorer(accuracy),
        "f1_macro": make_scorer(macro_f1),
        "roc_auc": make_scorer(roc_auc, response_method="predict_proba"),
        "log_loss": make_scorer(
            log_loss,
            response_method="predict_proba",
            greater_is_better=False,
        ),
    }


def _regression_scorers() -> dict[str, object]:
    return {
        "rmse": make_scorer(rmse, greater_is_better=False),
        "mae": make_scorer(mae, greater_is_better=False),
        "r2": make_scorer(r2),
    }


# --------------------------------------------------------------------------- #
# Model registry
# --------------------------------------------------------------------------- #


class LabelEncodedClassifier(BaseEstimator, ClassifierMixin):
    """Train on integer class codes and predict the original labels.

    XGBoost rejects non-numeric labels, so every classifier is wrapped for a
    uniform interface: pipelines accept the dataset's labels directly and the
    stored artifacts stay usable for explanations.
    """

    classes_: np.ndarray
    encoder_: LabelEncoder
    estimator_: BaseEstimator

    def __init__(self, estimator: BaseEstimator) -> None:
        self.estimator = estimator

    def fit(self, X: object, y: object) -> LabelEncodedClassifier:
        labels = np.asarray(y)
        self.encoder_ = LabelEncoder().fit(labels)
        self.classes_ = self.encoder_.classes_
        self.estimator_ = clone(self.estimator)
        self.estimator_.fit(X, self.encoder_.transform(labels))
        return self

    def predict(self, X: object) -> np.ndarray:
        check_is_fitted(self, "estimator_")
        encoded = np.asarray(self.estimator_.predict(X))
        decoded = self.encoder_.inverse_transform(encoded.astype(int))
        return np.asarray(decoded)

    def predict_proba(self, X: object) -> np.ndarray:
        check_is_fitted(self, "estimator_")
        return np.asarray(self.estimator_.predict_proba(X))


def _wrap_classifier(estimator: BaseEstimator) -> BaseEstimator:
    return LabelEncodedClassifier(estimator)


def _logistic_regression(random_state: int) -> BaseEstimator:
    return _wrap_classifier(
        LogisticRegression(
            max_iter=1000,
            class_weight="balanced",
            random_state=random_state,
        )
    )


def _ridge(random_state: int) -> BaseEstimator:
    return Ridge(random_state=random_state)


def _random_forest_classifier(random_state: int) -> BaseEstimator:
    return _wrap_classifier(
        RandomForestClassifier(n_estimators=300, n_jobs=-1, random_state=random_state)
    )


def _random_forest_regressor(random_state: int) -> BaseEstimator:
    return RandomForestRegressor(n_estimators=300, n_jobs=-1, random_state=random_state)


def _lightgbm_classifier(random_state: int) -> BaseEstimator:
    return _wrap_classifier(
        LGBMClassifier(
            n_estimators=300,
            learning_rate=0.05,
            random_state=random_state,
            n_jobs=1,
            verbose=-1,
        )
    )


def _lightgbm_regressor(random_state: int) -> BaseEstimator:
    return LGBMRegressor(
        n_estimators=300,
        learning_rate=0.05,
        random_state=random_state,
        n_jobs=1,
        verbose=-1,
    )


def _xgboost_classifier(random_state: int) -> BaseEstimator:
    return _wrap_classifier(
        XGBClassifier(
            n_estimators=300,
            learning_rate=0.05,
            tree_method="hist",
            random_state=random_state,
            n_jobs=1,
            verbosity=0,
        )
    )


def _xgboost_regressor(random_state: int) -> BaseEstimator:
    return XGBRegressor(
        n_estimators=300,
        learning_rate=0.05,
        tree_method="hist",
        random_state=random_state,
        n_jobs=1,
        verbosity=0,
    )


@dataclass(frozen=True)
class ModelSpec:
    """One entry of the fixed model registry."""

    key: str
    family: Literal["linear", "random_forest", "lightgbm", "xgboost"]
    classification_name: str
    regression_name: str
    classifier: Callable[[int], BaseEstimator]
    regressor: Callable[[int], BaseEstimator]

    def name_for(self, task: TaskType) -> str:
        return self.classification_name if task == TaskType.CLASSIFICATION else self.regression_name

    def estimator(self, task: TaskType, random_state: int) -> BaseEstimator:
        if task == TaskType.CLASSIFICATION:
            return self.classifier(random_state)
        return self.regressor(random_state)


MODEL_SPECS: tuple[ModelSpec, ...] = (
    ModelSpec(
        key="linear",
        family="linear",
        classification_name="Logistic Regression",
        regression_name="Ridge",
        classifier=_logistic_regression,
        regressor=_ridge,
    ),
    ModelSpec(
        key="random_forest",
        family="random_forest",
        classification_name="Random Forest",
        regression_name="Random Forest",
        classifier=_random_forest_classifier,
        regressor=_random_forest_regressor,
    ),
    ModelSpec(
        key="lightgbm",
        family="lightgbm",
        classification_name="LightGBM",
        regression_name="LightGBM",
        classifier=_lightgbm_classifier,
        regressor=_lightgbm_regressor,
    ),
    ModelSpec(
        key="xgboost",
        family="xgboost",
        classification_name="XGBoost",
        regression_name="XGBoost",
        classifier=_xgboost_classifier,
        regressor=_xgboost_regressor,
    ),
)


def _scalar_params(estimator: BaseEstimator) -> dict[str, float | int | str | bool | None]:
    """Expose primitive hyperparameters for the leaderboard payload."""

    candidate = estimator.estimator if isinstance(estimator, LabelEncodedClassifier) else estimator
    params: dict[str, float | int | str | bool | None] = {}
    for key, value in candidate.get_params(deep=False).items():
        if isinstance(value, np.integer):
            params[key] = int(value)
        elif isinstance(value, np.floating):
            params[key] = float(value)
        elif isinstance(value, (bool, int, float, str)) or value is None:
            params[key] = value
    return params


# --------------------------------------------------------------------------- #
# Sampling, CV and ranking
# --------------------------------------------------------------------------- #


def sample_training_frame(
    frame: pl.DataFrame,
    max_rows: int = MAX_TRAIN_ROWS,
    seed: int = RANDOM_SEED,
) -> tuple[pl.DataFrame, int | None]:
    """Cap training rows with a fixed-seed sample; return the sample size if used."""

    if frame.height <= max_rows:
        return frame, None
    sampled = frame.sample(n=max_rows, seed=seed, shuffle=True)
    return sampled, sampled.height


@dataclass
class CrossValidationOutcome:
    """Everything one model's cross-validated pass produced."""

    metrics: dict[str, float]
    metric_std: dict[str, float]
    training_seconds: float
    predictions: list[OutOfFoldPrediction]
    classes: list[str]
    class_support: dict[str, int]
    truncated: bool


def _select_rows(frame: pl.DataFrame, indices: np.ndarray) -> pl.DataFrame:
    mask = np.zeros(frame.height, dtype=bool)
    mask[indices] = True
    return frame.filter(pl.Series(mask))


def cross_validate_model(
    pipeline: Pipeline,
    X: pl.DataFrame,
    y: np.ndarray,
    task: TaskType,
    folds: int,
    random_state: int = RANDOM_SEED,
) -> CrossValidationOutcome:
    """Fit the pipeline on each fold, returning metrics and out-of-fold predictions."""

    labels = np.asarray(y)
    if task == TaskType.CLASSIFICATION:
        splitter: KFold | StratifiedKFold = StratifiedKFold(
            n_splits=folds, shuffle=True, random_state=random_state
        )
        scorers = _classification_scorers()
        classes = [str(label) for label in np.unique(labels)]
    else:
        splitter = KFold(n_splits=folds, shuffle=True, random_state=random_state)
        scorers = _regression_scorers()
        classes = []

    splits = list(splitter.split(X, labels))
    results = cross_validate(
        pipeline,
        X,
        labels,
        cv=splits,
        scoring=scorers,
        return_estimator=True,
        return_train_score=False,
        error_score="raise",
    )

    metrics: dict[str, float] = {}
    metric_std: dict[str, float] = {}
    for name in scorers:
        values = np.asarray(results[f"test_{name}"], dtype=float)
        if name in NEGATED_METRICS:
            values = -values
        metrics[name] = round(float(values.mean()), 6)
        metric_std[name] = round(float(values.std(ddof=1)), 6) if values.size > 1 else 0.0

    predictions: list[OutOfFoldPrediction] = []
    for estimator, (_, test_indices) in zip(results["estimator"], splits, strict=True):
        test_indices = np.asarray(test_indices)
        X_test = _select_rows(X, test_indices)
        predicted = np.asarray(estimator.predict(X_test))
        probabilities = (
            np.asarray(estimator.predict_proba(X_test)) if task == TaskType.CLASSIFICATION else None
        )
        for local_index, row_index in enumerate(test_indices):
            if task == TaskType.CLASSIFICATION and probabilities is not None:
                predictions.append(
                    OutOfFoldPrediction(
                        row_index=int(row_index),
                        y_true=str(labels[row_index]),
                        y_pred=str(predicted[local_index]),
                        probabilities={
                            label: round(float(value), 6)
                            for label, value in zip(
                                classes, probabilities[local_index], strict=True
                            )
                        },
                    )
                )
            else:
                predictions.append(
                    OutOfFoldPrediction(
                        row_index=int(row_index),
                        y_true=float(labels[row_index]),
                        y_pred=float(predicted[local_index]),
                    )
                )

    predictions.sort(key=lambda prediction: prediction.row_index)
    truncated = len(predictions) > PREDICTION_CAP
    retained = predictions[:PREDICTION_CAP]

    class_support = (
        dict(sorted(Counter(str(label) for label in labels).items()))
        if task == TaskType.CLASSIFICATION
        else {}
    )

    return CrossValidationOutcome(
        metrics=metrics,
        metric_std=metric_std,
        training_seconds=round(float(np.sum(results["fit_time"])), 3),
        predictions=retained,
        classes=classes,
        class_support=class_support,
        truncated=truncated,
    )


def rank_models(
    leaderboard: list[ModelResult],
    task: TaskType,
) -> list[ModelResult]:
    """Assign dense ranks to succeeded models; return them best-first."""

    metric = PRIMARY_METRIC[task]
    succeeded = [
        model for model in leaderboard if model.status == "succeeded" and metric in model.metrics
    ]
    ordered = sorted(
        succeeded,
        key=lambda model: model.metrics[metric],
        reverse=task == TaskType.CLASSIFICATION,
    )

    previous: float | None = None
    rank = 0
    for model in ordered:
        value = model.metrics[metric]
        if previous is None or value != previous:
            rank += 1
            previous = value
        model.rank = rank

    for model in leaderboard:
        if model.status != "succeeded":
            model.rank = None

    return ordered


# --------------------------------------------------------------------------- #
# Service
# --------------------------------------------------------------------------- #


def _utcnow() -> datetime:
    return datetime.now(UTC)


def _require_id(value: str, error: type[KeyError]) -> None:
    if _ID_PATTERN.fullmatch(value) is None:
        raise error(value)


def _safe_error(exc: BaseException, settings: Settings) -> str:
    """Describe a failure without leaking filesystem paths."""

    message = f"{type(exc).__name__}: {exc}".replace("\n", " ").strip()
    root = str(settings.storage_root.resolve())
    return message.replace(root, "<storage>")


class BenchmarkService:
    """Coordinates benchmark runs, model artifacts and their JSON documents."""

    def __init__(
        self,
        storage: Storage | None = None,
        job_store: JobStore | None = None,
        settings: Settings | None = None,
        dataset_service: DatasetService | None = None,
    ) -> None:
        self._storage = storage or get_storage()
        self._jobs = job_store or get_job_store()
        self._settings = settings or get_settings()
        self._datasets = dataset_service or DatasetService(
            storage=self._storage,
            job_store=self._jobs,
            settings=self._settings,
        )

    # Paths -----------------------------------------------------------------

    def _benchmark_dir(self, benchmark_id: str) -> Path:
        _require_id(benchmark_id, BenchmarkNotFoundError)
        return self._settings.benchmarks_dir / benchmark_id

    def _run_path(self, benchmark_id: str) -> Path:
        return self._benchmark_dir(benchmark_id) / "run.json"

    def _preprocessing_path(self, benchmark_id: str) -> Path:
        return self._benchmark_dir(benchmark_id) / "preprocessing.json"

    def _model_path(self, benchmark_id: str, model_id: str) -> Path:
        return self._benchmark_dir(benchmark_id) / "models" / f"{model_id}.joblib"

    def _predictions_path(self, benchmark_id: str, model_id: str) -> Path:
        return self._benchmark_dir(benchmark_id) / "predictions" / f"{model_id}.json"

    # Reads -----------------------------------------------------------------

    def get_benchmark(self, benchmark_id: str) -> BenchmarkRun:
        path = self._run_path(benchmark_id)
        if not self._storage.exists(path):
            raise BenchmarkNotFoundError(benchmark_id)
        try:
            return BenchmarkRun.model_validate_json(self._storage.read_text(path))
        except ValueError as exc:
            raise BenchmarkNotFoundError(benchmark_id) from exc

    def list_benchmarks(self, dataset_id: str) -> list[BenchmarkSummary]:
        self._datasets.get_dataset(dataset_id)
        directory = self._settings.benchmarks_dir
        if not directory.exists():
            return []

        summaries: list[BenchmarkSummary] = []
        for entry in sorted(directory.iterdir()):
            if not entry.is_dir():
                continue
            try:
                run = self.get_benchmark(entry.name)
            except BenchmarkNotFoundError:
                continue
            if run.dataset_id != dataset_id:
                continue
            summaries.append(self._summarise(run))
        return sorted(summaries, key=lambda summary: summary.created_at, reverse=True)

    def _summarise(self, run: BenchmarkRun) -> BenchmarkSummary:
        metric = PRIMARY_METRIC[run.task_type]
        best = next(
            (model for model in run.leaderboard if model.model_id == run.best_model_id),
            None,
        )
        return BenchmarkSummary(
            benchmark_id=run.benchmark_id,
            dataset_id=run.dataset_id,
            target=run.target,
            task_type=run.task_type,
            status=run.status,
            best_model_name=best.name if best is not None else None,
            primary_metric=metric,
            primary_metric_value=best.metrics.get(metric) if best is not None else None,
            created_at=run.created_at,
        )

    def get_oof_predictions(self, benchmark_id: str, model_id: str) -> OutOfFoldPredictions:
        run = self.get_benchmark(benchmark_id)
        _require_id(model_id, PredictionNotFoundError)

        if run.task_type != TaskType.CLASSIFICATION:
            raise PredictionsUnsupportedError(
                "Out-of-fold predictions are only available for classification runs."
            )
        if run.status != JobStatus.SUCCEEDED:
            raise BenchmarkNotReadyError(
                "Predictions are not available until the benchmark completes."
            )
        if not any(
            model.model_id == model_id and model.status == "succeeded" for model in run.leaderboard
        ):
            raise PredictionNotFoundError(model_id)

        path = self._predictions_path(benchmark_id, model_id)
        benchmark_dir = self._benchmark_dir(benchmark_id).resolve()
        if not path.resolve().is_relative_to(benchmark_dir):
            raise PredictionNotFoundError(model_id)
        if not self._storage.exists(path):
            raise PredictionNotFoundError(model_id)
        try:
            return OutOfFoldPredictions.model_validate_json(self._storage.read_text(path))
        except ValueError as exc:
            raise PredictionNotFoundError(model_id) from exc

    def get_model_path(self, benchmark_id: str, model_id: str) -> Path:
        run = self.get_benchmark(benchmark_id)
        _require_id(model_id, ModelNotFoundError)
        model = next(
            (
                candidate
                for candidate in run.leaderboard
                if candidate.model_id == model_id and candidate.status == "succeeded"
            ),
            None,
        )
        if model is None:
            raise ModelNotFoundError(model_id)

        path = self._model_path(benchmark_id, model_id)
        benchmark_dir = self._benchmark_dir(benchmark_id).resolve()
        if not path.resolve().is_relative_to(benchmark_dir):
            raise ModelNotFoundError(model_id)
        if not path.exists():
            raise ModelNotFoundError(model_id)
        return path

    # Writes ----------------------------------------------------------------

    def _persist_run(self, run: BenchmarkRun) -> None:
        run.updated_at = _utcnow()
        self._storage.write_text(
            self._run_path(run.benchmark_id),
            run.model_dump_json(),
        )

    def _write_predictions(
        self,
        benchmark_id: str,
        model_id: str,
        outcome: CrossValidationOutcome,
        task: TaskType,
    ) -> None:
        document = OutOfFoldPredictions(
            benchmark_id=benchmark_id,
            model_id=model_id,
            task_type=task,
            classes=outcome.classes,
            prediction_count=len(outcome.predictions),
            truncated=outcome.truncated,
            predictions=outcome.predictions,
        )
        self._storage.write_text(
            self._predictions_path(benchmark_id, model_id),
            document.model_dump_json(),
        )

    # Orchestration ---------------------------------------------------------

    def enqueue(
        self,
        dataset_id: str,
        request: BenchmarkCreateRequest,
    ) -> tuple[BenchmarkRun, JobRecord]:
        summary = self._datasets.get_dataset(dataset_id)

        try:
            profile = self._datasets.get_profile(dataset_id)
        except ProfileNotFoundError as exc:
            raise ValueError("Profile not available. Run profiling before benchmarking.") from exc

        frame = ingestion.load_dataset(self._datasets.dataset_file(dataset_id), summary.format)
        columns = {column.name: column for column in profile.columns}
        target_profile = columns.get(request.target)
        if target_profile is None:
            raise ValueError(f"Target column '{request.target}' does not exist.")

        task, reason = detect_task(target_profile, frame.height, request.task_type)
        partition_features(frame, request.target, request.excluded_features, profile)

        job = self._jobs.create(kind="benchmark", dataset_id=dataset_id)
        run = BenchmarkRun(
            benchmark_id=uuid.uuid4().hex,
            dataset_id=dataset_id,
            target=request.target,
            task_type=task,
            task_detection_reason=reason,
            status=JobStatus.QUEUED,
            folds=request.folds,
            random_state=request.random_state,
            excluded_features=list(request.excluded_features),
        )
        self._persist_run(run)
        return run, job

    def _build_pipeline(
        self,
        spec: ModelSpec,
        partition: FeaturePartition,
        task: TaskType,
        random_state: int,
    ) -> Pipeline:
        preprocessor = build_preprocessor(
            partition,
            task,
            scale_numeric=spec.family == "linear",
            random_state=random_state,
        )
        return Pipeline(
            [
                ("preprocessor", preprocessor),
                ("model", spec.estimator(task, random_state)),
            ]
        )

    def run_benchmark(self, benchmark_id: str, job_id: str) -> None:
        """Background entrypoint: train, rank, refit and persist a run."""

        run: BenchmarkRun | None = None
        try:
            self._jobs.update(job_id, status=JobStatus.RUNNING, stage="loading", progress=0.05)
            run = self.get_benchmark(benchmark_id)
            run.status = JobStatus.RUNNING
            run.leaderboard = []
            run.best_model_id = None
            run.preprocessing = None
            run.error = None
            self._persist_run(run)
            summary = self._datasets.get_dataset(run.dataset_id)
            frame = ingestion.load_dataset(
                self._datasets.dataset_file(run.dataset_id), summary.format
            )
            profile = self._datasets.get_profile(run.dataset_id)
            frame, sample_rows = sample_training_frame(frame, seed=run.random_state)
            run.sample_rows = sample_rows
            partition = partition_features(frame, run.target, run.excluded_features, profile)
            features = (
                partition.numeric
                + partition.low_cardinality_categorical
                + partition.high_cardinality_categorical
            )
            X = frame.select(features)
            y = frame[run.target].to_numpy()

            total = len(MODEL_SPECS)
            for index, spec in enumerate(MODEL_SPECS, start=1):
                self._jobs.update(
                    job_id,
                    stage=f"training ({index}/{total}): {spec.name_for(run.task_type)}",
                    progress=round(0.1 + 0.6 * (index - 1) / total, 3),
                )
                model_id = uuid.uuid4().hex
                try:
                    pipeline = self._build_pipeline(
                        spec, partition, run.task_type, run.random_state
                    )
                    outcome = cross_validate_model(
                        pipeline,
                        X,
                        y,
                        run.task_type,
                        run.folds,
                        random_state=run.random_state,
                    )
                    result = ModelResult(
                        model_id=model_id,
                        name=spec.name_for(run.task_type),
                        family=spec.family,
                        status="succeeded",
                        metrics=outcome.metrics,
                        metric_std=outcome.metric_std,
                        training_seconds=outcome.training_seconds,
                        hyperparameters=_scalar_params(
                            spec.estimator(run.task_type, run.random_state)
                        ),
                    )
                    self._write_predictions(benchmark_id, model_id, outcome, run.task_type)
                    run.class_support = outcome.class_support
                except Exception as exc:  # noqa: BLE001 - per-model isolation
                    result = ModelResult(
                        model_id=model_id,
                        name=spec.name_for(run.task_type),
                        family=spec.family,
                        status="failed",
                        error=_safe_error(exc, self._settings),
                    )
                run.leaderboard.append(result)
                self._persist_run(run)

            self._jobs.update(job_id, stage="refitting models", progress=0.8)
            refitted: dict[str, Pipeline] = {}
            for result, spec in zip(run.leaderboard, MODEL_SPECS, strict=True):
                if result.status != "succeeded":
                    continue
                try:
                    pipeline = self._build_pipeline(
                        spec, partition, run.task_type, run.random_state
                    )
                    pipeline.fit(X, y)
                    model_path = self._model_path(benchmark_id, result.model_id)
                    model_path.parent.mkdir(parents=True, exist_ok=True)
                    joblib.dump(pipeline, model_path)
                    refitted[result.model_id] = pipeline
                except Exception as exc:  # noqa: BLE001 - per-model isolation
                    result.status = "failed"
                    result.error = _safe_error(exc, self._settings)

            ranked = rank_models(run.leaderboard, run.task_type)
            best = ranked[0] if ranked else None
            run.best_model_id = best.model_id if best is not None else None

            if best is not None:
                pipeline = refitted.get(best.model_id)
                if pipeline is not None:
                    plan = describe_preprocessor(
                        pipeline.named_steps["preprocessor"],
                        partition,
                        random_state=run.random_state,
                    )
                    run.preprocessing = plan
                    self._storage.write_text(
                        self._preprocessing_path(benchmark_id),
                        plan.model_dump_json(),
                    )

            run.status = JobStatus.SUCCEEDED
            self._persist_run(run)
            metric = PRIMARY_METRIC[run.task_type]
            self._jobs.succeed(
                job_id,
                {
                    "benchmark_id": benchmark_id,
                    "best_model_id": run.best_model_id,
                    "model_count": len(run.leaderboard),
                    "primary_metric": metric,
                    "primary_metric_value": (
                        best.metrics.get(metric) if best is not None else None
                    ),
                },
            )
        except Exception as exc:  # noqa: BLE001 - surfaced through the job
            error = _safe_error(exc, self._settings)
            if run is not None:
                run.status = JobStatus.FAILED
                run.error = error
                self._persist_run(run)
            self._jobs.fail(job_id, error)
