"""Dataset upload, listing, profiling and job status endpoints."""

from __future__ import annotations

import uuid

from fastapi import (
    APIRouter,
    BackgroundTasks,
    Depends,
    File,
    HTTPException,
    Response,
    UploadFile,
    status,
)

from app.core.jobs import JobStore, get_job_store
from app.models.schemas import (
    DatasetListItem,
    DatasetSummary,
    DatasetUploadResponse,
    JobRecord,
    ProfileReport,
)
from app.services import ingestion
from app.services.datasets import (
    DatasetNotFoundError,
    DatasetService,
    ProfileNotFoundError,
)
from app.storage.factory import get_storage

router = APIRouter(prefix="/api", tags=["datasets"])


def get_dataset_service(job_store: JobStore = Depends(get_job_store)) -> DatasetService:
    """Wire the dataset service with shared storage and job registry."""

    return DatasetService(storage=get_storage(), job_store=job_store)


@router.post(
    "/datasets",
    response_model=DatasetUploadResponse,
    status_code=status.HTTP_202_ACCEPTED,
    summary="Upload a dataset and start profiling",
)
async def upload_dataset(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    service: DatasetService = Depends(get_dataset_service),
    jobs: JobStore = Depends(get_job_store),
) -> DatasetUploadResponse:
    """Store an uploaded CSV/Parquet file and queue a profiling job."""

    filename = file.filename or "dataset"
    try:
        ingestion.detect_format(filename)
    except ingestion.UnsupportedDatasetError as exc:
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, detail=str(exc)
        ) from exc

    payload = await file.read()
    await file.close()

    dataset_id = uuid.uuid4().hex
    try:
        summary = service.save_upload(dataset_id, filename, payload)
    except ingestion.InvalidDatasetError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except ingestion.UnsupportedDatasetError as exc:
        raise HTTPException(status_code=status.HTTP_413_CONTENT_TOO_LARGE, detail=str(exc)) from exc

    job = jobs.create(kind="profiling", dataset_id=dataset_id)
    background_tasks.add_task(service.run_profiling, job.job_id, dataset_id)
    return DatasetUploadResponse(dataset=summary, job=job)


@router.get(
    "/datasets",
    response_model=list[DatasetListItem],
    summary="List datasets",
)
async def list_datasets(
    service: DatasetService = Depends(get_dataset_service),
) -> list[DatasetListItem]:
    """Return every known dataset with profile availability and latest job."""

    return service.list_datasets()


@router.get(
    "/datasets/{dataset_id}",
    response_model=DatasetSummary,
    summary="Dataset metadata",
)
async def get_dataset(
    dataset_id: str,
    service: DatasetService = Depends(get_dataset_service),
) -> DatasetSummary:
    """Return metadata for a single dataset."""

    try:
        return service.get_dataset(dataset_id)
    except DatasetNotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Dataset not found."
        ) from exc


@router.delete(
    "/datasets/{dataset_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete a dataset",
)
async def delete_dataset(
    dataset_id: str,
    service: DatasetService = Depends(get_dataset_service),
) -> Response:
    """Delete a dataset, its metadata and any stored profile."""

    try:
        service.delete_dataset(dataset_id)
    except DatasetNotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Dataset not found."
        ) from exc
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get(
    "/datasets/{dataset_id}/profile",
    response_model=ProfileReport,
    summary="Dataset profile report",
)
async def get_profile(
    dataset_id: str,
    service: DatasetService = Depends(get_dataset_service),
) -> ProfileReport:
    """Return the stored profile report, or 409 while it is still being computed."""

    try:
        return service.get_profile(dataset_id)
    except DatasetNotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Dataset not found."
        ) from exc
    except ProfileNotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Profile not available yet. Poll the job status endpoint.",
        ) from exc


@router.post(
    "/datasets/{dataset_id}/profile",
    response_model=JobRecord,
    status_code=status.HTTP_202_ACCEPTED,
    summary="Re-run profiling for a dataset",
)
async def reprofile_dataset(
    dataset_id: str,
    background_tasks: BackgroundTasks,
    service: DatasetService = Depends(get_dataset_service),
    jobs: JobStore = Depends(get_job_store),
) -> JobRecord:
    """Queue a fresh profiling job for an already uploaded dataset."""

    try:
        service.get_dataset(dataset_id)
    except DatasetNotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Dataset not found."
        ) from exc

    job = jobs.create(kind="profiling", dataset_id=dataset_id)
    background_tasks.add_task(service.run_profiling, job.job_id, dataset_id)
    return job


@router.get("/jobs/{job_id}", response_model=JobRecord, summary="Job status")
async def get_job(job_id: str, jobs: JobStore = Depends(get_job_store)) -> JobRecord:
    """Return the current state of an asynchronous job."""

    job = jobs.get(job_id)
    if job is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Job not found.")
    return job


@router.get(
    "/datasets/{dataset_id}/jobs",
    response_model=list[JobRecord],
    summary="Jobs for a dataset",
)
async def list_dataset_jobs(
    dataset_id: str,
    jobs: JobStore = Depends(get_job_store),
) -> list[JobRecord]:
    """Return the job history for a dataset."""

    return jobs.list(dataset_id)
