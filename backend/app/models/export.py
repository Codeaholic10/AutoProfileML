"""Contracts for the P1 export bundle."""

from __future__ import annotations

from datetime import UTC, datetime

from pydantic import BaseModel, Field

from app.models.benchmark import TaskType
from app.models.schemas import JobRecord


def _utcnow() -> datetime:
    return datetime.now(UTC)


class ExportCreateRequest(BaseModel):
    """User-supplied parameters for an export."""

    model_id: str


class ExportEnqueueResponse(BaseModel):
    """Response for a queued export job."""

    export_id: str
    benchmark_id: str
    model_id: str
    task_type: TaskType
    job: JobRecord


class ExportFile(BaseModel):
    """One file inside the exported archive."""

    name: str
    size_bytes: int


class ExportManifest(BaseModel):
    """Metadata for a generated export bundle."""

    export_id: str
    benchmark_id: str
    model_id: str
    target: str
    task_type: TaskType
    model_name: str
    files: list[ExportFile] = Field(default_factory=list)
    size_bytes: int = 0
    includes_onnx: bool = False
    onnx_note: str | None = None
    created_at: datetime = Field(default_factory=_utcnow)
    duration_ms: float = 0.0
