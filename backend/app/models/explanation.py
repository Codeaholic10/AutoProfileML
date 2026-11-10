"""Contracts for SHAP explanations (Phase 8)."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Literal

from pydantic import BaseModel, Field

from app.models.benchmark import TaskType
from app.models.schemas import JobRecord, ProfilingWarning


def _utcnow() -> datetime:
    return datetime.now(UTC)


class ExplanationCreateRequest(BaseModel):
    """User-supplied parameters for an explanation job."""

    model_id: str
    sample_size: int = Field(default=500, ge=50, le=1000)
    local_rows: int = Field(default=10, ge=1, le=25)


class FeatureImportance(BaseModel):
    """One feature's global importance, ranked by mean absolute SHAP."""

    feature: str
    mean_abs_shap: float
    rank: int


class ShapContribution(BaseModel):
    """One feature's signed contribution to a single row's prediction."""

    feature: str
    value: str | float | None = None
    contribution: float


class LocalExplanation(BaseModel):
    """Per-row explanation with the strongest signed contributions."""

    row_index: int
    prediction: float
    base_value: float
    contributions: list[ShapContribution] = Field(default_factory=list)


class ShapSummaryPoint(BaseModel):
    """One dot for the beeswarm: a sampled row's SHAP value for one feature."""

    feature: str
    feature_value: str | float | None = None
    shap_value: float


class ExplanationReport(BaseModel):
    """A persisted SHAP report for one benchmark model."""

    explanation_id: str
    benchmark_id: str
    model_id: str
    method: Literal["tree_shap", "linear_shap", "kernel_shap"]
    sample_size: int
    background_size: int
    global_importance: list[FeatureImportance] = Field(default_factory=list)
    summary_points: list[ShapSummaryPoint] = Field(default_factory=list)
    local_explanations: list[LocalExplanation] = Field(default_factory=list)
    created_at: datetime = Field(default_factory=_utcnow)
    duration_ms: float = 0.0
    warnings: list[ProfilingWarning] = Field(default_factory=list)


class ExplanationEnqueueResponse(BaseModel):
    """Response for a queued explanation job."""

    explanation_id: str
    benchmark_id: str
    model_id: str
    task_type: TaskType
    job: JobRecord
