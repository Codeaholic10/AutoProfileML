"""Statistical profiling engine.

Computes the Phase 1 profile payload: dtype detection, missingness, skewness,
kurtosis, cardinality, top values, VIF-based multicollinearity checks and
human-readable data-quality warnings.
"""

from __future__ import annotations

import math
import time
from typing import Literal

import numpy as np
import polars as pl

from app.models.schemas import (
    CollinearityFinding,
    ColumnProfile,
    CorrelationMatrix,
    ProfileReport,
    ProfilingWarning,
    TopValue,
)

NUMERIC_DTYPES = {
    pl.Int8,
    pl.Int16,
    pl.Int32,
    pl.Int64,
    pl.UInt8,
    pl.UInt16,
    pl.UInt32,
    pl.UInt64,
    pl.Float32,
    pl.Float64,
    pl.Decimal,
}

TEMPORAL_DTYPES = {pl.Date, pl.Datetime, pl.Duration, pl.Time}

SEVERE_MISSING_RATIO = 0.5
HIGH_CARDINALITY_RATIO = 0.5
CONSTANT_UNIQUE_THRESHOLD = 1
TOP_VALUES_LIMIT = 5
VIF_MODERATE_THRESHOLD = 5.0
VIF_SEVERE_THRESHOLD = 10.0
VIF_MIN_COLUMNS = 2
VIF_MIN_ROWS = 3
VIF_MAX_FEATURES = 40
SKEW_WARNING_THRESHOLD = 1.0


def _semantic_type(dtype: pl.DataType) -> str:
    if dtype in NUMERIC_DTYPES or isinstance(dtype, pl.Decimal):
        return "numeric"
    if dtype == pl.Boolean:
        return "boolean"
    if dtype in TEMPORAL_DTYPES or isinstance(dtype, (pl.Date, pl.Datetime, pl.Duration, pl.Time)):
        return "temporal"
    if dtype in (pl.String, pl.Categorical, pl.Enum):
        return "categorical"
    return "unknown"


def _finite_or_none(value: float | None) -> float | None:
    if value is None:
        return None
    if isinstance(value, float) and (math.isnan(value) or math.isinf(value)):
        return None
    return float(value)


def _column_profile(series: pl.Series, row_count: int) -> ColumnProfile:
    dtype = series.dtype
    semantic = _semantic_type(dtype)
    null_count = int(series.null_count())
    non_null = row_count - null_count

    profile = ColumnProfile(
        name=series.name,
        dtype=str(dtype),
        semantic_type=semantic,  # type: ignore[arg-type]
        null_count=null_count,
        null_percentage=round(null_count / row_count * 100, 4) if row_count else 0.0,
        unique_count=int(series.n_unique()),
        is_constant=series.n_unique() <= CONSTANT_UNIQUE_THRESHOLD,
    )

    if semantic == "numeric" and non_null > 0:
        numeric = series.cast(pl.Float64, strict=False).drop_nulls().to_numpy()
        numeric = numeric[np.isfinite(numeric)]
        if numeric.size:
            quantiles = np.quantile(numeric, [0.25, 0.5, 0.75])
            profile.mean = _finite_or_none(float(np.mean(numeric)))
            profile.std = (
                _finite_or_none(float(np.std(numeric, ddof=1))) if numeric.size > 1 else 0.0
            )
            profile.minimum = _finite_or_none(float(np.min(numeric)))
            profile.maximum = _finite_or_none(float(np.max(numeric)))
            profile.q1 = _finite_or_none(float(quantiles[0]))
            profile.median = _finite_or_none(float(quantiles[1]))
            profile.q3 = _finite_or_none(float(quantiles[2]))
            if numeric.size > 2 and profile.std:
                centered = numeric - np.mean(numeric)
                m2 = float(np.mean(centered**2))
                m3 = float(np.mean(centered**3))
                m4 = float(np.mean(centered**4))
                if m2 > 0:
                    profile.skewness = _finite_or_none(m3 / (m2**1.5))
                    profile.kurtosis = _finite_or_none(m4 / (m2**2) - 3.0)

    if semantic in ("categorical", "boolean") and non_null > 0:
        counts = (
            series.drop_nulls()
            .cast(pl.String)
            .value_counts(sort=True, name="count")
            .head(TOP_VALUES_LIMIT)
        )
        profile.top_values = [
            TopValue(
                value=str(row[0]),
                count=int(row[1]),
                percentage=round(int(row[1]) / non_null * 100, 4),
            )
            for row in counts.iter_rows()
        ]

    return profile


def _numeric_matrix(frame: pl.DataFrame, names: list[str]) -> tuple[np.ndarray, list[str]] | None:
    """Build a complete-case numeric matrix for collinearity analysis.

    Columns are selected pairwise only when they share enough non-null rows;
    rows with any missing value are dropped so every feature vector has the
    same length, which VIF requires.
    """

    if not names:
        return None

    subset = frame.select(names).cast(pl.Float64, strict=False)
    subset = subset.with_columns(
        [
            pl.when(pl.col(name).is_finite()).then(pl.col(name)).otherwise(None).alias(name)
            for name in names
        ]
    )
    dropped = subset.drop_nulls()
    if dropped.height < VIF_MIN_ROWS:
        dropped = subset.fill_null(strategy="mean").drop_nulls()
    if dropped.height < VIF_MIN_ROWS:
        return None

    kept = [name for name in names if dropped[name].std(ddof=1) not in (None, 0.0)]
    if len(kept) < VIF_MIN_COLUMNS:
        return None

    matrix = dropped.select(kept).to_numpy()
    if matrix.size == 0:
        return None
    matrix = np.nan_to_num(matrix, nan=0.0, posinf=0.0, neginf=0.0)
    return matrix, kept


def _correlation_pairs(matrix: np.ndarray, names: list[str]) -> dict[str, str]:
    """Map each feature to the feature it correlates with most strongly."""

    if matrix.shape[1] < 2:
        return {}
    with np.errstate(invalid="ignore", divide="ignore"):
        corr = np.corrcoef(matrix, rowvar=False)
    corr = np.nan_to_num(corr, nan=0.0)
    np.fill_diagonal(corr, 0.0)
    paired: dict[str, str] = {}
    for index, name in enumerate(names):
        strengths = np.abs(corr[index])
        if strengths.size == 0 or float(np.max(strengths)) == 0.0:
            continue
        paired[name] = names[int(np.argmax(strengths))]
    return paired


def _invert(matrix: np.ndarray) -> np.ndarray | None:
    try:
        return np.linalg.inv(matrix)
    except np.linalg.LinAlgError:
        return None


def compute_vif(
    frame: pl.DataFrame,
    names: list[str],
    prepared: tuple[np.ndarray, list[str]] | None = None,
) -> list[CollinearityFinding]:
    """Compute variance inflation factors for the numeric feature matrix.

    A constant or perfectly collinear block makes the correlation matrix
    singular; in that case the pseudo-inverse is used so severity is still
    reported instead of the check silently disappearing.

    ``prepared`` lets the caller share one complete-case matrix between VIF and
    the correlation report.
    """

    if len(names) < VIF_MIN_COLUMNS or len(names) > VIF_MAX_FEATURES:
        return []

    if prepared is None:
        prepared = _numeric_matrix(frame, names)
    if prepared is None:
        return []
    matrix, kept = prepared
    if len(kept) < VIF_MIN_COLUMNS:
        return []

    peers = _correlation_pairs(matrix, kept)

    with np.errstate(invalid="ignore", divide="ignore"):
        corr = np.corrcoef(matrix, rowvar=False)
    corr = np.nan_to_num(corr, nan=0.0)
    np.fill_diagonal(corr, 1.0)

    inverse = _invert(corr)
    if inverse is None:
        inverse = np.linalg.pinv(corr)

    findings: list[CollinearityFinding] = []
    for index, name in enumerate(kept):
        diagonal = float(inverse[index, index])
        if not math.isfinite(diagonal) or diagonal <= 0:
            diagonal = float("inf")
        vif = round(diagonal, 4)
        if vif >= VIF_SEVERE_THRESHOLD:
            severity: Literal["ok", "moderate", "severe"] = "severe"
        elif vif >= VIF_MODERATE_THRESHOLD:
            severity = "moderate"
        else:
            severity = "ok"
        findings.append(
            CollinearityFinding(
                feature=name,
                vif=vif,
                severity=severity,
                correlated_with=peers.get(name),
            )
        )

    return sorted(findings, key=lambda finding: finding.vif, reverse=True)


def _correlation_report(
    prepared: tuple[np.ndarray, list[str]] | None,
) -> CorrelationMatrix | None:
    """Build a rounded Pearson matrix from an already prepared feature matrix."""

    if prepared is None:
        return None
    matrix, names = prepared
    if len(names) < VIF_MIN_COLUMNS:
        return None

    with np.errstate(invalid="ignore", divide="ignore"):
        corr = np.corrcoef(matrix, rowvar=False)
    corr = np.nan_to_num(corr, nan=0.0)
    values = [[round(float(value), 4) for value in row] for row in corr]
    return CorrelationMatrix(features=list(names), values=values)


def _build_warnings(
    columns: list[ColumnProfile],
    collinearity: list[CollinearityFinding],
    duplicate_ratio: float,
    row_count: int,
) -> list[ProfilingWarning]:
    warnings: list[ProfilingWarning] = []

    for column in columns:
        if column.is_constant:
            warnings.append(
                ProfilingWarning(
                    code="constant_column",
                    severity="warning",
                    column=column.name,
                    message=f"Column '{column.name}' holds a single value and carries no signal.",
                )
            )
        if column.null_percentage >= SEVERE_MISSING_RATIO * 100:
            warnings.append(
                ProfilingWarning(
                    code="high_missingness",
                    severity="critical",
                    column=column.name,
                    message=(
                        f"Column '{column.name}' is {column.null_percentage:.1f}% missing; "
                        "consider dropping it or using a dedicated imputation strategy."
                    ),
                )
            )
        elif column.null_count > 0:
            warnings.append(
                ProfilingWarning(
                    code="missing_values",
                    severity="warning",
                    column=column.name,
                    message=(
                        f"Column '{column.name}' has {column.null_count} missing values "
                        f"({column.null_percentage:.2f}%)."
                    ),
                )
            )
        if (
            column.semantic_type == "categorical"
            and row_count
            and column.unique_count / row_count >= HIGH_CARDINALITY_RATIO
        ):
            warnings.append(
                ProfilingWarning(
                    code="high_cardinality",
                    severity="warning",
                    column=column.name,
                    message=(
                        f"Column '{column.name}' has {column.unique_count} distinct values; "
                        "target encoding will be used instead of one-hot encoding."
                    ),
                )
            )
        if column.skewness is not None and abs(column.skewness) >= SKEW_WARNING_THRESHOLD:
            warnings.append(
                ProfilingWarning(
                    code="skewed_distribution",
                    severity="info",
                    column=column.name,
                    message=(
                        f"Column '{column.name}' is heavily skewed "
                        f"(skew={column.skewness:.2f}); median imputation is preferred."
                    ),
                )
            )

    severe = [finding for finding in collinearity if finding.severity == "severe"]
    if severe:
        worst = severe[0]
        warnings.append(
            ProfilingWarning(
                code="multicollinearity",
                severity="critical",
                column=worst.feature,
                message=(
                    f"{len(severe)} feature(s) show severe multicollinearity "
                    f"(worst: '{worst.feature}', VIF={worst.vif:.2f})."
                ),
            )
        )
    elif collinearity:
        warnings.append(
            ProfilingWarning(
                code="multicollinearity",
                severity="info",
                message="No severe multicollinearity detected across numeric features.",
            )
        )

    if duplicate_ratio > 0:
        warnings.append(
            ProfilingWarning(
                code="duplicate_rows",
                severity="warning" if duplicate_ratio >= 0.1 else "info",
                message=f"{duplicate_ratio * 100:.2f}% of rows are exact duplicates.",
            )
        )

    return warnings


def profile_frame(frame: pl.DataFrame, dataset_id: str) -> ProfileReport:
    """Build a full profile report for an in-memory frame."""

    started = time.perf_counter()
    row_count = frame.height
    column_count = frame.width

    if row_count == 0:
        raise ValueError("Cannot profile an empty dataset.")

    columns = [_column_profile(frame[column], row_count) for column in frame.columns]
    numeric_names = [column.name for column in columns if column.semantic_type == "numeric"]
    prepared = (
        _numeric_matrix(frame, numeric_names)
        if VIF_MIN_COLUMNS <= len(numeric_names) <= VIF_MAX_FEATURES
        else None
    )
    collinearity = compute_vif(frame, numeric_names, prepared=prepared)
    correlation = _correlation_report(prepared)

    duplicate_rows = int(row_count - frame.unique().height)
    duplicate_ratio = duplicate_rows / row_count
    warnings = _build_warnings(columns, collinearity, duplicate_ratio, row_count)

    return ProfileReport(
        dataset_id=dataset_id,
        row_count=row_count,
        column_count=column_count,
        memory_bytes=int(frame.estimated_size()),
        duplicate_rows=duplicate_rows,
        duplicate_percentage=round(duplicate_ratio * 100, 4),
        duration_ms=round((time.perf_counter() - started) * 1000, 3),
        numeric_columns=sum(1 for c in columns if c.semantic_type == "numeric"),
        categorical_columns=sum(
            1 for c in columns if c.semantic_type in ("categorical", "boolean")
        ),
        columns=columns,
        collinearity=collinearity,
        correlation=correlation,
        warnings=warnings,
    )
