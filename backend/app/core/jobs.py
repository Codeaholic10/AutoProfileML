"""In-process asynchronous job registry.

Phase 1 runs jobs as FastAPI background tasks and keeps their state in memory.
The public surface (`create`, `update`, `get`, `list`) is deliberately small so
this module can later be replaced by a Celery/Redis backed implementation
without touching the API layer.
"""

from __future__ import annotations

import threading
import uuid
from datetime import UTC, datetime
from typing import Any

from app.models.schemas import JobRecord, JobStatus


def _utcnow() -> datetime:
    return datetime.now(UTC)


class JobStore:
    """Thread-safe, process-local job registry."""

    def __init__(self, retention_seconds: int = 60 * 60 * 6) -> None:
        self._jobs: dict[str, JobRecord] = {}
        self._lock = threading.Lock()
        self._retention_seconds = retention_seconds

    def create(
        self,
        kind: str,
        dataset_id: str | None = None,
        stage: str = "queued",
    ) -> JobRecord:
        """Register a new queued job and return its record."""

        job = JobRecord(
            job_id=uuid.uuid4().hex,
            kind=kind,  # type: ignore[arg-type]
            dataset_id=dataset_id,
            stage=stage,
        )
        with self._lock:
            self._purge_locked()
            self._jobs[job.job_id] = job
        return job

    def get(self, job_id: str) -> JobRecord | None:
        """Return a snapshot of a job, if it is still retained."""

        with self._lock:
            job = self._jobs.get(job_id)
            return job.model_copy() if job else None

    def list(self, dataset_id: str | None = None) -> list[JobRecord]:
        """Return all retained jobs, optionally filtered by dataset."""

        with self._lock:
            jobs = [
                job.model_copy()
                for job in self._jobs.values()
                if dataset_id is None or job.dataset_id == dataset_id
            ]
        return sorted(jobs, key=lambda job: job.created_at)

    def latest_for_dataset(self, dataset_id: str) -> JobRecord | None:
        """Return the most recent job for a dataset."""

        jobs = self.list(dataset_id)
        return jobs[-1] if jobs else None

    def update(
        self,
        job_id: str,
        *,
        status: JobStatus | None = None,
        progress: float | None = None,
        stage: str | None = None,
        error: str | None = None,
        result: dict[str, Any] | None = None,
    ) -> JobRecord | None:
        """Patch a job record and return the updated snapshot."""

        with self._lock:
            job = self._jobs.get(job_id)
            if job is None:
                return None
            if status is not None:
                job.status = status
            if progress is not None:
                job.progress = max(0.0, min(1.0, progress))
            if stage is not None:
                job.stage = stage
            if error is not None:
                job.error = error
            if result is not None:
                job.result = result
            job.updated_at = _utcnow()
            return job.model_copy()

    def fail(self, job_id: str, error: str) -> JobRecord | None:
        """Mark a job as failed with an error message."""

        return self.update(job_id, status=JobStatus.FAILED, stage="failed", error=error)

    def succeed(self, job_id: str, result: dict[str, Any]) -> JobRecord | None:
        """Mark a job as succeeded with its result payload."""

        return self.update(
            job_id,
            status=JobStatus.SUCCEEDED,
            progress=1.0,
            stage="completed",
            result=result,
        )

    def _purge_locked(self) -> None:
        """Drop jobs that exceeded the retention window. Caller holds the lock."""

        cutoff = _utcnow().timestamp() - self._retention_seconds
        expired = [
            job_id for job_id, job in self._jobs.items() if job.updated_at.timestamp() < cutoff
        ]
        for job_id in expired:
            del self._jobs[job_id]


_store: JobStore | None = None


def get_job_store() -> JobStore:
    """Return the process-wide job store."""

    global _store
    if _store is None:
        from app.core.config import get_settings

        _store = JobStore(retention_seconds=get_settings().job_retention_seconds)
    return _store
