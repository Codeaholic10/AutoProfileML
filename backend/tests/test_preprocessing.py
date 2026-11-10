"""Tests for task detection, partitioning and the preprocessing pipeline."""

from __future__ import annotations

import io
from datetime import date, timedelta

import joblib
import numpy as np
import polars as pl
import pytest

from app.models.benchmark import FeaturePartition, TaskType
from app.services.preprocessing import (
    AdaptiveNumericImputer,
    InvalidTargetError,
    IQRClipper,
    NoUsableFeaturesError,
    build_preprocessor,
    describe_preprocessor,
    detect_task,
    partition_features,
)
from app.services.profiling import profile_frame


def build_preprocessing_frame(rows: int = 200, seed: int = 3) -> pl.DataFrame:
    rng = np.random.default_rng(seed)
    numeric_a = rng.normal(40, 10, rows).round(2)
    missing = rng.choice(rows, size=max(1, rows // 10), replace=False)
    numeric_a[missing] = np.nan

    return pl.DataFrame(
        {
            "numeric_a": numeric_a,
            "numeric_b": rng.normal(0, 1, rows).round(3),
            "city": rng.choice(["delhi", "mumbai", "pune"], rows),
            "id_like": [f"id-{index % 60}" for index in range(rows)],
            "constant_col": ["fixed"] * rows,
            "all_null": pl.Series([None] * rows, dtype=pl.Float64),
            "when": pl.date_range(
                date(2024, 1, 1),
                date(2024, 1, 1) + timedelta(days=rows - 1),
                interval="1d",
                eager=True,
            ),
            "excluded_col": rng.normal(size=rows),
            "target": rng.integers(0, 2, rows),
        }
    )


def profile_of(frame: pl.DataFrame) -> dict[str, object]:
    report = profile_frame(frame, "test-dataset")
    return {column.name: column for column in report.columns}


def test_detect_task_classifies_categorical_target() -> None:
    frame = pl.DataFrame({"x": [1.0, 2.0, 3.0, 4.0], "target": ["yes", "no", "yes", "no"]})
    columns = profile_of(frame)

    task, reason = detect_task(columns["target"], frame.height, None)

    assert task is TaskType.CLASSIFICATION
    assert "categorical" in reason


def test_detect_task_classifies_boolean_target() -> None:
    frame = pl.DataFrame({"x": [1.0, 2.0, 3.0, 4.0], "target": [True, False, True, False]})
    columns = profile_of(frame)

    task, reason = detect_task(columns["target"], frame.height, None)

    assert task is TaskType.CLASSIFICATION
    assert "boolean" in reason


def test_detect_task_classifies_low_cardinality_numeric_target() -> None:
    rng = np.random.default_rng(1)
    frame = pl.DataFrame({"x": rng.normal(size=200), "target": rng.integers(0, 3, 200)})
    columns = profile_of(frame)

    task, _ = detect_task(columns["target"], frame.height, None)

    assert task is TaskType.CLASSIFICATION


def test_detect_task_treats_continuous_numeric_as_regression() -> None:
    rng = np.random.default_rng(2)
    frame = pl.DataFrame({"x": rng.normal(size=200), "target": rng.normal(size=200)})
    columns = profile_of(frame)

    task, reason = detect_task(columns["target"], frame.height, None)

    assert task is TaskType.REGRESSION
    assert "continuous" in reason


def test_detect_task_requires_both_unique_count_and_ratio() -> None:
    frame = pl.DataFrame(
        {
            "x": np.arange(100),
            "target": np.tile(np.arange(20), 5),
        }
    )
    columns = profile_of(frame)

    task, _ = detect_task(columns["target"], frame.height, None)

    assert task is TaskType.REGRESSION


def test_detect_task_honours_override_for_a_valid_target() -> None:
    rng = np.random.default_rng(4)
    frame = pl.DataFrame({"x": rng.normal(size=100), "target": rng.normal(size=100)})
    columns = profile_of(frame)

    task, reason = detect_task(columns["target"], frame.height, TaskType.CLASSIFICATION)

    assert task is TaskType.CLASSIFICATION
    assert "explicitly" in reason


def test_detect_task_rejects_all_null_target() -> None:
    frame = pl.DataFrame(
        {
            "x": [1.0, 2.0, 3.0],
            "target": pl.Series([None, None, None], dtype=pl.Float64),
        }
    )
    columns = profile_of(frame)

    with pytest.raises(InvalidTargetError, match="no non-null"):
        detect_task(columns["target"], frame.height, None)


def test_detect_task_rejects_constant_target_even_with_override() -> None:
    frame = pl.DataFrame({"x": [1.0, 2.0, 3.0], "target": [1.0, 1.0, 1.0]})
    columns = profile_of(frame)

    with pytest.raises(InvalidTargetError, match="constant"):
        detect_task(columns["target"], frame.height, TaskType.REGRESSION)


def test_partition_assigns_every_column_to_a_group() -> None:
    frame = build_preprocessing_frame()
    report = profile_frame(frame, "test-dataset")
    partition = partition_features(frame, "target", ["excluded_col"], report)

    assert partition.numeric == ["numeric_a", "numeric_b"]
    assert partition.low_cardinality_categorical == ["city"]
    assert partition.high_cardinality_categorical == ["id_like"]
    assert partition.dropped_constant == ["constant_col"]
    assert partition.dropped_all_null == ["all_null"]
    assert partition.dropped_unsupported == ["when"]
    assert partition.excluded == ["excluded_col"]

    assigned = set(
        partition.numeric
        + partition.low_cardinality_categorical
        + partition.high_cardinality_categorical
        + partition.dropped_constant
        + partition.dropped_all_null
        + partition.dropped_unsupported
        + partition.excluded
        + [partition.target]
    )
    assert assigned == set(frame.columns)


def test_partition_rejects_target_in_exclusions() -> None:
    frame = build_preprocessing_frame()
    report = profile_frame(frame, "test-dataset")

    with pytest.raises(InvalidTargetError, match="cannot also be excluded"):
        partition_features(frame, "target", ["target"], report)


def test_partition_rejects_unknown_target() -> None:
    frame = build_preprocessing_frame()
    report = profile_frame(frame, "test-dataset")

    with pytest.raises(InvalidTargetError, match="does not exist"):
        partition_features(frame, "missing", [], report)


def test_iqr_clipper_uses_fit_bounds_and_preserves_nan() -> None:
    train = np.array([[0.0], [1.0], [2.0], [3.0], [4.0], [np.nan]])
    clipper = IQRClipper(k=1.5).fit(train)

    q1, q3 = np.nanquantile(train, [0.25, 0.75])
    iqr = q3 - q1
    lower = q1 - 1.5 * iqr
    upper = q3 + 1.5 * iqr
    assert clipper.lower_[0] == pytest.approx(lower)
    assert clipper.upper_[0] == pytest.approx(upper)

    transformed = clipper.transform(np.array([[1000.0], [-1000.0], [np.nan]]))

    assert transformed[0, 0] == pytest.approx(upper)
    assert transformed[1, 0] == pytest.approx(lower)
    assert np.isnan(transformed[2, 0])


def _imputer_for(rows: int, missing_fraction: float) -> AdaptiveNumericImputer:
    rng = np.random.default_rng(0)
    values = rng.normal(size=(rows, 2))
    count = int(values.size * missing_fraction)
    if count:
        flat = values.reshape(-1)
        flat[rng.choice(flat.size, size=count, replace=False)] = np.nan
    return AdaptiveNumericImputer().fit(values)


def test_adaptive_imputer_uses_knn_for_small_complex_missingness() -> None:
    imputer = _imputer_for(100, 0.10)

    assert imputer.strategy_ == "knn"
    assert np.isfinite(imputer.transform(np.array([[np.nan, 1.0]]))).all()


def test_adaptive_imputer_uses_median_above_the_row_cap() -> None:
    imputer = _imputer_for(20_001, 0.10)

    assert imputer.strategy_ == "median"


@pytest.mark.parametrize("missing_fraction", [0.0, 0.01, 0.60])
def test_adaptive_imputer_uses_median_outside_the_missingness_band(
    missing_fraction: float,
) -> None:
    imputer = _imputer_for(100, missing_fraction)

    assert imputer.strategy_ == "median"


def test_adaptive_imputer_is_reproducible() -> None:
    values = np.array([[1.0, 2.0], [np.nan, 3.0], [4.0, np.nan], [5.0, 6.0]])

    first = AdaptiveNumericImputer().fit(values).transform(values)
    second = AdaptiveNumericImputer().fit(values).transform(values)

    np.testing.assert_allclose(first, second)


def test_build_preprocessor_fits_and_transforms_finite_values() -> None:
    frame = build_preprocessing_frame()
    report = profile_frame(frame, "test-dataset")
    partition = partition_features(frame, "target", ["excluded_col"], report)
    features = (
        partition.numeric
        + partition.low_cardinality_categorical
        + partition.high_cardinality_categorical
    )
    X = frame.select(features)
    y = frame["target"].to_numpy()

    preprocessor = build_preprocessor(partition, TaskType.CLASSIFICATION)
    transformed = preprocessor.fit_transform(X, y)

    assert transformed.shape[0] == frame.height
    assert np.isfinite(transformed).all()


def test_target_encoder_and_one_hot_handle_unseen_categories() -> None:
    frame = build_preprocessing_frame()
    report = profile_frame(frame, "test-dataset")
    partition = partition_features(frame, "target", ["excluded_col"], report)
    features = (
        partition.numeric
        + partition.low_cardinality_categorical
        + partition.high_cardinality_categorical
    )
    preprocessor = build_preprocessor(partition, TaskType.CLASSIFICATION)
    fit_output = preprocessor.fit_transform(frame.select(features), frame["target"].to_numpy())

    unseen = pl.DataFrame(
        {
            "numeric_a": [1.0, 2.0],
            "numeric_b": [0.5, 0.7],
            "city": ["new-city", "delhi"],
            "id_like": ["id-new", "id-0"],
        }
    )
    transformed = preprocessor.transform(unseen)

    assert transformed.shape == (2, fit_output.shape[1])
    assert np.isfinite(transformed).all()


def test_describe_preprocessor_reports_what_ran() -> None:
    frame = build_preprocessing_frame()
    report = profile_frame(frame, "test-dataset")
    partition = partition_features(frame, "target", ["excluded_col"], report)
    features = (
        partition.numeric
        + partition.low_cardinality_categorical
        + partition.high_cardinality_categorical
    )
    preprocessor = build_preprocessor(partition, TaskType.CLASSIFICATION)
    preprocessor.fit(frame.select(features), frame["target"].to_numpy())

    plan = describe_preprocessor(preprocessor, partition)
    kinds = [step.kind for step in plan.steps]

    assert kinds == [
        "numeric_impute",
        "iqr_clip",
        "categorical_impute",
        "one_hot_encode",
        "categorical_impute",
        "target_encode",
        "drop",
    ]
    impute = next(step for step in plan.steps if step.kind == "numeric_impute")
    assert impute.strategy == "knn"
    assert plan.target_encoding == ["id_like"]
    assert plan.one_hot_encoding == ["city"]
    assert plan.numeric_features == ["numeric_a", "numeric_b"]
    assert any("constant column" in note for note in plan.notes)


def test_describe_preprocessor_reports_standard_scaling() -> None:
    frame = build_preprocessing_frame()
    report = profile_frame(frame, "test-dataset")
    partition = partition_features(frame, "target", ["excluded_col"], report)
    features = (
        partition.numeric
        + partition.low_cardinality_categorical
        + partition.high_cardinality_categorical
    )
    preprocessor = build_preprocessor(partition, TaskType.CLASSIFICATION, scale_numeric=True)
    preprocessor.fit(frame.select(features), frame["target"].to_numpy())

    kinds = [step.kind for step in describe_preprocessor(preprocessor, partition).steps]

    assert "standard_scale" in kinds


def test_target_encoding_is_fitted_on_the_training_fold_only() -> None:
    rows = 120
    rng = np.random.default_rng(5)
    target = rng.normal(size=rows)
    frame = pl.DataFrame(
        {
            "num": rng.normal(size=rows),
            "cat": [f"c{index % 60}" for index in range(rows)],
            "target": target,
        }
    )
    report = profile_frame(frame, "test-dataset")
    partition = partition_features(frame, "target", [], report)
    X = frame.select(["num", "cat"])
    X_train, X_test = X[:80], X[80:]
    y_train = target[:80]

    preprocessor = build_preprocessor(partition, TaskType.REGRESSION)
    preprocessor.fit(X_train, y_train)
    held_out = preprocessor.transform(X_test)
    repeated = preprocessor.transform(X_test)
    np.testing.assert_allclose(held_out, repeated)

    # Fitting on the full data would let the held-out targets leak into the
    # encodings, so the same test rows would encode differently.
    leaky_target = target.copy()
    leaky_target[80:] = 1_000_000.0
    leaky = build_preprocessor(partition, TaskType.REGRESSION).fit(X, leaky_target)
    leaked = leaky.transform(X_test)

    assert not np.allclose(held_out, leaked)


def test_preprocessor_pickle_round_trip() -> None:
    frame = build_preprocessing_frame()
    report = profile_frame(frame, "test-dataset")
    partition = partition_features(frame, "target", ["excluded_col"], report)
    features = (
        partition.numeric
        + partition.low_cardinality_categorical
        + partition.high_cardinality_categorical
    )
    preprocessor = build_preprocessor(partition, TaskType.CLASSIFICATION)
    X = frame.select(features)
    preprocessor.fit(X, frame["target"].to_numpy())

    buffer = io.BytesIO()
    joblib.dump(preprocessor, buffer)
    buffer.seek(0)
    restored = joblib.load(buffer)

    np.testing.assert_allclose(restored.transform(X), preprocessor.transform(X))


def test_build_preprocessor_requires_usable_features() -> None:
    partition = FeaturePartition(
        target="target",
        dropped_constant=["constant_col"],
    )

    with pytest.raises(NoUsableFeaturesError):
        build_preprocessor(partition, TaskType.CLASSIFICATION)
