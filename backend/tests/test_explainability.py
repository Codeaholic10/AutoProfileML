"""Tests for the SHAP explainability service and API."""

from __future__ import annotations

import math

import polars as pl
import pytest
from fastapi.testclient import TestClient

from app.api.deps import get_explanation_service
from app.api.routes import datasets as dataset_routes
from app.core.jobs import get_job_store
from app.main import create_app
from app.models.benchmark import BenchmarkCreateRequest
from app.models.explanation import ExplanationCreateRequest
from app.models.schemas import JobStatus
from app.services import benchmarking
from app.services.benchmarking import BenchmarkNotReadyError, BenchmarkService, ModelNotFoundError
from app.services.datasets import DatasetService
from app.services.explainability import (
    ExplanationService,
    UnsupportedModelError,
    explainer_method,
)
from app.storage.factory import get_storage
from tests.conftest import build_frame


@pytest.fixture
def benchmark_service(storage, job_store, settings, service) -> BenchmarkService:
    return BenchmarkService(
        storage=storage,
        job_store=job_store,
        settings=settings,
        dataset_service=service,
    )


@pytest.fixture
def explanation_service(storage, job_store, settings, service, benchmark_service):
    return ExplanationService(
        storage=storage,
        job_store=job_store,
        settings=settings,
        dataset_service=service,
        benchmark_service=benchmark_service,
    )


def _prepare_dataset(service: DatasetService, frame: pl.DataFrame) -> str:
    dataset_id = "explain-dataset"
    service.save_upload(dataset_id, "data.csv", frame.write_csv().encode("utf-8"))
    job = service._jobs.create(kind="profiling", dataset_id=dataset_id)
    service.run_profiling(job.job_id, dataset_id)
    return dataset_id


def _run_benchmark(
    service: BenchmarkService,
    dataset_id: str,
    target: str,
) -> tuple[str, str]:
    run, job = service.enqueue(dataset_id, BenchmarkCreateRequest(target=target, folds=3))
    service.run_benchmark(run.benchmark_id, job.job_id)
    stored = service.get_benchmark(run.benchmark_id)
    assert stored.status is JobStatus.SUCCEEDED
    assert stored.best_model_id is not None
    return run.benchmark_id, stored.best_model_id


@pytest.fixture
def random_forest_run(monkeypatch, service, benchmark_service) -> tuple[str, str, str]:
    monkeypatch.setattr(benchmarking, "MODEL_SPECS", (benchmarking.MODEL_SPECS[1],))
    dataset_id = _prepare_dataset(service, build_frame(rows=120))
    benchmark_id, model_id = _run_benchmark(benchmark_service, dataset_id, "city")
    return dataset_id, benchmark_id, model_id


@pytest.fixture
def ridge_run(monkeypatch, service, benchmark_service) -> tuple[str, str]:
    monkeypatch.setattr(benchmarking, "MODEL_SPECS", (benchmarking.MODEL_SPECS[0],))
    dataset_id = _prepare_dataset(service, build_frame(rows=90))
    return _run_benchmark(benchmark_service, dataset_id, "income")


def _run_explanation(
    service: ExplanationService,
    job_store,
    benchmark_id: str,
    model_id: str,
    sample_size: int = 100,
    local_rows: int = 5,
) -> None:
    request = ExplanationCreateRequest(
        model_id=model_id, sample_size=sample_size, local_rows=local_rows
    )
    explanation_id, _run, model, job = service.enqueue(benchmark_id, request)
    service.run_explanation(
        explanation_id,
        benchmark_id,
        model.model_id,
        job.job_id,
        sample_size,
        local_rows,
    )
    job_record = job_store.get(job.job_id)
    assert job_record is not None
    assert job_record.status is JobStatus.SUCCEEDED, job_record.error


def test_tree_explanation_report_is_finite_and_persisted(
    explanation_service: ExplanationService, job_store, random_forest_run, settings
) -> None:
    _dataset_id, benchmark_id, model_id = random_forest_run
    _run_explanation(explanation_service, job_store, benchmark_id, model_id)

    report = explanation_service.get_report(benchmark_id, model_id)
    assert report.method == "tree_shap"
    assert report.model_id == model_id
    assert report.sample_size == 100
    assert 0 < report.background_size <= 100

    assert report.global_importance
    assert [item.rank for item in report.global_importance] == list(
        range(1, len(report.global_importance) + 1)
    )
    values = [item.mean_abs_shap for item in report.global_importance]
    assert values == sorted(values, reverse=True)
    assert all(math.isfinite(value) and value >= 0 for value in values)
    assert len(report.global_importance) <= 30

    assert report.summary_points
    assert len(report.summary_points) <= 10 * report.sample_size
    assert all(math.isfinite(point.shap_value) for point in report.summary_points)

    assert len(report.local_explanations) == 5
    for local in report.local_explanations:
        assert math.isfinite(local.prediction)
        assert math.isfinite(local.base_value)
        assert 0 < len(local.contributions) <= 15
        magnitudes = [abs(item.contribution) for item in local.contributions]
        assert magnitudes == sorted(magnitudes, reverse=True)

    path = settings.benchmarks_dir / benchmark_id / "explanations" / f"{model_id}.json"
    assert path.exists()
    assert any(warning.code == "shap_sample" for warning in report.warnings)


def test_linear_explanation_uses_linear_shap(
    explanation_service: ExplanationService, job_store, ridge_run: tuple[str, str]
) -> None:
    benchmark_id, model_id = ridge_run
    _run_explanation(
        explanation_service,
        job_store,
        benchmark_id,
        model_id,
        sample_size=50,
        local_rows=3,
    )

    report = explanation_service.get_report(benchmark_id, model_id)
    assert report.method == "linear_shap"
    assert report.sample_size == 50
    assert len(report.local_explanations) == 3
    assert all(
        math.isfinite(item.mean_abs_shap) and item.mean_abs_shap >= 0
        for item in report.global_importance
    )
    assert all(math.isfinite(local.prediction) for local in report.local_explanations)


def test_unknown_model_is_rejected(
    explanation_service: ExplanationService, random_forest_run
) -> None:
    _dataset_id, benchmark_id, _model_id = random_forest_run
    missing = "f" * 32

    with pytest.raises(ModelNotFoundError):
        explanation_service.enqueue(
            benchmark_id, ExplanationCreateRequest(model_id=missing, sample_size=50)
        )
    with pytest.raises(ModelNotFoundError):
        explanation_service.get_report(benchmark_id, missing)
    with pytest.raises(ModelNotFoundError):
        explanation_service.get_report(benchmark_id, "../../escape")


def test_queued_benchmark_is_not_ready(
    explanation_service: ExplanationService, service, benchmark_service
) -> None:
    dataset_id = _prepare_dataset(service, build_frame(rows=80))
    run, _job = benchmark_service.enqueue(
        dataset_id, BenchmarkCreateRequest(target="city", folds=3)
    )

    with pytest.raises(BenchmarkNotReadyError):
        explanation_service.enqueue(
            run.benchmark_id,
            ExplanationCreateRequest(model_id="a" * 32, sample_size=50),
        )
    with pytest.raises(BenchmarkNotReadyError):
        explanation_service.get_report(run.benchmark_id, "a" * 32)


def test_explainer_selection_rejects_unknown_families() -> None:
    assert explainer_method("linear") == "linear_shap"
    assert explainer_method("random_forest") == "tree_shap"
    assert explainer_method("lightgbm") == "tree_shap"
    assert explainer_method("xgboost") == "tree_shap"
    with pytest.raises(UnsupportedModelError):
        explainer_method("neural_network")


def test_dataset_deletion_removes_explanations(
    explanation_service: ExplanationService,
    job_store,
    service,
    random_forest_run,
    settings,
) -> None:
    dataset_id, benchmark_id, model_id = random_forest_run
    _run_explanation(explanation_service, job_store, benchmark_id, model_id)
    path = settings.benchmarks_dir / benchmark_id / "explanations" / f"{model_id}.json"
    assert path.exists()

    service.delete_dataset(dataset_id)

    assert not path.exists()
    assert not (settings.benchmarks_dir / benchmark_id).exists()


# --------------------------------------------------------------------------- #
# API
# --------------------------------------------------------------------------- #


@pytest.fixture
def client(settings, storage, job_store, service, explanation_service) -> TestClient:
    app = create_app()
    app.dependency_overrides[get_storage] = lambda: storage
    app.dependency_overrides[get_job_store] = lambda: job_store
    app.dependency_overrides[dataset_routes.get_dataset_service] = lambda: service
    app.dependency_overrides[get_explanation_service] = lambda: explanation_service
    return TestClient(app)


def test_explanation_api_end_to_end(
    client: TestClient, random_forest_run: tuple[str, str, str]
) -> None:
    _dataset_id, benchmark_id, model_id = random_forest_run

    response = client.post(
        f"/api/benchmarks/{benchmark_id}/explanations",
        json={"model_id": model_id, "sample_size": 50, "local_rows": 3},
    )
    assert response.status_code == 202, response.text
    body = response.json()
    assert body["benchmark_id"] == benchmark_id
    assert body["model_id"] == model_id
    assert body["job"]["kind"] == "explanation"

    job = client.get(f"/api/jobs/{body['job']['job_id']}")
    assert job.status_code == 200
    assert job.json()["status"] == "succeeded"

    report = client.get(f"/api/benchmarks/{benchmark_id}/explanations/{model_id}")
    assert report.status_code == 200
    payload = report.json()
    assert payload["explanation_id"] == body["explanation_id"]
    assert payload["model_id"] == model_id
    assert payload["global_importance"]
    assert payload["local_explanations"]

    unknown = client.get(f"/api/benchmarks/{benchmark_id}/explanations/{'f' * 32}")
    assert unknown.status_code == 404

    missing_benchmark = client.post(
        f"/api/benchmarks/{'a' * 32}/explanations",
        json={"model_id": model_id, "sample_size": 50},
    )
    assert missing_benchmark.status_code == 404


def test_explanation_api_reports_conflict_for_queued_benchmark(
    client: TestClient, service, benchmark_service
) -> None:
    dataset_id = _prepare_dataset(service, build_frame(rows=80))
    run, _job = benchmark_service.enqueue(
        dataset_id, BenchmarkCreateRequest(target="city", folds=3)
    )

    response = client.post(
        f"/api/benchmarks/{run.benchmark_id}/explanations",
        json={"model_id": "a" * 32, "sample_size": 50},
    )
    assert response.status_code == 409
