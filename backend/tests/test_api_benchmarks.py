"""Integration tests for the benchmark API."""

from __future__ import annotations

import polars as pl
import pytest
from fastapi.testclient import TestClient

from app.api.deps import get_benchmark_service
from app.api.routes import datasets as dataset_routes
from app.core.jobs import get_job_store
from app.main import create_app
from app.services.benchmarking import BenchmarkService
from app.storage.factory import get_storage
from tests.conftest import build_frame


@pytest.fixture
def client(settings, storage, job_store, service) -> TestClient:
    """TestClient wired to isolated storage and a benchmark service."""

    benchmark_service = BenchmarkService(
        storage=storage,
        job_store=job_store,
        settings=settings,
        dataset_service=service,
    )
    app = create_app()
    app.dependency_overrides[get_storage] = lambda: storage
    app.dependency_overrides[get_job_store] = lambda: job_store
    app.dependency_overrides[dataset_routes.get_dataset_service] = lambda: service
    app.dependency_overrides[get_benchmark_service] = lambda: benchmark_service
    return TestClient(app)


def _upload(client: TestClient, frame: pl.DataFrame) -> str:
    payload = frame.write_csv().encode("utf-8")
    response = client.post(
        "/api/datasets",
        files={"file": ("sample.csv", payload, "text/csv")},
    )
    assert response.status_code == 202
    return response.json()["dataset"]["dataset_id"]


def _enqueue(client: TestClient, dataset_id: str, target: str) -> dict[str, object]:
    response = client.post(
        f"/api/datasets/{dataset_id}/benchmarks",
        json={"target": target, "folds": 3},
    )
    assert response.status_code == 202, response.text
    return response.json()


def test_classification_benchmark_end_to_end(client: TestClient) -> None:
    frame = build_frame(rows=120)
    dataset_id = _upload(client, frame)
    body = _enqueue(client, dataset_id, "city")
    benchmark_id = str(body["benchmark"]["benchmark_id"])  # type: ignore[index]
    job_id = str(body["job"]["job_id"])  # type: ignore[index]

    job = client.get(f"/api/jobs/{job_id}")
    assert job.status_code == 200
    assert job.json()["status"] == "succeeded"

    run = client.get(f"/api/benchmarks/{benchmark_id}")
    assert run.status_code == 200
    payload = run.json()
    assert payload["status"] == "succeeded"
    assert payload["task_type"] == "classification"
    assert len(payload["leaderboard"]) == 4
    assert all(model["status"] == "succeeded" for model in payload["leaderboard"])
    assert sorted(model["rank"] for model in payload["leaderboard"]) == [1, 2, 3, 4]
    assert payload["best_model_id"] in {model["model_id"] for model in payload["leaderboard"]}
    assert sum(payload["class_support"].values()) == frame.height
    assert payload["preprocessing"] is not None

    history = client.get(f"/api/datasets/{dataset_id}/benchmarks")
    assert history.status_code == 200
    assert [item["benchmark_id"] for item in history.json()] == [benchmark_id]

    best = next(
        model for model in payload["leaderboard"] if model["model_id"] == payload["best_model_id"]
    )
    predictions = client.get(
        f"/api/benchmarks/{benchmark_id}/models/{best['model_id']}/predictions"
    )
    assert predictions.status_code == 200
    prediction_payload = predictions.json()
    assert prediction_payload["prediction_count"] == frame.height
    assert len(prediction_payload["predictions"]) == frame.height
    assert len(prediction_payload["classes"]) == 4
    assert all(prediction["probabilities"] for prediction in prediction_payload["predictions"])


def test_completed_run_is_readable_from_a_fresh_service(
    client: TestClient, settings, storage, job_store
) -> None:
    dataset_id = _upload(client, build_frame(rows=100))
    body = _enqueue(client, dataset_id, "city")
    benchmark_id = str(body["benchmark"]["benchmark_id"])  # type: ignore[index]

    fresh = BenchmarkService(storage=storage, job_store=job_store, settings=settings)
    stored = fresh.get_benchmark(benchmark_id)

    assert stored.status == "succeeded"
    assert len(stored.leaderboard) == 4
    assert stored.best_model_id is not None


def test_regression_benchmark_rejects_prediction_requests(client: TestClient) -> None:
    dataset_id = _upload(client, build_frame(rows=100))
    body = _enqueue(client, dataset_id, "income")
    benchmark_id = str(body["benchmark"]["benchmark_id"])  # type: ignore[index]

    run = client.get(f"/api/benchmarks/{benchmark_id}")
    payload = run.json()
    assert payload["status"] == "succeeded"
    assert payload["task_type"] == "regression"
    model_id = payload["leaderboard"][0]["model_id"]

    predictions = client.get(f"/api/benchmarks/{benchmark_id}/models/{model_id}/predictions")
    assert predictions.status_code == 400


def test_benchmark_rejects_unknown_dataset(client: TestClient) -> None:
    response = client.post(
        "/api/datasets/missing/benchmarks",
        json={"target": "city", "folds": 3},
    )
    assert response.status_code == 404
    assert client.get("/api/datasets/missing/benchmarks").status_code == 404


def test_benchmark_rejects_invalid_target(client: TestClient) -> None:
    dataset_id = _upload(client, build_frame(rows=80))

    missing = client.post(
        f"/api/datasets/{dataset_id}/benchmarks",
        json={"target": "no-such-target", "folds": 3},
    )
    assert missing.status_code == 400

    constant = client.post(
        f"/api/datasets/{dataset_id}/benchmarks",
        json={"target": "constant_col", "folds": 3},
    )
    assert constant.status_code == 400


def test_unknown_benchmark_and_predictions_return_404(client: TestClient) -> None:
    benchmark_id = "a" * 32
    model_id = "b" * 32

    assert client.get(f"/api/benchmarks/{benchmark_id}").status_code == 404
    assert (
        client.get(f"/api/benchmarks/{benchmark_id}/models/{model_id}/predictions").status_code
        == 404
    )
