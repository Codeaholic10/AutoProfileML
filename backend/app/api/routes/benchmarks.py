"""Benchmark endpoints."""

from __future__ import annotations

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, status

from app.api.deps import get_benchmark_service
from app.models.benchmark import (
    BenchmarkCreateRequest,
    BenchmarkEnqueueResponse,
    BenchmarkRun,
    BenchmarkSummary,
    OutOfFoldPredictions,
)
from app.services.benchmarking import (
    BenchmarkNotFoundError,
    BenchmarkNotReadyError,
    BenchmarkService,
    PredictionNotFoundError,
    PredictionsUnsupportedError,
)
from app.services.datasets import DatasetNotFoundError

router = APIRouter(prefix="/api", tags=["benchmarks"])


@router.post(
    "/datasets/{dataset_id}/benchmarks",
    response_model=BenchmarkEnqueueResponse,
    status_code=status.HTTP_202_ACCEPTED,
    summary="Queue a benchmark run for a target column",
)
async def create_benchmark(
    dataset_id: str,
    payload: BenchmarkCreateRequest,
    background_tasks: BackgroundTasks,
    service: BenchmarkService = Depends(get_benchmark_service),
) -> BenchmarkEnqueueResponse:
    """Validate the request, persist a queued run and start it in the background."""

    try:
        run, job = service.enqueue(dataset_id, payload)
    except DatasetNotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Dataset not found."
        ) from exc
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    background_tasks.add_task(service.run_benchmark, run.benchmark_id, job.job_id)
    return BenchmarkEnqueueResponse(benchmark=run, job=job)


@router.get(
    "/datasets/{dataset_id}/benchmarks",
    response_model=list[BenchmarkSummary],
    summary="Benchmark history for a dataset",
)
async def list_benchmarks(
    dataset_id: str,
    service: BenchmarkService = Depends(get_benchmark_service),
) -> list[BenchmarkSummary]:
    """Return benchmark summaries for a dataset, newest first."""

    try:
        return service.list_benchmarks(dataset_id)
    except DatasetNotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Dataset not found."
        ) from exc


@router.get(
    "/benchmarks/{benchmark_id}",
    response_model=BenchmarkRun,
    summary="Benchmark run and leaderboard",
)
async def get_benchmark(
    benchmark_id: str,
    service: BenchmarkService = Depends(get_benchmark_service),
) -> BenchmarkRun:
    """Return the persisted run document, including its leaderboard."""

    try:
        return service.get_benchmark(benchmark_id)
    except BenchmarkNotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Benchmark not found."
        ) from exc


@router.get(
    "/benchmarks/{benchmark_id}/models/{model_id}/predictions",
    response_model=OutOfFoldPredictions,
    summary="Out-of-fold predictions for a benchmark model",
)
async def get_predictions(
    benchmark_id: str,
    model_id: str,
    service: BenchmarkService = Depends(get_benchmark_service),
) -> OutOfFoldPredictions:
    """Return persisted out-of-fold predictions for a classification model."""

    try:
        return service.get_oof_predictions(benchmark_id, model_id)
    except BenchmarkNotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Benchmark not found."
        ) from exc
    except PredictionNotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Predictions not found."
        ) from exc
    except BenchmarkNotReadyError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc
    except PredictionsUnsupportedError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
