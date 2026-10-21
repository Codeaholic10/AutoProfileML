"""Integration tests for the dataset API."""

from __future__ import annotations

import polars as pl
import pytest
from fastapi.testclient import TestClient

from app.api.routes import datasets as dataset_routes
from app.core.jobs import get_job_store
from app.main import create_app
from app.storage.factory import get_storage
from tests.conftest import build_frame


@pytest.fixture
def client(settings, storage, job_store, service) -> TestClient:
    """TestClient wired to isolated storage and an in-memory job store."""

    app = create_app()
    app.dependency_overrides[get_storage] = lambda: storage
    app.dependency_overrides[get_job_store] = lambda: job_store
    app.dependency_overrides[dataset_routes.get_dataset_service] = lambda: service
    return TestClient(app)


def _upload(client: TestClient, frame: pl.DataFrame, filename: str = "sample.csv"):
    payload = frame.write_csv().encode("utf-8")
    return client.post("/api/datasets", files={"file": (filename, payload, "text/csv")})


def test_health(client: TestClient) -> None:
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"


def test_upload_profiles_dataset_end_to_end(client: TestClient) -> None:
    frame = build_frame(rows=300)
    upload = _upload(client, frame)
    assert upload.status_code == 202

    payload = upload.json()
    dataset_id = payload["dataset"]["dataset_id"]
    job_id = payload["job"]["job_id"]
    assert payload["dataset"]["format"] == "csv"

    job = client.get(f"/api/jobs/{job_id}")
    assert job.status_code == 200
    assert job.json()["status"] == "succeeded"
    assert job.json()["progress"] == 1.0

    profile = client.get(f"/api/datasets/{dataset_id}/profile")
    assert profile.status_code == 200
    body = profile.json()
    assert body["row_count"] == frame.height
    assert body["column_count"] == frame.width
    assert len(body["columns"]) == frame.width

    dataset = client.get(f"/api/datasets/{dataset_id}")
    assert dataset.status_code == 200
    assert dataset.json()["row_count"] == frame.height


def test_parquet_upload_is_supported(client: TestClient, tmp_path) -> None:
    frame = build_frame(rows=150)
    path = tmp_path / "sample.parquet"
    frame.write_parquet(path)

    response = client.post(
        "/api/datasets",
        files={"file": ("sample.parquet", path.read_bytes(), "application/octet-stream")},
    )
    assert response.status_code == 202
    assert response.json()["dataset"]["format"] == "parquet"


def test_upload_rejects_unsupported_type(client: TestClient) -> None:
    response = client.post("/api/datasets", files={"file": ("notes.txt", b"hello", "text/plain")})
    assert response.status_code == 415


def test_upload_rejects_oversized_file(client: TestClient, settings) -> None:
    oversized = b"a,b\n" + b"1,2\n" * (settings.max_upload_bytes // 3)
    response = client.post("/api/datasets", files={"file": ("big.csv", oversized, "text/csv")})
    assert response.status_code == 413


def test_upload_rejects_empty_file(client: TestClient) -> None:
    response = client.post("/api/datasets", files={"file": ("empty.csv", b"", "text/csv")})
    assert response.status_code == 400
    assert response.json()["detail"] == "Uploaded file is empty."
    assert client.get("/api/datasets").json() == []


def test_profile_conflicts_until_ready(client: TestClient, service, csv_bytes) -> None:
    dataset_id = "pending-dataset"
    service.save_upload(dataset_id, "pending.csv", csv_bytes)

    response = client.get(f"/api/datasets/{dataset_id}/profile")
    assert response.status_code == 409


def test_unknown_dataset_returns_404(client: TestClient) -> None:
    assert client.get("/api/datasets/missing").status_code == 404
    assert client.get("/api/datasets/missing/profile").status_code == 404
    assert client.get("/api/jobs/missing").status_code == 404
    assert client.post("/api/datasets/missing/profile").status_code == 404


def test_dataset_listing_reports_profile_availability(client: TestClient) -> None:
    upload = _upload(client, build_frame(rows=120))
    dataset_id = upload.json()["dataset"]["dataset_id"]

    listing = client.get("/api/datasets")
    assert listing.status_code == 200
    entries = {item["dataset"]["dataset_id"]: item for item in listing.json()}
    assert entries[dataset_id]["has_profile"] is True
    assert entries[dataset_id]["latest_job"]["status"] == "succeeded"


def test_reprofiling_creates_new_job(client: TestClient, service, csv_bytes) -> None:
    dataset_id = "reprofile-dataset"
    service.save_upload(dataset_id, "data.csv", csv_bytes)

    response = client.post(f"/api/datasets/{dataset_id}/profile")
    assert response.status_code == 202

    jobs = client.get(f"/api/datasets/{dataset_id}/jobs")
    assert jobs.status_code == 200
    assert len(jobs.json()) >= 1


def test_profiling_failure_is_surfaced(service, storage) -> None:
    dataset_id = "broken-dataset"
    service.save_upload(dataset_id, "broken.csv", b"a,b\n1,2\n")

    path = service.dataset_file(dataset_id)
    storage.write_bytes(path, b'not,a,valid\n"unterminated')

    job = service._jobs.create(kind="profiling", dataset_id=dataset_id)
    service.run_profiling(job.job_id, dataset_id)

    record = service._jobs.get(job.job_id)
    assert record is not None
    assert record.status.value == "failed"
    assert record.error
