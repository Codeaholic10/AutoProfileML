"""SHAP explainability: global importance and per-row contributions.

Explanations are computed over a fixed-seed sample of the dataset and stored as
JSON next to the benchmark they explain. Only server-generated joblib artifacts
are loaded; the model id must belong to the run and resolve inside its
benchmark directory (enforced by `BenchmarkService.get_model_path`).
"""

from __future__ import annotations

import re
import time
import uuid
from datetime import UTC, datetime
from pathlib import Path
from typing import Literal

import joblib
import numpy as np
import polars as pl
import shap
from sklearn.compose import ColumnTransformer
from sklearn.pipeline import Pipeline

from app.core.config import Settings, get_settings
from app.core.jobs import JobStore, get_job_store
from app.models.benchmark import BenchmarkRun, FeaturePartition, ModelResult, TaskType
from app.models.explanation import (
    ExplanationCreateRequest,
    ExplanationReport,
    FeatureImportance,
    LocalExplanation,
    ShapContribution,
    ShapSummaryPoint,
)
from app.models.schemas import JobRecord, JobStatus, ProfilingWarning
from app.services import ingestion
from app.services.benchmarking import (
    BenchmarkNotReadyError,
    BenchmarkService,
    LabelEncodedClassifier,
    ModelNotFoundError,
    _safe_error,
)
from app.services.datasets import DatasetService
from app.services.preprocessing import RANDOM_SEED, partition_features
from app.storage.base import Storage
from app.storage.factory import get_storage

SHAP_SAMPLE_CAP = 1_000
BACKGROUND_CAP = 100
LOCAL_CONTRIBUTION_CAP = 15
SUMMARY_FEATURE_CAP = 10
GLOBAL_IMPORTANCE_CAP = 30
ROUND_DIGITS = 6
_ID_PATTERN = re.compile(r"^[0-9a-f]{32}$")
TREE_FAMILIES = frozenset({"random_forest", "lightgbm", "xgboost"})

ExplainerMethod = Literal["tree_shap", "linear_shap", "kernel_shap"]


class ExplanationNotFoundError(KeyError):
    """Raised when no explanation has been stored for a model."""


class UnsupportedModelError(ValueError):
    """Raised for model families that cannot be explained."""


def explainer_method(family: str) -> ExplainerMethod:
    """Choose the SHAP explainer for a registry family."""

    if family == "linear":
        return "linear_shap"
    if family in TREE_FAMILIES:
        return "tree_shap"
    raise UnsupportedModelError(f"Model family '{family}' cannot be explained.")


def _require_id(value: str) -> None:
    if _ID_PATTERN.fullmatch(value) is None:
        raise ModelNotFoundError(value)


def _round(value: float) -> float:
    return round(float(value), ROUND_DIGITS)


def _finite(value: float) -> float:
    return 0.0 if not np.isfinite(value) else float(value)


def _scalar(value: object) -> str | float | None:
    """Convert a raw Polars cell into a JSON-safe feature value."""

    if value is None:
        return None
    if isinstance(value, (bool, np.bool_)):
        return str(bool(value))
    if isinstance(value, (int, float, np.integer, np.floating)):
        number = float(value)
        return None if not np.isfinite(number) else number
    return str(value)


def _source_feature(encoded_name: str, partition: FeaturePartition) -> str | None:
    """Map an encoded feature name back to its dataset column where possible."""

    prefix, _, remainder = encoded_name.partition("__")
    if prefix in {"numeric", "high_cardinality"}:
        return remainder
    if prefix == "low_cardinality":
        for feature in partition.low_cardinality_categorical:
            if remainder == feature or remainder.startswith(f"{feature}_"):
                return feature
        return remainder
    for feature in (
        partition.numeric
        + partition.low_cardinality_categorical
        + partition.high_cardinality_categorical
    ):
        if encoded_name == feature or remainder == feature:
            return feature
    return None


def _feature_names(preprocessor: ColumnTransformer) -> list[str]:
    """Derive encoded feature names without relying on custom-step introspection.

    The adaptive numeric imputer does not implement ``get_feature_names_out``,
    so each transformer's output names are reconstructed from its fitted
    encoder and its declared input columns.
    """

    names: list[str] = []
    for name, transformer, columns in preprocessor.transformers_:
        if name == "remainder":
            continue
        inputs = [str(column) for column in columns]
        if name == "low_cardinality":
            encoder = transformer.named_steps["encoder"]
            encoded = [str(value) for value in encoder.get_feature_names_out(inputs)]
            names.extend(f"{name}__{value}" for value in encoded)
        else:
            names.extend(f"{name}__{column}" for column in inputs)
    return names


def _unwrap(estimator: object) -> object:
    if isinstance(estimator, LabelEncodedClassifier):
        return estimator.estimator_
    return estimator


def _build_explainer(
    method: ExplainerMethod,
    estimator: object,
    background: np.ndarray,
) -> shap.Explainer:
    """Create a SHAP explainer with an explicit, bounded background set."""

    if method == "tree_shap":
        return shap.TreeExplainer(
            estimator,
            data=background,
            feature_perturbation="interventional",
        )
    return shap.LinearExplainer(estimator, masker=background)


def _class_values(
    values: np.ndarray,
    base: np.ndarray,
    class_count: int,
) -> tuple[np.ndarray, np.ndarray]:
    """Normalise SHAP output to (rows, features, classes) and (rows, classes)."""

    if values.ndim == 2:
        # Binary logistic models explain the positive class with 2-D values:
        # the negative class is the exact mirror in margin space.
        base_vector = np.asarray(base).reshape(-1)
        if base_vector.size == 1:
            base_vector = np.full(values.shape[0], float(base_vector[0]))
        values_3d = np.stack([-values, values], axis=2)
        base_2d = np.stack([-base_vector, base_vector], axis=1)
        return values_3d, base_2d

    if values.ndim != 3:
        raise UnsupportedModelError("Unexpected SHAP value shape for a classifier.")
    if values.shape[2] != class_count:
        raise UnsupportedModelError("SHAP output does not match the model's classes.")

    base_array = np.asarray(base)
    if base_array.ndim == 1:
        base_array = np.repeat(base_array.reshape(-1, 1), class_count, axis=1)
    elif base_array.ndim == 0:
        base_array = np.full((values.shape[0], class_count), float(base_array))
    return values, base_array


def _regression_base(base: np.ndarray, rows: int) -> np.ndarray:
    base_array = np.asarray(base)
    if base_array.ndim == 0:
        return np.full(rows, float(base_array))
    return base_array.reshape(-1)


def _summary_points(
    values: np.ndarray,
    features: list[str],
    top_features: list[str],
    frame: pl.DataFrame,
    partition: FeaturePartition,
) -> list[ShapSummaryPoint]:
    """Build beeswarm dots for the top features over the sampled rows."""

    indices = {feature: features.index(feature) for feature in top_features}
    sources = {feature: _source_feature(feature, partition) for feature in top_features}
    points: list[ShapSummaryPoint] = []
    for feature in top_features:
        column_index = indices[feature]
        source = sources[feature]
        raw_column = frame[source] if source is not None and source in frame.columns else None
        for row in range(values.shape[0]):
            raw_value = raw_column[row] if raw_column is not None else None
            points.append(
                ShapSummaryPoint(
                    feature=feature,
                    feature_value=_scalar(raw_value),
                    shap_value=_round(_finite(values[row, column_index])),
                )
            )
    return points


def _local_explanations(
    base: np.ndarray,
    predictions: np.ndarray,
    per_row_values: np.ndarray,
    features: list[str],
    frame: pl.DataFrame,
    partition: FeaturePartition,
    local_rows: int,
) -> list[LocalExplanation]:
    """Explain the first ``local_rows`` sampled rows with the top contributions."""

    sources = {feature: _source_feature(feature, partition) for feature in features}
    raw = frame.rows(named=True)
    explanations: list[LocalExplanation] = []
    for row in range(min(local_rows, per_row_values.shape[0])):
        row_values = per_row_values[row]
        order = np.argsort(-np.abs(row_values))[:LOCAL_CONTRIBUTION_CAP]
        contributions: list[ShapContribution] = []
        for column_index in order:
            feature = features[int(column_index)]
            source = sources[feature]
            value = _scalar(raw[row].get(source)) if source is not None else None
            contributions.append(
                ShapContribution(
                    feature=feature,
                    value=value,
                    contribution=_round(_finite(row_values[int(column_index)])),
                )
            )
        explanations.append(
            LocalExplanation(
                row_index=row,
                prediction=_round(_finite(float(predictions[row]))),
                base_value=_round(_finite(float(base[row]))),
                contributions=contributions,
            )
        )
    return explanations


def build_report(
    *,
    explanation_id: str,
    benchmark_id: str,
    model: ModelResult,
    pipeline: Pipeline,
    frame: pl.DataFrame,
    partition: FeaturePartition,
    task: TaskType,
    sample_size: int,
    local_rows: int,
    seed: int = RANDOM_SEED,
) -> ExplanationReport:
    """Compute a bounded SHAP report for one persisted pipeline."""

    started = time.perf_counter()
    features = (
        partition.numeric
        + partition.low_cardinality_categorical
        + partition.high_cardinality_categorical
    )
    if not features:
        raise UnsupportedModelError("The run has no features to explain.")

    total_rows = frame.height
    sample_frame = (
        frame.sample(n=min(sample_size, SHAP_SAMPLE_CAP), seed=seed, shuffle=True)
        if total_rows > sample_size
        else frame
    )
    X_raw = sample_frame.select(features)
    preprocessor = pipeline.named_steps["preprocessor"]
    X_encoded = np.asarray(preprocessor.transform(X_raw), dtype=float)
    feature_names = _feature_names(preprocessor)

    background = X_encoded[: min(BACKGROUND_CAP, X_encoded.shape[0])]
    method = explainer_method(model.family)
    estimator = _unwrap(pipeline.named_steps["model"])
    explainer = _build_explainer(method, estimator, background)
    # Interventional tree SHAP can differ from the model output by float noise;
    # the additivity assertion is only a debugging aid.
    raw = (
        explainer(X_encoded, check_additivity=False)
        if method == "tree_shap"
        else explainer(X_encoded)
    )
    values = np.asarray(raw.values, dtype=float)
    base = np.asarray(raw.base_values, dtype=float)

    if task == TaskType.CLASSIFICATION:
        probabilities = np.asarray(pipeline.predict_proba(X_raw), dtype=float)
        class_count = probabilities.shape[1]
        values_3d, base_2d = _class_values(values, base, class_count)
        predicted_index = probabilities.argmax(axis=1)
        per_row_values = values_3d[np.arange(values_3d.shape[0]), :, predicted_index]
        per_row_base = base_2d[np.arange(base_2d.shape[0]), predicted_index]
        predictions = probabilities[np.arange(probabilities.shape[0]), predicted_index]
        importance_weights = np.abs(values_3d).mean(axis=(0, 2))
    else:
        if values.ndim == 3 and values.shape[2] == 1:
            values = values[:, :, 0]
        per_row_values = values
        per_row_base = _regression_base(base, values.shape[0])
        predictions = np.asarray(pipeline.predict(X_raw), dtype=float).reshape(-1)
        importance_weights = np.abs(values).mean(axis=0)

    order = np.argsort(-importance_weights)[:GLOBAL_IMPORTANCE_CAP]
    global_importance = [
        FeatureImportance(
            feature=feature_names[int(index)],
            mean_abs_shap=_round(_finite(float(importance_weights[int(index)]))),
            rank=rank,
        )
        for rank, index in enumerate(order, start=1)
    ]
    top_features = [feature_names[int(index)] for index in order[:SUMMARY_FEATURE_CAP]]

    warnings: list[ProfilingWarning] = []
    if sample_frame.height < total_rows:
        warnings.append(
            ProfilingWarning(
                code="shap_sample",
                severity="info",
                message=(
                    f"Explanations use a fixed-seed sample of {sample_frame.height} "
                    f"of {total_rows} rows."
                ),
            )
        )
    if len(order) < len(feature_names):
        warnings.append(
            ProfilingWarning(
                code="shap_feature_cap",
                severity="info",
                message=(
                    f"Global importance shows the top {len(order)} of "
                    f"{len(feature_names)} encoded features."
                ),
            )
        )

    report = ExplanationReport(
        explanation_id=explanation_id,
        benchmark_id=benchmark_id,
        model_id=model.model_id,
        method=method,
        sample_size=int(sample_frame.height),
        background_size=int(background.shape[0]),
        global_importance=global_importance,
        summary_points=_summary_points(
            per_row_values, feature_names, top_features, X_raw, partition
        ),
        local_explanations=_local_explanations(
            per_row_base,
            predictions,
            per_row_values,
            feature_names,
            X_raw,
            partition,
            local_rows,
        ),
        created_at=datetime.now(UTC),
        duration_ms=round((time.perf_counter() - started) * 1000, 3),
        warnings=warnings,
    )
    return report


class ExplanationService:
    """Coordinates SHAP jobs and their persisted reports."""

    def __init__(
        self,
        storage: Storage | None = None,
        job_store: JobStore | None = None,
        settings: Settings | None = None,
        dataset_service: DatasetService | None = None,
        benchmark_service: BenchmarkService | None = None,
    ) -> None:
        self._storage = storage or get_storage()
        self._jobs = job_store or get_job_store()
        self._settings = settings or get_settings()
        self._datasets = dataset_service or DatasetService(
            storage=self._storage,
            job_store=self._jobs,
            settings=self._settings,
        )
        self._benchmarks = benchmark_service or BenchmarkService(
            storage=self._storage,
            job_store=self._jobs,
            settings=self._settings,
            dataset_service=self._datasets,
        )

    def _explanation_path(self, benchmark_id: str, model_id: str) -> Path:
        return self._settings.benchmarks_dir / benchmark_id / "explanations" / f"{model_id}.json"

    def enqueue(
        self,
        benchmark_id: str,
        request: ExplanationCreateRequest,
    ) -> tuple[str, BenchmarkRun, ModelResult, JobRecord]:
        """Validate the request and create the explanation job."""

        run = self._benchmarks.get_benchmark(benchmark_id)
        if run.status != JobStatus.SUCCEEDED:
            raise BenchmarkNotReadyError(
                "Explanations are not available until the benchmark completes."
            )

        _require_id(request.model_id)
        model = next(
            (
                candidate
                for candidate in run.leaderboard
                if candidate.model_id == request.model_id and candidate.status == "succeeded"
            ),
            None,
        )
        if model is None:
            raise ModelNotFoundError(request.model_id)
        explainer_method(model.family)
        self._benchmarks.get_model_path(benchmark_id, request.model_id)

        explanation_id = uuid.uuid4().hex
        job = self._jobs.create(kind="explanation", dataset_id=run.dataset_id)
        return explanation_id, run, model, job

    def run_explanation(
        self,
        explanation_id: str,
        benchmark_id: str,
        model_id: str,
        job_id: str,
        sample_size: int,
        local_rows: int,
    ) -> None:
        """Background entrypoint: compute SHAP and persist the report."""

        try:
            self._jobs.update(job_id, status=JobStatus.RUNNING, stage="loading", progress=0.1)
            run = self._benchmarks.get_benchmark(benchmark_id)
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

            self._jobs.update(job_id, stage="sampling", progress=0.25)
            summary = self._datasets.get_dataset(run.dataset_id)
            frame = ingestion.load_dataset(
                self._datasets.dataset_file(run.dataset_id), summary.format
            )
            profile = self._datasets.get_profile(run.dataset_id)
            partition = partition_features(frame, run.target, run.excluded_features, profile)

            self._jobs.update(job_id, stage="explaining", progress=0.5)
            pipeline = joblib.load(self._benchmarks.get_model_path(benchmark_id, model_id))

            self._jobs.update(job_id, stage="summarising", progress=0.85)
            report = build_report(
                explanation_id=explanation_id,
                benchmark_id=benchmark_id,
                model=model,
                pipeline=pipeline,
                frame=frame,
                partition=partition,
                task=run.task_type,
                sample_size=sample_size,
                local_rows=local_rows,
                seed=run.random_state,
            )
            self._storage.write_text(
                self._explanation_path(benchmark_id, model_id),
                report.model_dump_json(),
            )

            self._jobs.succeed(
                job_id,
                {
                    "explanation_id": report.explanation_id,
                    "benchmark_id": benchmark_id,
                    "model_id": model_id,
                    "method": report.method,
                    "sample_size": report.sample_size,
                    "feature_count": len(report.global_importance),
                    "duration_ms": report.duration_ms,
                },
            )
        except Exception as exc:  # noqa: BLE001 - surfaced through the job
            self._jobs.fail(job_id, _safe_error(exc, self._settings))

    def get_report(self, benchmark_id: str, model_id: str) -> ExplanationReport:
        """Load a stored explanation, distinguishing missing from not-ready."""

        run = self._benchmarks.get_benchmark(benchmark_id)
        _require_id(model_id)
        if run.status != JobStatus.SUCCEEDED:
            raise BenchmarkNotReadyError(
                "Explanations are not available until the benchmark completes."
            )
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

        path = self._explanation_path(benchmark_id, model_id)
        if not self._storage.exists(path):
            raise ExplanationNotFoundError(model_id)
        try:
            return ExplanationReport.model_validate_json(self._storage.read_text(path))
        except ValueError as exc:
            raise ExplanationNotFoundError(model_id) from exc


__all__ = [
    "ExplanationNotFoundError",
    "ExplanationService",
    "UnsupportedModelError",
    "build_report",
    "explainer_method",
]
