"""Shared API dependencies."""

from __future__ import annotations

from fastapi import Depends

from app.core.jobs import JobStore, get_job_store
from app.services.benchmarking import BenchmarkService
from app.storage.factory import get_storage


def get_benchmark_service(
    job_store: JobStore = Depends(get_job_store),
) -> BenchmarkService:
    """Wire the benchmark service with shared storage and job registry."""

    return BenchmarkService(storage=get_storage(), job_store=job_store)
