"""Hardening tests: startup lifecycle, traversal safety, and bad uploads."""

from __future__ import annotations

import warnings

import pytest
from fastapi.testclient import TestClient

from app.api.routes import datasets as dataset_routes
from app.core.jobs import get_job_store
from app.main import create_app
from app.services.datasets import DatasetNotFoundError
from app.storage.factory import get_storage
from tests.conftest import build_frame


@pytest.fixture
def client(settings, storage, job_store, service) -> TestClient:
    app = create_app()
    app.dependency_overrides[get_storage] = lambda: storage
    app.dependency_overrides[get_job_store] = lambda: job_store
    app.dependency_overrides[dataset_routes.get_dataset_service] = lambda: service
    return TestClient(app)


def test_create_app_emits_no_on_event_deprecation() -> None:
    with warnings.catch_warnings():
        warnings.filterwarnings("error", message=".*on_event.*")
        app = create_app()

    assert app.router.lifespan_context is not None
    assert app.router.on_startup == []
    assert app.router.on_shutdown == []


def test_delete_with_traversal_id_is_rejected(client: TestClient, service, settings) -> None:
    service.save_upload(
        "safe-dataset", "data.csv", build_frame(rows=20).write_csv().encode("utf-8")
    )
    dataset_dir = settings.datasets_dir / "safe-dataset"
    assert dataset_dir.exists()

    response = client.delete("/api/datasets/%2E%2E%2F%2E%2E%2Fescape")

    assert response.status_code == 404
    assert dataset_dir.exists()
    with pytest.raises(DatasetNotFoundError):
        service.delete_dataset("../../escape")
    assert dataset_dir.exists()


def test_delete_tree_refuses_paths_outside_the_storage_root(storage, settings) -> None:
    outside = settings.storage_root.parent / "outside-delete-target"
    outside.mkdir()

    with pytest.raises(ValueError):
        storage.delete_tree(outside)

    assert outside.exists()


def test_upload_with_traversal_filename_is_stored_as_basename(client: TestClient, settings) -> None:
    response = client.post(
        "/api/datasets",
        files={
            "file": (
                "../../etc/passwd.csv",
                b"age\n1\n2\n",
                "text/csv",
            )
        },
    )

    assert response.status_code == 202
    body = response.json()
    dataset_id = body["dataset"]["dataset_id"]
    assert body["dataset"]["filename"] == "passwd.csv"
    assert (settings.datasets_dir / dataset_id / "passwd.csv").exists()
    assert not (settings.storage_root.parent / "etc").exists()


def test_empty_upload_is_rejected(client: TestClient) -> None:
    response = client.post(
        "/api/datasets",
        files={"file": ("empty.csv", b"", "text/csv")},
    )

    assert response.status_code == 400
    assert response.json()["detail"] == "Uploaded file is empty."
    assert client.get("/api/datasets").json() == []


def test_zero_column_dataset_fails_the_job_without_a_server_error(
    client: TestClient,
) -> None:
    response = client.post(
        "/api/datasets",
        files={"file": ("empty.csv", b"\n", "text/csv")},
    )

    assert response.status_code == 202
    body = response.json()
    job = client.get(f"/api/jobs/{body['job']['job_id']}")
    assert job.status_code == 200
    payload = job.json()
    assert payload["status"] == "failed"
    assert payload["error"] is not None
    assert "Could not profile" in payload["error"]

    dataset = client.get(f"/api/datasets/{body['dataset']['dataset_id']}")
    assert dataset.status_code == 200
    assert dataset.json()["row_count"] is None


def test_valid_dataset_still_profiles(client: TestClient) -> None:
    frame = build_frame(rows=40)
    response = client.post(
        "/api/datasets",
        files={"file": ("sample.csv", frame.write_csv(), "text/csv")},
    )

    assert response.status_code == 202
    body = response.json()
    dataset_id = body["dataset"]["dataset_id"]
    job = client.get(f"/api/jobs/{body['job']['job_id']}").json()
    assert job["status"] == "succeeded"

    profile = client.get(f"/api/datasets/{dataset_id}/profile")
    assert profile.status_code == 200
    assert profile.json()["row_count"] == frame.height
