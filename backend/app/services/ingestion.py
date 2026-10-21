"""Dataset ingestion: format detection, validation and Polars loading."""

from __future__ import annotations

from pathlib import Path

import polars as pl

SUPPORTED_FORMATS: dict[str, str] = {
    ".csv": "csv",
    ".parquet": "parquet",
    ".pq": "parquet",
}


class UnsupportedDatasetError(ValueError):
    """Raised when an uploaded file cannot be ingested."""


class InvalidDatasetError(UnsupportedDatasetError):
    """Raised when an uploaded file is empty or otherwise unusable."""


def detect_format(filename: str) -> str:
    """Return the dataset format for a filename, or raise if unsupported."""

    suffix = Path(filename).suffix.lower()
    fmt = SUPPORTED_FORMATS.get(suffix)
    if fmt is None:
        supported = ", ".join(sorted(SUPPORTED_FORMATS))
        raise UnsupportedDatasetError(
            f"Unsupported file type '{suffix or filename}'. Supported types: {supported}."
        )
    return fmt


def validate_upload_size(size_bytes: int, max_bytes: int) -> None:
    """Reject empty uploads and uploads that exceed the configured size ceiling."""

    if size_bytes <= 0:
        raise InvalidDatasetError("Uploaded file is empty.")
    if size_bytes > max_bytes:
        limit_mb = max_bytes // (1024 * 1024)
        raise UnsupportedDatasetError(f"Uploaded file is larger than the {limit_mb} MB limit.")


def scan_dataset(path: Path, fmt: str) -> pl.LazyFrame:
    """Lazily scan a dataset so profiling streams instead of loading everything."""

    if fmt == "csv":
        return pl.scan_csv(path, infer_schema_length=10_000, ignore_errors=False)
    if fmt == "parquet":
        return pl.scan_parquet(path)
    raise UnsupportedDatasetError(f"Unsupported format '{fmt}'.")


def load_dataset(path: Path, fmt: str) -> pl.DataFrame:
    """Eagerly load a dataset into memory."""

    return scan_dataset(path, fmt).collect()


def collect_shape(path: Path, fmt: str) -> tuple[int, int]:
    """Return the row and column count without materialising the whole frame."""

    lazy = scan_dataset(path, fmt)
    columns = len(lazy.collect_schema().names())
    rows = lazy.select(pl.len()).collect().item()
    return int(rows), int(columns)
