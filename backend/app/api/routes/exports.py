"""Export endpoints."""

from __future__ import annotations

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, status
from fastapi.responses import FileResponse

from app.api.deps import get_export_service
from app.models.export import (
    ExportCreateRequest,
    ExportEnqueueResponse,
    ExportManifest,
)
from app.services.benchmarking import (
    BenchmarkNotFoundError,
    BenchmarkNotReadyError,
    ModelNotFoundError,
)
from app.services.export import (
    ExportNotFoundError,
    ExportService,
    ExportUnsupportedError,
)

router = APIRouter(prefix="/api", tags=["exports"])


@router.post(
    "/benchmarks/{benchmark_id}/exports",
    response_model=ExportEnqueueResponse,
    status_code=status.HTTP_202_ACCEPTED,
    summary="Queue a standalone export bundle for a benchmark model",
)
async def create_export(
    benchmark_id: str,
    payload: ExportCreateRequest,
    background_tasks: BackgroundTasks,
    service: ExportService = Depends(get_export_service),
) -> ExportEnqueueResponse:
    """Validate the request and build the bundle in the background."""

    try:
        export_id, run, model, job = service.enqueue(benchmark_id, payload)
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
    except ExportUnsupportedError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    background_tasks.add_task(
        service.run_export,
        export_id,
        benchmark_id,
        model.model_id,
        job.job_id,
    )
    return ExportEnqueueResponse(
        export_id=export_id,
        benchmark_id=benchmark_id,
        model_id=model.model_id,
        task_type=run.task_type,
        job=job,
    )


@router.get(
    "/benchmarks/{benchmark_id}/exports/{model_id}",
    response_model=ExportManifest,
    summary="Stored export manifest for a benchmark model",
)
async def get_export(
    benchmark_id: str,
    model_id: str,
    service: ExportService = Depends(get_export_service),
) -> ExportManifest:
    """Return the manifest for a generated bundle."""

    try:
        return service.get_manifest(benchmark_id, model_id)
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
    except ExportNotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Export not found."
        ) from exc


@router.get(
    "/benchmarks/{benchmark_id}/exports/{model_id}/download",
    response_class=FileResponse,
    summary="Download the export ZIP bundle",
)
async def download_export(
    benchmark_id: str,
    model_id: str,
    service: ExportService = Depends(get_export_service),
) -> FileResponse:
    """Serve the generated ZIP with a server-derived filename."""

    try:
        download = service.get_download(benchmark_id, model_id)
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
    except ExportNotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Export not found."
        ) from exc

    return FileResponse(
        download.path,
        media_type="application/zip",
        filename=download.filename,
    )
