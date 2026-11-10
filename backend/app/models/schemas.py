"""Pydantic models shared by the API, services and the frontend contract."""

from __future__ import annotations

from datetime import UTC, datetime
from enum import StrEnum
from typing import Any, Literal

from pydantic import BaseModel, Field


def _utcnow() -> datetime:
    return datetime.now(UTC)


class JobStatus(StrEnum):
    """Lifecycle of an asynchronous job."""

    QUEUED = "queued"
    RUNNING = "running"
    SUCCEEDED = "succeeded"
    FAILED = "failed"


class DatasetSummary(BaseModel):
    """Metadata describing an uploaded dataset."""

    dataset_id: str
    filename: str
    format: Literal["csv", "parquet"]
    size_bytes: int
    uploaded_at: datetime = Field(default_factory=_utcnow)
    row_count: int | None = None
    column_count: int | None = None


class ColumnProfile(BaseModel):
    """Per-column statistical profile."""

    name: str
    dtype: str
    semantic_type: Literal["numeric", "categorical", "boolean", "temporal", "unknown"]
    null_count: int
    null_percentage: float
    unique_count: int
    is_constant: bool = False
    mean: float | None = None
    std: float | None = None
    minimum: float | None = None
    maximum: float | None = None
    q1: float | None = None
    median: float | None = None
    q3: float | None = None
    skewness: float | None = None
    kurtosis: float | None = None
    top_values: list[TopValue] = Field(default_factory=list)


class TopValue(BaseModel):
    """Most frequent value in a categorical column."""

    value: str
    count: int
    percentage: float


class CollinearityFinding(BaseModel):
    """Variance inflation factor result for a numeric column."""

    feature: str
    vif: float
    severity: Literal["ok", "moderate", "severe"]
    correlated_with: str | None = None


class ProfilingWarning(BaseModel):
    """Human readable data-quality warning raised during profiling."""

    code: str
    severity: Literal["info", "warning", "critical"]
    column: str | None = None
    message: str


class CorrelationMatrix(BaseModel):
    """Pearson correlation matrix for the numeric features."""

    features: list[str]
    values: list[list[float]]


class ProfileReport(BaseModel):
    """Full profiling payload returned to the frontend."""

    dataset_id: str
    row_count: int
    column_count: int
    memory_bytes: int
    duplicate_rows: int
    duplicate_percentage: float
    generated_at: datetime = Field(default_factory=_utcnow)
    duration_ms: float
    numeric_columns: int
    categorical_columns: int
    columns: list[ColumnProfile]
    collinearity: list[CollinearityFinding] = Field(default_factory=list)
    correlation: CorrelationMatrix | None = None
    warnings: list[ProfilingWarning] = Field(default_factory=list)


class JobRecord(BaseModel):
    """State of an asynchronous job, polled by the frontend."""

    job_id: str
    kind: Literal["profiling", "benchmark"]
    status: JobStatus = JobStatus.QUEUED
    progress: float = 0.0
    stage: str = "queued"
    dataset_id: str | None = None
    created_at: datetime = Field(default_factory=_utcnow)
    updated_at: datetime = Field(default_factory=_utcnow)
    error: str | None = None
    result: dict[str, Any] | None = None


class DatasetUploadResponse(BaseModel):
    """Response for a successful dataset upload."""

    dataset: DatasetSummary
    job: JobRecord


class DatasetListItem(BaseModel):
    """Compact dataset representation for listing endpoints."""

    dataset: DatasetSummary
    has_profile: bool
    latest_job: JobRecord | None = None
