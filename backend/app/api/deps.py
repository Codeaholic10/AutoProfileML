"""Shared API dependencies."""

from __future__ import annotations

from fastapi import Depends

from app.core.jobs import JobStore, get_job_store
from app.services.benchmarking import BenchmarkService
from app.services.explainability import ExplanationService
from app.services.export import ExportService
from app.storage.factory import get_storage


def get_benchmark_service(
    job_store: JobStore = Depends(get_job_store),
) -> BenchmarkService:
    """Wire the benchmark service with shared storage and job registry."""

    return BenchmarkService(storage=get_storage(), job_store=job_store)


def get_explanation_service(
    job_store: JobStore = Depends(get_job_store),
) -> ExplanationService:
    """Wire the explanation service with shared storage and job registry."""

    return ExplanationService(storage=get_storage(), job_store=job_store)


def get_export_service(
    job_store: JobStore = Depends(get_job_store),
) -> ExportService:
    """Wire the export service with shared storage and job registry."""

    return ExportService(storage=get_storage(), job_store=job_store)
