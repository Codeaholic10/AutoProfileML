"""Unit tests for metrics, sampling, CV, ranking and benchmark persistence."""

from __future__ import annotations

import numpy as np
import polars as pl
import pytest
from sklearn.base import BaseEstimator
from sklearn.linear_model import LogisticRegression, Ridge
from sklearn.pipeline import Pipeline

from app.models.benchmark import (
    BenchmarkCreateRequest,
    BenchmarkRun,
    ModelResult,
    TaskType,
)
from app.models.schemas import JobStatus
from app.services import benchmarking
from app.services.benchmarking import (
    BenchmarkNotFoundError,
    BenchmarkService,
    LabelEncodedClassifier,
    ModelNotFoundError,
    ModelSpec,
    accuracy,
    cross_validate_model,
    log_loss,
    macro_f1,
    mae,
    r2,
    rank_models,
    rmse,
    roc_auc,
    sample_training_frame,
)
from tests.conftest import build_frame


def test_classification_metrics_on_known_arrays() -> None:
    y_true = np.array([0, 1, 1, 0])
    y_pred = np.array([0, 1, 0, 0])

    assert accuracy(y_true, y_pred) == pytest.approx(0.75)
    assert macro_f1(y_true, y_pred) == pytest.approx(0.733333, abs=1e-6)
    probabilities = np.array([[0.9, 0.1], [0.1, 0.9], [0.1, 0.9], [0.9, 0.1]])
    assert roc_auc(y_true, probabilities) == pytest.approx(1.0)
    assert roc_auc(y_true, probabilities[:, ::-1]) == pytest.approx(0.0)
    assert log_loss(y_true, np.array([[1.0, 0.0], [0.0, 1.0], [0.0, 1.0], [1.0, 0.0]])) < 1e-10


def test_multiclass_roc_auc_is_perfect_for_separated_probabilities() -> None:
    y_true = np.array([0, 1, 2, 0, 1, 2])
    y_score = np.array(
        [
            [0.9, 0.05, 0.05],
            [0.05, 0.9, 0.05],
            [0.05, 0.05, 0.9],
            [0.9, 0.05, 0.05],
            [0.05, 0.9, 0.05],
            [0.05, 0.05, 0.9],
        ]
    )

    assert roc_auc(y_true, y_score) == pytest.approx(1.0)


def test_regression_metrics_on_known_arrays() -> None:
    y_true = np.array([1.0, 2.0, 3.0])
    y_pred = np.array([1.0, 2.0, 4.0])

    assert rmse(y_true, y_pred) == pytest.approx(np.sqrt(1 / 3))
    assert mae(y_true, y_pred) == pytest.approx(1 / 3)
    assert r2(y_true, y_pred) == pytest.approx(0.5)


def test_sample_training_frame_is_deterministic_and_reports_the_cap() -> None:
    frame = pl.DataFrame({"value": list(range(100))})

    first, rows = sample_training_frame(frame, max_rows=10, seed=42)
    second, _ = sample_training_frame(frame, max_rows=10, seed=42)
    whole, no_rows = sample_training_frame(frame, max_rows=200, seed=42)

    assert rows == 10
    assert first.equals(second)
    assert whole.height == 100
    assert no_rows is None


def test_rank_models_orders_classification_by_f1() -> None:
    leaderboard = [
        ModelResult(
            model_id="a",
            name="A",
            family="linear",
            status="succeeded",
            metrics={"f1_macro": 0.50},
        ),
        ModelResult(
            model_id="b",
            name="B",
            family="random_forest",
            status="succeeded",
            metrics={"f1_macro": 0.80},
        ),
        ModelResult(
            model_id="c",
            name="C",
            family="lightgbm",
            status="failed",
        ),
    ]

    ordered = rank_models(leaderboard, TaskType.CLASSIFICATION)

    assert [model.model_id for model in ordered] == ["b", "a"]
    assert [model.rank for model in leaderboard] == [2, 1, None]


def test_rank_models_orders_regression_by_lowest_rmse() -> None:
    leaderboard = [
        ModelResult(
            model_id="a",
            name="A",
            family="linear",
            status="succeeded",
            metrics={"rmse": 1.5},
        ),
        ModelResult(
            model_id="b",
            name="B",
            family="xgboost",
            status="succeeded",
            metrics={"rmse": 0.5},
        ),
    ]

    ordered = rank_models(leaderboard, TaskType.REGRESSION)

    assert [model.model_id for model in ordered] == ["b", "a"]
    assert [model.rank for model in leaderboard] == [2, 1]


def test_cross_validation_reports_classification_metrics_and_oof_predictions() -> None:
    rng = np.random.default_rng(9)
    rows = 90
    X = pl.DataFrame({"a": rng.normal(size=rows), "b": rng.normal(size=rows)})
    y = np.array(["no"] * 45 + ["yes"] * 45)
    rng.shuffle(y)
    pipeline = Pipeline([("model", LabelEncodedClassifier(LogisticRegression(max_iter=500)))])

    outcome = cross_validate_model(pipeline, X, y, TaskType.CLASSIFICATION, folds=3)

    assert set(outcome.metrics) == {"accuracy", "f1_macro", "roc_auc", "log_loss"}
    assert outcome.classes == ["no", "yes"]
    assert outcome.class_support == {"no": 45, "yes": 45}
    assert len(outcome.predictions) == rows
    assert outcome.truncated is False
    first = outcome.predictions[0]
    assert first.y_true in {"no", "yes"}
    assert first.y_pred in {"no", "yes"}
    assert first.probabilities is not None
    assert set(first.probabilities) == {"no", "yes"}


def test_cross_validation_reports_regression_metrics_and_oof_predictions() -> None:
    rng = np.random.default_rng(10)
    rows = 60
    X = pl.DataFrame({"a": rng.normal(size=rows), "b": rng.normal(size=rows)})
    y = rng.normal(size=rows)
    pipeline = Pipeline([("model", Ridge())])

    outcome = cross_validate_model(pipeline, X, y, TaskType.REGRESSION, folds=3)

    assert set(outcome.metrics) == {"rmse", "mae", "r2"}
    assert outcome.classes == []
    assert outcome.class_support == {}
    assert len(outcome.predictions) == rows
    assert outcome.predictions[0].probabilities is None
    assert isinstance(outcome.predictions[0].y_true, float)


class _FailingEstimator(BaseEstimator):
    def fit(self, X: object, y: object = None) -> None:
        raise RuntimeError("boom")


def _failing_spec() -> ModelSpec:
    def factory(_seed: int) -> BaseEstimator:
        return _FailingEstimator()

    return ModelSpec(
        key="linear",
        family="linear",
        classification_name="Broken",
        regression_name="Broken",
        classifier=factory,
        regressor=factory,
    )


@pytest.fixture
def benchmark_service(storage, job_store, settings, service) -> BenchmarkService:
    return BenchmarkService(
        storage=storage,
        job_store=job_store,
        settings=settings,
        dataset_service=service,
    )


def _prepare_dataset(service, frame: pl.DataFrame) -> str:
    dataset_id = "bench-dataset"
    service.save_upload(dataset_id, "data.csv", frame.write_csv().encode("utf-8"))
    job = service._jobs.create(kind="profiling", dataset_id=dataset_id)
    service.run_profiling(job.job_id, dataset_id)
    return dataset_id


def test_model_failure_is_isolated_from_the_run(
    benchmark_service: BenchmarkService, service, monkeypatch
) -> None:
    dataset_id = _prepare_dataset(service, build_frame(rows=120))
    run, job = benchmark_service.enqueue(dataset_id, BenchmarkCreateRequest(target="city", folds=3))

    monkeypatch.setattr(benchmarking, "MODEL_SPECS", (_failing_spec(),))
    benchmark_service.run_benchmark(run.benchmark_id, job.job_id)

    job_record = benchmark_service._jobs.get(job.job_id)
    assert job_record is not None
    assert job_record.status is JobStatus.SUCCEEDED

    stored = benchmark_service.get_benchmark(run.benchmark_id)
    assert stored.status is JobStatus.SUCCEEDED
    assert len(stored.leaderboard) == 1
    assert stored.leaderboard[0].status == "failed"
    assert "RuntimeError" in (stored.leaderboard[0].error or "")
    assert stored.best_model_id is None


def test_model_paths_are_confined_to_the_benchmark_directory(
    benchmark_service: BenchmarkService, settings, storage
) -> None:
    benchmark_id = "a" * 32
    model_id = "b" * 32
    run = BenchmarkRun(
        benchmark_id=benchmark_id,
        dataset_id="c" * 32,
        target="target",
        task_type=TaskType.CLASSIFICATION,
        task_detection_reason="test",
        leaderboard=[
            ModelResult(
                model_id=model_id,
                name="Linear",
                family="linear",
                status="succeeded",
            )
        ],
    )
    storage.write_text(
        settings.benchmarks_dir / benchmark_id / "run.json",
        run.model_dump_json(),
    )
    model_path = settings.benchmarks_dir / benchmark_id / "models" / f"{model_id}.joblib"
    model_path.parent.mkdir(parents=True, exist_ok=True)
    model_path.write_bytes(b"artifact")

    assert benchmark_service.get_model_path(benchmark_id, model_id) == model_path

    with pytest.raises(ModelNotFoundError):
        benchmark_service.get_model_path(benchmark_id, "../../escape")
    with pytest.raises(ModelNotFoundError):
        benchmark_service.get_model_path(benchmark_id, "f" * 32)
    with pytest.raises(BenchmarkNotFoundError):
        benchmark_service.get_benchmark("../../escape")


def test_dataset_deletion_removes_its_benchmarks(
    benchmark_service: BenchmarkService, service, settings
) -> None:
    dataset_id = _prepare_dataset(service, build_frame(rows=80))
    run, _job = benchmark_service.enqueue(
        dataset_id, BenchmarkCreateRequest(target="city", folds=3)
    )
    benchmark_dir = settings.benchmarks_dir / run.benchmark_id
    assert (benchmark_dir / "run.json").exists()

    service.delete_dataset(dataset_id)

    assert not benchmark_dir.exists()
