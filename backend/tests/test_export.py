"""Tests for standalone code export: generation, packaging, and API."""

from __future__ import annotations

import ast
import io
import json
import subprocess
import sys
import zipfile

import pytest
from fastapi.testclient import TestClient

from app.api.deps import get_export_service
from app.api.routes import datasets as dataset_routes
from app.core.jobs import get_job_store
from app.main import create_app
from app.models.benchmark import (
    BenchmarkCreateRequest,
    BenchmarkRun,
    ModelResult,
    PreprocessingPlan,
    PreprocessingStep,
    TaskType,
)
from app.models.export import ExportCreateRequest
from app.models.schemas import JobStatus
from app.services import benchmarking
from app.services.benchmarking import (
    BenchmarkNotReadyError,
    BenchmarkService,
    ModelNotFoundError,
)
from app.services.datasets import DatasetService
from app.services.export import (
    EXPORT_MODEL_NAME,
    EXPORT_NOTEBOOK_NAME,
    EXPORT_README_NAME,
    EXPORT_SCRIPT_NAME,
    ExportNotFoundError,
    ExportService,
    render_notebook,
    render_training_script,
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
def export_service(storage, job_store, settings, service, benchmark_service) -> ExportService:
    return ExportService(
        storage=storage,
        job_store=job_store,
        settings=settings,
        dataset_service=service,
        benchmark_service=benchmark_service,
    )


def _prepare_dataset(
    service: DatasetService,
    frame,
    dataset_id: str = "export-dataset",
) -> str:
    service.save_upload(dataset_id, "data.csv", frame.write_csv().encode("utf-8"))
    job = service._jobs.create(kind="profiling", dataset_id=dataset_id)
    service.run_profiling(job.job_id, dataset_id)
    return dataset_id


def _run_benchmark(
    service: BenchmarkService,
    dataset_id: str,
    target: str,
) -> str:
    run, job = service.enqueue(dataset_id, BenchmarkCreateRequest(target=target, folds=3))
    service.run_benchmark(run.benchmark_id, job.job_id)
    stored = service.get_benchmark(run.benchmark_id)
    assert stored.status is JobStatus.SUCCEEDED
    assert stored.best_model_id is not None
    return run.benchmark_id


@pytest.fixture
def regression_run(monkeypatch, service, benchmark_service) -> tuple[str, str]:
    monkeypatch.setattr(benchmarking, "MODEL_SPECS", (benchmarking.MODEL_SPECS[0],))
    dataset_id = _prepare_dataset(service, build_frame(rows=90))
    return dataset_id, _run_benchmark(benchmark_service, dataset_id, "income")


@pytest.fixture
def classification_run(monkeypatch, service, benchmark_service) -> tuple[str, str]:
    monkeypatch.setattr(benchmarking, "MODEL_SPECS", (benchmarking.MODEL_SPECS[1],))
    dataset_id = _prepare_dataset(service, build_frame(rows=90))
    return dataset_id, _run_benchmark(benchmark_service, dataset_id, "city")


def _export_model(
    exporter: ExportService,
    benchmark_service: BenchmarkService,
    job_store,
    benchmark_id: str,
    model_id: str | None = None,
) -> str:
    run = benchmark_service.get_benchmark(benchmark_id)
    chosen = model_id or run.best_model_id
    assert chosen is not None
    export_id, _run, model, job = exporter.enqueue(
        benchmark_id, ExportCreateRequest(model_id=chosen)
    )
    exporter.run_export(export_id, benchmark_id, model.model_id, job.job_id)
    record = job_store.get(job.job_id)
    assert record is not None
    assert record.status is JobStatus.SUCCEEDED, record.error
    return model.model_id


def test_export_bundle_contains_script_notebook_readme_and_model(
    export_service: ExportService,
    benchmark_service: BenchmarkService,
    job_store,
    regression_run,
) -> None:
    _dataset_id, benchmark_id = regression_run
    model_id = _export_model(export_service, benchmark_service, job_store, benchmark_id)

    manifest = export_service.get_manifest(benchmark_id, model_id)
    names = [file.name for file in manifest.files]
    assert names == [
        EXPORT_SCRIPT_NAME,
        EXPORT_NOTEBOOK_NAME,
        EXPORT_README_NAME,
        EXPORT_MODEL_NAME,
    ]
    assert manifest.size_bytes > 0
    assert manifest.includes_onnx is False
    assert manifest.onnx_note is not None and "skl2onnx" in manifest.onnx_note

    download = export_service.get_download(benchmark_id, model_id)
    assert download.filename == "autoprofileml-income-ridge.zip"
    with zipfile.ZipFile(download.path) as bundle:
        assert sorted(bundle.namelist()) == sorted(names)
        source = bundle.read(EXPORT_SCRIPT_NAME).decode("utf-8")
        ast.parse(source)
        assert "TARGET = 'income'" in source
        assert "NUMERIC_FEATURES = ['age', 'income_copy', 'score']" in source
        assert "StandardScaler()" in source
        assert "OneHotEncoder(" in source
        assert "Ridge(" in source

        notebook = json.loads(bundle.read(EXPORT_NOTEBOOK_NAME))
        assert notebook["nbformat"] == 4
        assert len(notebook["cells"]) >= 10
        markdown_cells = [cell for cell in notebook["cells"] if cell["cell_type"] == "markdown"]
        assert any("Preprocessing" in "".join(cell["source"]) for cell in markdown_cells)

        readme = bundle.read(EXPORT_README_NAME).decode("utf-8")
        assert "AutoProfileML export bundle" in readme
        assert "train_model.py" in readme
        assert "ONNX" in readme


def test_generated_script_trains_standalone(
    export_service: ExportService,
    benchmark_service: BenchmarkService,
    job_store,
    regression_run,
    tmp_path,
) -> None:
    dataset_id, benchmark_id = regression_run
    model_id = _export_model(export_service, benchmark_service, job_store, benchmark_id)
    download = export_service.get_download(benchmark_id, model_id)

    with zipfile.ZipFile(download.path) as bundle:
        bundle.extract(EXPORT_SCRIPT_NAME, tmp_path)
    frame = build_frame(rows=90)
    (tmp_path / "data.csv").write_bytes(frame.write_csv().encode("utf-8"))

    result = subprocess.run(
        [sys.executable, EXPORT_SCRIPT_NAME],
        cwd=tmp_path,
        capture_output=True,
        text=True,
        timeout=180,
    )

    assert result.returncode == 0, result.stderr
    assert "Trained Ridge" in result.stdout
    assert (tmp_path / EXPORT_MODEL_NAME).exists()


def test_classification_script_uses_the_label_wrapper(
    export_service: ExportService,
    benchmark_service: BenchmarkService,
    job_store,
    classification_run,
) -> None:
    _dataset_id, benchmark_id = classification_run
    model_id = _export_model(export_service, benchmark_service, job_store, benchmark_id)
    download = export_service.get_download(benchmark_id, model_id)

    with zipfile.ZipFile(download.path) as bundle:
        source = bundle.read(EXPORT_SCRIPT_NAME).decode("utf-8")

    ast.parse(source)
    assert "TARGET = 'city'" in source
    assert "class LabelEncodedClassifier" in source
    assert "model = LabelEncodedClassifier(" in source
    assert "RandomForestClassifier(" in source
    assert (
        "from sklearn.base import BaseEstimator, ClassifierMixin, TransformerMixin, clone" in source
    )


def test_export_works_for_a_non_best_model(
    monkeypatch, service, benchmark_service, export_service, job_store
) -> None:
    monkeypatch.setattr(
        benchmarking,
        "MODEL_SPECS",
        (benchmarking.MODEL_SPECS[0], benchmarking.MODEL_SPECS[1]),
    )
    dataset_id = _prepare_dataset(service, build_frame(rows=80), "export-two-models")
    benchmark_id = _run_benchmark(benchmark_service, dataset_id, "city")
    run = benchmark_service.get_benchmark(benchmark_id)
    other = next(
        model
        for model in run.leaderboard
        if model.status == "succeeded" and model.model_id != run.best_model_id
    )

    model_id = _export_model(
        export_service, benchmark_service, job_store, benchmark_id, other.model_id
    )

    manifest = export_service.get_manifest(benchmark_id, model_id)
    assert manifest.model_id == other.model_id
    assert manifest.model_name == other.name


def test_export_rejects_unknown_and_unready_models(
    export_service: ExportService,
    benchmark_service: BenchmarkService,
    service,
    regression_run,
) -> None:
    _dataset_id, benchmark_id = regression_run

    with pytest.raises(ModelNotFoundError):
        export_service.enqueue(benchmark_id, ExportCreateRequest(model_id="f" * 32))

    valid_model_id = benchmark_service.get_benchmark(benchmark_id).best_model_id
    assert valid_model_id is not None
    with pytest.raises(ModelNotFoundError):
        export_service.get_manifest(benchmark_id, "f" * 32)
    with pytest.raises(ExportNotFoundError):
        export_service.get_manifest(benchmark_id, valid_model_id)

    dataset_id = _prepare_dataset(service, build_frame(rows=40), "export-queued")
    queued, _job = benchmark_service.enqueue(
        dataset_id, BenchmarkCreateRequest(target="city", folds=3)
    )
    with pytest.raises(BenchmarkNotReadyError):
        export_service.enqueue(queued.benchmark_id, ExportCreateRequest(model_id="a" * 32))


def test_dataset_deletion_removes_export_artifacts(
    export_service: ExportService,
    benchmark_service: BenchmarkService,
    service,
    job_store,
    regression_run,
    settings,
) -> None:
    dataset_id, benchmark_id = regression_run
    _export_model(export_service, benchmark_service, job_store, benchmark_id)
    artifacts = settings.artifacts_dir / benchmark_id
    assert artifacts.exists()

    service.delete_dataset(dataset_id)

    assert not artifacts.exists()


def test_generated_source_neutralises_hostile_column_names() -> None:
    hostile = 'x"; import os; #'
    feature = 'a\'"); __import__("os"); ("'
    model = ModelResult(
        model_id="c" * 32,
        name="Random Forest",
        family="random_forest",
        status="succeeded",
        metrics={"f1_macro": 0.5},
        hyperparameters={"n_estimators": 10, "criterion": hostile},
    )
    run = BenchmarkRun(
        benchmark_id="a" * 32,
        dataset_id="b" * 32,
        target=hostile,
        task_type=TaskType.CLASSIFICATION,
        task_detection_reason="test",
        folds=3,
        leaderboard=[model],
    )
    plan = PreprocessingPlan(
        numeric_features=[feature],
        categorical_features=[],
        excluded_features=[],
        target_encoding=[],
        one_hot_encoding=[],
        steps=[
            PreprocessingStep(
                kind="numeric_impute",
                columns=[feature],
                strategy="median",
                parameters={},
            ),
            PreprocessingStep(
                kind="iqr_clip",
                columns=[feature],
                parameters={"k": 1.5},
            ),
        ],
        notes=[],
    )

    source = render_training_script(run, model, plan, "data.csv")

    tree = ast.parse(source)
    imported = {
        alias.name
        for node in ast.walk(tree)
        if isinstance(node, ast.Import)
        for alias in node.names
    }
    assert "os" not in imported
    assert "polars" in imported
    constants = {
        node.value
        for node in ast.walk(tree)
        if isinstance(node, ast.Constant) and isinstance(node.value, str)
    }
    assert hostile in constants
    assert feature in constants

    notebook = json.loads(render_notebook(run, model, plan, "data.csv"))
    assert notebook["cells"]


# --------------------------------------------------------------------------- #
# API
# --------------------------------------------------------------------------- #


@pytest.fixture
def client(settings, storage, job_store, service, export_service) -> TestClient:
    app = create_app()
    app.dependency_overrides[get_storage] = lambda: storage
    app.dependency_overrides[get_job_store] = lambda: job_store
    app.dependency_overrides[dataset_routes.get_dataset_service] = lambda: service
    app.dependency_overrides[get_export_service] = lambda: export_service
    return TestClient(app)


def test_export_api_end_to_end(
    client: TestClient,
    benchmark_service: BenchmarkService,
    regression_run,
) -> None:
    _dataset_id, benchmark_id = regression_run
    model_id = benchmark_service.get_benchmark(benchmark_id).best_model_id
    assert model_id is not None

    response = client.post(
        f"/api/benchmarks/{benchmark_id}/exports",
        json={"model_id": model_id},
    )
    assert response.status_code == 202, response.text
    body = response.json()
    assert body["model_id"] == model_id
    assert body["job"]["kind"] == "export"

    job = client.get(f"/api/jobs/{body['job']['job_id']}")
    assert job.status_code == 200
    assert job.json()["status"] == "succeeded"

    manifest = client.get(f"/api/benchmarks/{benchmark_id}/exports/{model_id}")
    assert manifest.status_code == 200
    payload = manifest.json()
    assert payload["export_id"] == body["export_id"]
    assert {file["name"] for file in payload["files"]} == {
        EXPORT_SCRIPT_NAME,
        EXPORT_NOTEBOOK_NAME,
        EXPORT_README_NAME,
        EXPORT_MODEL_NAME,
    }

    download = client.get(f"/api/benchmarks/{benchmark_id}/exports/{model_id}/download")
    assert download.status_code == 200
    assert download.headers["content-type"] == "application/zip"
    assert "autoprofileml-income-ridge.zip" in download.headers["content-disposition"]
    with zipfile.ZipFile(io.BytesIO(download.content)) as bundle:
        assert EXPORT_SCRIPT_NAME in bundle.namelist()

    unknown = client.get(f"/api/benchmarks/{benchmark_id}/exports/{'f' * 32}")
    assert unknown.status_code == 404

    missing = client.post(
        f"/api/benchmarks/{'a' * 32}/exports",
        json={"model_id": model_id},
    )
    assert missing.status_code == 404


def test_export_api_conflicts_for_queued_benchmark(
    client: TestClient,
    benchmark_service: BenchmarkService,
    service,
) -> None:
    dataset_id = _prepare_dataset(service, build_frame(rows=40), "export-api-queued")
    queued, _job = benchmark_service.enqueue(
        dataset_id, BenchmarkCreateRequest(target="city", folds=3)
    )

    response = client.post(
        f"/api/benchmarks/{queued.benchmark_id}/exports",
        json={"model_id": "a" * 32},
    )
    assert response.status_code == 409
