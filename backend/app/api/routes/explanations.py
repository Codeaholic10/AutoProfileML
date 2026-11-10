"""Explanation endpoints."""

from __future__ import annotations

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, status

from app.api.deps import get_explanation_service
from app.models.explanation import (
    ExplanationCreateRequest,
    ExplanationEnqueueResponse,
    ExplanationReport,
)
from app.services.benchmarking import (
    BenchmarkNotFoundError,
    BenchmarkNotReadyError,
    ModelNotFoundError,
)
from app.services.explainability import (
    ExplanationNotFoundError,
    ExplanationService,
    UnsupportedModelError,
)

router = APIRouter(prefix="/api", tags=["explanations"])


@router.post(
    "/benchmarks/{benchmark_id}/explanations",
    response_model=ExplanationEnqueueResponse,
    status_code=status.HTTP_202_ACCEPTED,
    summary="Queue a SHAP explanation for a benchmark model",
)
async def create_explanation(
    benchmark_id: str,
    payload: ExplanationCreateRequest,
    background_tasks: BackgroundTasks,
    service: ExplanationService = Depends(get_explanation_service),
) -> ExplanationEnqueueResponse:
    """Validate the request and start the explanation in the background."""

    try:
        explanation_id, run, model, job = service.enqueue(benchmark_id, payload)
    except BenchmarkNotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Benchmark not found."
        ) from exc
    except ModelNotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Model not found."
        ) from exc
    except BenchmarkNotReadyError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc
    except UnsupportedModelError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    background_tasks.add_task(
        service.run_explanation,
        explanation_id,
        benchmark_id,
        payload.model_id,
        job.job_id,
        payload.sample_size,
        payload.local_rows,
    )
    return ExplanationEnqueueResponse(
        explanation_id=explanation_id,
        benchmark_id=benchmark_id,
        model_id=payload.model_id,
        task_type=run.task_type,
        job=job,
    )


@router.get(
    "/benchmarks/{benchmark_id}/explanations/{model_id}",
    response_model=ExplanationReport,
    summary="Stored SHAP explanation for a benchmark model",
)
async def get_explanation(
    benchmark_id: str,
    model_id: str,
    service: ExplanationService = Depends(get_explanation_service),
) -> ExplanationReport:
    """Return the persisted SHAP report for a model."""

    try:
        return service.get_report(benchmark_id, model_id)
    except BenchmarkNotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Benchmark not found."
        ) from exc
    except ModelNotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Model not found."
        ) from exc
    except BenchmarkNotReadyError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc
    except ExplanationNotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Explanation not found."
        ) from exc
