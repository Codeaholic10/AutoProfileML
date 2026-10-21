"""Shared pytest fixtures."""

from __future__ import annotations

import numpy as np
import polars as pl
import pytest

from app.core.config import Settings
from app.core.jobs import JobStore
from app.services.datasets import DatasetService
from app.storage.local import LocalStorage


@pytest.fixture
def settings(tmp_path) -> Settings:
    """Isolated settings pointing storage at a temporary directory."""

    return Settings(storage_root=tmp_path / "data", max_upload_mb=5)


@pytest.fixture
def storage(settings: Settings) -> LocalStorage:
    return LocalStorage(settings)


@pytest.fixture
def job_store() -> JobStore:
    return JobStore(retention_seconds=3600)


@pytest.fixture
def service(storage: LocalStorage, job_store: JobStore, settings: Settings) -> DatasetService:
    return DatasetService(storage=storage, job_store=job_store, settings=settings)


def build_frame(rows: int = 400, seed: int = 7) -> pl.DataFrame:
    """Deterministic synthetic frame with skew, missingness and collinearity."""

    rng = np.random.default_rng(seed)
    age = rng.normal(40, 12, rows).round(1)
    income = np.exp(rng.normal(10, 0.6, rows)).round(2)
    income_duplicate = income * 2.0 + rng.normal(0, 0.01, rows)
    city = rng.choice(["delhi", "mumbai", "pune", "chennai"], rows)
    constant = np.full(rows, "fixed")
    score = rng.integers(0, 100, rows)

    frame = pl.DataFrame(
        {
            "age": age,
            "income": income,
            "income_copy": income_duplicate,
            "city": city,
            "constant_col": constant,
            "score": score,
        }
    )

    nulls = rng.choice(rows, size=rows // 10, replace=False)
    frame = frame.with_columns(
        pl.when(pl.int_range(pl.len()).is_in(nulls))
        .then(None)
        .otherwise(pl.col("age"))
        .alias("age")
    )
    return frame


@pytest.fixture
def sample_frame() -> pl.DataFrame:
    return build_frame()


@pytest.fixture
def csv_bytes(sample_frame: pl.DataFrame) -> bytes:
    return sample_frame.write_csv().encode("utf-8")
