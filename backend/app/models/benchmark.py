"""Contracts for benchmarking and the preprocessing plan (Phases 6–8)."""

from __future__ import annotations

from datetime import UTC, datetime
from enum import StrEnum
from typing import Literal

from pydantic import BaseModel, Field

from app.models.schemas import JobStatus


def _utcnow() -> datetime:
    return datetime.now(UTC)


class TaskType(StrEnum):
    """Supervised task inferred from the target or chosen by the user."""

    CLASSIFICATION = "classification"
    REGRESSION = "regression"


class BenchmarkCreateRequest(BaseModel):
    """User-supplied parameters for a benchmark run."""

    target: str
    task_type: TaskType | None = None  # None → infer and return the decision
    excluded_features: list[str] = Field(default_factory=list)
    folds: int = Field(default=5, ge=3, le=10)
    random_state: int = 42


class PreprocessingStep(BaseModel):
    """One inspectable step of the fitted preprocessing pipeline."""

    kind: Literal[
        "numeric_impute",
        "categorical_impute",
        "iqr_clip",
        "one_hot_encode",
        "target_encode",
        "standard_scale",
        "drop",
    ]
    columns: list[str]
    strategy: str | None = None
    parameters: dict[str, float | int | str | bool] = Field(default_factory=dict)


class PreprocessingPlan(BaseModel):
    """What the preprocessing pipeline did, derived from the fitted object."""

    numeric_features: list[str]
    categorical_features: list[str]
    excluded_features: list[str]
    target_encoding: list[str]
    one_hot_encoding: list[str]
    steps: list[PreprocessingStep]
    notes: list[str]


class FeaturePartition(BaseModel):
    """Feature groups decided before the sklearn pipeline is built."""

    target: str
    numeric: list[str] = Field(default_factory=list)
    low_cardinality_categorical: list[str] = Field(default_factory=list)
    high_cardinality_categorical: list[str] = Field(default_factory=list)
    dropped_constant: list[str] = Field(default_factory=list)
    dropped_all_null: list[str] = Field(default_factory=list)
    dropped_unsupported: list[str] = Field(default_factory=list)
    excluded: list[str] = Field(default_factory=list)


class ModelResult(BaseModel):
    """Placeholder for one model's cross-validated result (filled in Phase 7)."""

    model_id: str
    name: str
    family: Literal["linear", "random_forest", "lightgbm", "xgboost"]
    status: Literal["succeeded", "failed"]
    metrics: dict[str, float] = Field(default_factory=dict)
    metric_std: dict[str, float] = Field(default_factory=dict)
    training_seconds: float = 0.0
    rank: int | None = None
    hyperparameters: dict[str, float | int | str | bool | None] = Field(default_factory=dict)
    error: str | None = None


class BenchmarkRun(BaseModel):
    """Placeholder for a persisted benchmark document (filled in Phase 7)."""

    benchmark_id: str
    dataset_id: str
    target: str
    task_type: TaskType
    task_detection_reason: str
    status: JobStatus = JobStatus.QUEUED
    folds: int = 5
    random_state: int = 42
    sample_rows: int | None = None
    class_support: dict[str, int] = Field(default_factory=dict)
    created_at: datetime = Field(default_factory=_utcnow)
    updated_at: datetime = Field(default_factory=_utcnow)
    preprocessing: PreprocessingPlan | None = None
    leaderboard: list[ModelResult] = Field(default_factory=list)
    best_model_id: str | None = None
    error: str | None = None
