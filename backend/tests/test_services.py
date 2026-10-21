"""Tests for ingestion and dataset services."""

from __future__ import annotations

import polars as pl
import pytest

from app.services import ingestion
from app.services.datasets import DatasetNotFoundError, DatasetService, ProfileNotFoundError


@pytest.mark.parametrize(
    ("filename", "expected"),
    [
        ("data.csv", "csv"),
        ("DATA.CSV", "csv"),
        ("data.parquet", "parquet"),
        ("data.pq", "parquet"),
    ],
)
def test_detect_format(filename: str, expected: str) -> None:
    assert ingestion.detect_format(filename) == expected


def test_detect_format_rejects_unknown() -> None:
    with pytest.raises(ingestion.UnsupportedDatasetError):
        ingestion.detect_format("data.xlsx")


def test_validate_upload_size_bounds() -> None:
    with pytest.raises(ingestion.InvalidDatasetError):
        ingestion.validate_upload_size(0, 1024)
    with pytest.raises(ingestion.UnsupportedDatasetError) as oversized:
        ingestion.validate_upload_size(2048, 1024)
    assert not isinstance(oversized.value, ingestion.InvalidDatasetError)
    ingestion.validate_upload_size(1024, 1024)


def test_collect_shape_matches_frame(tmp_path, sample_frame: pl.DataFrame) -> None:
    path = tmp_path / "frame.csv"
    sample_frame.write_csv(path)

    rows, columns = ingestion.collect_shape(path, "csv")
    assert rows == sample_frame.height
    assert columns == sample_frame.width


def test_parquet_round_trip(tmp_path, sample_frame: pl.DataFrame) -> None:
    path = tmp_path / "frame.parquet"
    sample_frame.write_parquet(path)

    loaded = ingestion.load_dataset(path, "parquet")
    assert loaded.height == sample_frame.height


def test_service_persists_and_reads_profile(service: DatasetService, csv_bytes: bytes) -> None:
    dataset_id = "svc-dataset"
    summary = service.save_upload(dataset_id, "data.csv", csv_bytes)
    assert summary.filename == "data.csv"

    job = service._jobs.create(kind="profiling", dataset_id=dataset_id)
    service.run_profiling(job.job_id, dataset_id)

    record = service._jobs.get(job.job_id)
    assert record is not None and record.status.value == "succeeded"

    profile = service.get_profile(dataset_id)
    assert profile.dataset_id == dataset_id
    assert service.has_profile(dataset_id) is True
    assert service.get_dataset(dataset_id).row_count == profile.row_count


def test_service_raises_for_unknown_dataset(service: DatasetService) -> None:
    with pytest.raises(DatasetNotFoundError):
        service.get_dataset("nope")
    with pytest.raises(DatasetNotFoundError):
        service.get_profile("nope")
    assert service.has_profile("nope") is False


def test_service_raises_when_profile_pending(service: DatasetService, csv_bytes: bytes) -> None:
    service.save_upload("pending", "data.csv", csv_bytes)

    with pytest.raises(ProfileNotFoundError):
        service.get_profile("pending")


def test_failed_reprofile_preserves_dataset_shape_and_profile(
    service: DatasetService, storage, csv_bytes: bytes
) -> None:
    dataset_id = "stable-dataset"
    service.save_upload(dataset_id, "data.csv", csv_bytes)
    first_job = service._jobs.create(kind="profiling", dataset_id=dataset_id)
    service.run_profiling(first_job.job_id, dataset_id)

    before_summary = service.get_dataset(dataset_id)
    before_profile = service.get_profile(dataset_id)
    assert before_summary.row_count == before_profile.row_count

    storage.write_bytes(service.dataset_file(dataset_id), b'not,a,valid\n"unterminated')
    failing_job = service._jobs.create(kind="profiling", dataset_id=dataset_id)
    service.run_profiling(failing_job.job_id, dataset_id)

    record = service._jobs.get(failing_job.job_id)
    assert record is not None and record.status.value == "failed"
    assert record.error and record.error.startswith("Could not profile 'data.csv':")

    after_summary = service.get_dataset(dataset_id)
    after_profile = service.get_profile(dataset_id)
    assert (after_summary.row_count, after_summary.column_count) == (
        before_summary.row_count,
        before_summary.column_count,
    )
    assert after_profile.model_dump() == before_profile.model_dump()


def test_failure_message_does_not_expose_storage_paths(
    service: DatasetService, settings, storage, csv_bytes: bytes
) -> None:
    dataset_id = "path-dataset"
    service.save_upload(dataset_id, "data.csv", csv_bytes)
    storage.write_bytes(service.dataset_file(dataset_id), b'not,a,valid\n"unterminated')

    job = service._jobs.create(kind="profiling", dataset_id=dataset_id)
    service.run_profiling(job.job_id, dataset_id)

    record = service._jobs.get(job.job_id)
    assert record is not None
    assert str(settings.storage_root.resolve()) not in (record.error or "")


def test_run_profiling_stores_shape_and_report_together(
    service: DatasetService, csv_bytes: bytes
) -> None:
    dataset_id = "fresh-dataset"
    service.save_upload(dataset_id, "data.csv", csv_bytes)

    job = service._jobs.create(kind="profiling", dataset_id=dataset_id)
    service.run_profiling(job.job_id, dataset_id)

    summary = service.get_dataset(dataset_id)
    profile = service.get_profile(dataset_id)
    assert (summary.row_count, summary.column_count) == (
        profile.row_count,
        profile.column_count,
    )


def test_job_store_records_failure(service: DatasetService) -> None:
    job = service._jobs.create(kind="profiling", dataset_id="ghost")
    service.run_profiling(job.job_id, "ghost")

    record = service._jobs.get(job.job_id)
    assert record is not None
    assert record.status.value == "failed"
    assert "DatasetNotFoundError" in (record.error or "")


def test_job_store_progress_is_clamped() -> None:
    from app.core.jobs import JobStore

    store = JobStore()
    job = store.create(kind="profiling")

    assert store.update(job.job_id, progress=5.0).progress == 1.0
    assert store.update(job.job_id, progress=-3.0).progress == 0.0
    assert store.get("missing") is None
