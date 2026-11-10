"""Tests for the profiling engine."""

from __future__ import annotations

import polars as pl
import pytest

from app.services.profiling import compute_vif, profile_frame
from tests.conftest import build_frame


def test_profile_report_shape(sample_frame: pl.DataFrame) -> None:
    report = profile_frame(sample_frame, "dataset-1")

    assert report.dataset_id == "dataset-1"
    assert report.row_count == sample_frame.height
    assert report.column_count == sample_frame.width
    assert report.numeric_columns >= 3
    assert report.categorical_columns >= 2
    assert report.duplicate_percentage >= 0.0
    assert report.duration_ms >= 0.0


def test_column_types_and_missingness(sample_frame: pl.DataFrame) -> None:
    report = profile_frame(sample_frame, "dataset-1")
    by_name = {column.name: column for column in report.columns}

    assert by_name["age"].semantic_type == "numeric"
    assert by_name["city"].semantic_type == "categorical"
    assert by_name["age"].null_count > 0
    assert 0 < by_name["age"].null_percentage < 100
    assert by_name["city"].top_values
    assert by_name["constant_col"].is_constant is True


def test_numeric_statistics_are_populated(sample_frame: pl.DataFrame) -> None:
    report = profile_frame(sample_frame, "dataset-1")
    income = next(column for column in report.columns if column.name == "income")

    assert income.mean is not None
    assert income.std is not None and income.std > 0
    assert income.q1 is not None and income.median is not None and income.q3 is not None
    assert income.q1 <= income.median <= income.q3
    assert income.minimum is not None and income.maximum is not None
    assert income.minimum <= income.maximum


def test_skewness_flagged_for_exponential_column(sample_frame: pl.DataFrame) -> None:
    report = profile_frame(sample_frame, "dataset-1")
    by_name = {column.name: column for column in report.columns}

    assert by_name["income"].skewness is not None
    assert by_name["income"].skewness > 1.0
    assert any(warning.code == "skewed_distribution" for warning in report.warnings)


def test_collinearity_detects_duplicated_feature(sample_frame: pl.DataFrame) -> None:
    report = profile_frame(sample_frame, "dataset-1")
    findings = {finding.feature: finding for finding in report.collinearity}

    assert findings, "expected VIF findings for numeric columns"
    assert findings["income_copy"].vif > 5.0
    assert findings["income_copy"].severity in ("moderate", "severe")


def test_profile_includes_rounded_correlation_matrix(sample_frame: pl.DataFrame) -> None:
    report = profile_frame(sample_frame, "dataset-1")
    matrix = report.correlation

    assert matrix is not None
    assert matrix.features == ["age", "income", "income_copy", "score"]
    assert all(len(row) == len(matrix.features) for row in matrix.values)
    assert all(matrix.values[index][index] == 1.0 for index in range(len(matrix.features)))

    position = {name: index for index, name in enumerate(matrix.features)}
    correlation = matrix.values[position["income"]][position["income_copy"]]
    assert correlation > 0.99
    assert all(round(value, 4) == value for row in matrix.values for value in row)


def test_correlation_is_null_with_fewer_than_two_numeric_columns() -> None:
    frame = pl.DataFrame({"a": [1.0, 2.0, 3.0, 4.0], "label": ["x", "y", "z", "w"]})

    assert profile_frame(frame, "single-numeric").correlation is None


def test_correlation_is_null_above_the_feature_cap() -> None:
    frame = pl.DataFrame(
        {f"c{index}": [float(index + row) for row in range(50)] for index in range(41)}
    )

    report = profile_frame(frame, "wide")

    assert report.correlation is None
    assert report.collinearity == []


def test_vif_skips_constant_columns(sample_frame: pl.DataFrame) -> None:
    frame = sample_frame.with_columns(pl.lit(3.0).alias("flat"))
    findings = compute_vif(frame, ["age", "flat"])

    assert all(finding.feature != "flat" for finding in findings)


def test_vif_returns_empty_for_single_feature(sample_frame: pl.DataFrame) -> None:
    assert compute_vif(sample_frame, ["age"]) == []
    assert compute_vif(sample_frame, []) == []


def test_vif_handles_disjoint_missingness() -> None:
    frame = pl.DataFrame(
        {
            "a": [1.0, 2.0, None, 4.0, 5.0, 6.0],
            "b": [None, 2.0, 3.0, 4.0, 5.0, 6.0],
            "c": [2.0, 4.0, 6.0, 8.0, 10.0, 12.0],
        }
    )
    findings = compute_vif(frame, ["a", "b", "c"])

    assert findings, "expected complete-case VIF results despite disjoint gaps"
    assert all(finding.vif > 0 for finding in findings)
    assert any(finding.feature == "c" and finding.correlated_with for finding in findings)


def test_vif_handles_all_null_column() -> None:
    frame = pl.DataFrame(
        {
            "a": [1.0, 2.0, 3.0, 4.0],
            "b": [None, None, None, None],
            "c": [2.0, 4.0, 6.0, 8.0],
        }
    )
    findings = compute_vif(frame, ["a", "b", "c"])

    assert all(finding.feature != "b" for finding in findings)


def test_warnings_cover_constant_and_missing_columns(sample_frame: pl.DataFrame) -> None:
    report = profile_frame(sample_frame, "dataset-1")
    codes = {warning.code for warning in report.warnings}

    assert "constant_column" in codes
    assert "missing_values" in codes


def test_profile_rejects_empty_frame() -> None:
    empty = pl.DataFrame({"a": []})
    with pytest.raises(ValueError, match="empty"):
        profile_frame(empty, "dataset-empty")


def test_profiling_scales_to_larger_frames() -> None:
    frame = build_frame(rows=120_000, seed=11)
    report = profile_frame(frame, "dataset-large")

    assert report.row_count == 120_000
    assert report.duration_ms < 15_000
