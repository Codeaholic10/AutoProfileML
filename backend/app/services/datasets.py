"""Dataset registry and profiling orchestration."""

from __future__ import annotations

import json
import re
from datetime import UTC, datetime
from pathlib import Path

from app.core.config import Settings, get_settings
from app.core.jobs import JobStore, get_job_store
from app.models.benchmark import BenchmarkRun
from app.models.schemas import (
    DatasetListItem,
    DatasetSummary,
    JobStatus,
    ProfileReport,
)
from app.services import ingestion, profiling
from app.storage.base import Storage
from app.storage.factory import get_storage

METADATA_FILENAME = "dataset.json"
PROFILE_FILENAME = "profile.json"
# Dataset ids are server-generated hex strings; tests use short mnemonic names.
_DATASET_ID_PATTERN = re.compile(r"^[A-Za-z0-9_-]{1,128}$")


def _utcnow() -> datetime:
    return datetime.now(UTC)


class DatasetNotFoundError(KeyError):
    """Raised when a dataset id is unknown."""


class ProfileNotFoundError(KeyError):
    """Raised when a dataset has no stored profile yet."""


def _validate_dataset_id(dataset_id: str) -> None:
    """Reject ids that could otherwise resolve paths outside the storage root."""

    if _DATASET_ID_PATTERN.fullmatch(dataset_id) is None:
        raise DatasetNotFoundError(dataset_id)


class DatasetService:
    """Coordinates storage, ingestion and profiling for uploaded datasets."""

    def __init__(
        self,
        storage: Storage | None = None,
        job_store: JobStore | None = None,
        settings: Settings | None = None,
    ) -> None:
        self._storage = storage or get_storage()
        self._jobs = job_store or get_job_store()
        self._settings = settings or get_settings()

    @property
    def storage(self) -> Storage:
        return self._storage

    def _metadata_path(self, dataset_id: str) -> Path:
        return self._settings.storage_root / "datasets" / dataset_id / METADATA_FILENAME

    def _profile_path(self, dataset_id: str) -> Path:
        return self._settings.profiles_dir / f"{dataset_id}.json"

    def save_upload(self, dataset_id: str, filename: str, payload: bytes) -> DatasetSummary:
        """Persist an upload and its metadata, returning a dataset summary."""

        _validate_dataset_id(dataset_id)
        ingestion.validate_upload_size(len(payload), self._settings.max_upload_bytes)
        fmt = ingestion.detect_format(filename)
        path = self._storage.dataset_path(dataset_id, filename)
        self._storage.write_bytes(path, payload)

        summary = DatasetSummary(
            dataset_id=dataset_id,
            filename=path.name,
            format=fmt,  # type: ignore[arg-type]
            size_bytes=len(payload),
            uploaded_at=_utcnow(),
        )
        self._storage.write_text(self._metadata_path(dataset_id), summary.model_dump_json())
        return summary

    def get_dataset(self, dataset_id: str) -> DatasetSummary:
        """Load dataset metadata, raising when it does not exist."""

        _validate_dataset_id(dataset_id)
        path = self._metadata_path(dataset_id)
        if not self._storage.exists(path):
            raise DatasetNotFoundError(dataset_id)
        return DatasetSummary.model_validate_json(self._storage.read_text(path))

    def dataset_file(self, dataset_id: str) -> Path:
        """Return the absolute path of the stored dataset file."""

        summary = self.get_dataset(dataset_id)
        return self._storage.dataset_path(dataset_id, summary.filename)

    def update_dataset_shape(
        self, dataset_id: str, row_count: int, column_count: int
    ) -> DatasetSummary:
        """Persist row/column counts discovered while profiling."""

        summary = self.get_dataset(dataset_id)
        summary.row_count = row_count
        summary.column_count = column_count
        self._storage.write_text(self._metadata_path(dataset_id), summary.model_dump_json())
        return summary

    def store_profile(self, report: ProfileReport) -> ProfileReport:
        """Persist a profile report."""

        self._storage.write_text(self._profile_path(report.dataset_id), report.model_dump_json())
        return report

    def record_profile(self, report: ProfileReport) -> ProfileReport:
        """Persist the profile and the shape it was computed from together.

        Keep both writes behind one call so a failed profile job never leaves
        the stored shape describing a different frame than the stored report:
        the profile is written first, then metadata, so a reader that sees the
        new shape can rely on the matching report.
        """

        self.store_profile(report)
        self.update_dataset_shape(report.dataset_id, report.row_count, report.column_count)
        return report

    def get_profile(self, dataset_id: str) -> ProfileReport:
        """Load a stored profile report.

        Dataset existence is checked first so an unknown dataset reports 404
        rather than being mistaken for a dataset whose profile is still pending.
        """

        self.get_dataset(dataset_id)
        path = self._profile_path(dataset_id)
        if not self._storage.exists(path):
            raise ProfileNotFoundError(dataset_id)
        return ProfileReport.model_validate_json(self._storage.read_text(path))

    def has_profile(self, dataset_id: str) -> bool:
        return self._storage.exists(self._profile_path(dataset_id))

    def delete_dataset(self, dataset_id: str) -> None:
        """Delete a dataset file, its metadata, profile and benchmark runs.

        The profile is removed first so a failure while removing the directory
        cannot leave a profile referring to a dataset that no longer exists.
        """

        self.get_dataset(dataset_id)

        profile_path = self._profile_path(dataset_id)
        if self._storage.exists(profile_path):
            self._storage.delete(profile_path)

        self._delete_benchmarks(dataset_id)
        self._storage.delete_tree(self._settings.datasets_dir / dataset_id)

    def _delete_benchmarks(self, dataset_id: str) -> None:
        directory = self._settings.benchmarks_dir
        if not directory.exists():
            return
        for entry in directory.iterdir():
            if not entry.is_dir():
                continue
            run_path = entry / "run.json"
            if not self._storage.exists(run_path):
                continue
            try:
                run = BenchmarkRun.model_validate_json(self._storage.read_text(run_path))
            except ValueError:
                continue
            if run.dataset_id == dataset_id:
                self._storage.delete_tree(entry)

    def list_datasets(self) -> list[DatasetListItem]:
        """List every known dataset with its latest job state."""

        datasets_dir = self._settings.datasets_dir
        if not datasets_dir.exists():
            return []

        items: list[DatasetListItem] = []
        for entry in sorted(datasets_dir.iterdir()):
            if not entry.is_dir():
                continue
            try:
                summary = self.get_dataset(entry.name)
            except (DatasetNotFoundError, ValueError):
                continue
            items.append(
                DatasetListItem(
                    dataset=summary,
                    has_profile=self.has_profile(entry.name),
                    latest_job=self._jobs.latest_for_dataset(entry.name),
                )
            )
        return items

    def dataset_payload(self, dataset_id: str) -> dict[str, object]:
        """Return dataset metadata plus its profile for inspection endpoints."""

        summary = self.get_dataset(dataset_id)
        payload: dict[str, object] = summary.model_dump(mode="json")
        if self.has_profile(dataset_id):
            payload["profile"] = self.get_profile(dataset_id).model_dump(mode="json")
        return payload

    def run_profiling(self, job_id: str, dataset_id: str) -> None:
        """Background entrypoint: profile a stored dataset and store the report.

        Nothing is persisted until the frame has been fully parsed and
        profiled; a failure at any stage leaves the previous profile and shape
        untouched and only marks the job as failed.
        """

        summary: DatasetSummary | None = None
        try:
            self._jobs.update(job_id, status=JobStatus.RUNNING, stage="loading", progress=0.1)
            summary = self.get_dataset(dataset_id)
            path = self.dataset_file(dataset_id)

            self._jobs.update(job_id, stage="scanning", progress=0.3)
            ingestion.collect_shape(path, summary.format)

            self._jobs.update(job_id, stage="profiling", progress=0.6)
            frame = ingestion.load_dataset(path, summary.format)
            report = profiling.profile_frame(frame, dataset_id)

            self._jobs.update(job_id, stage="summarising", progress=0.9)
            self.record_profile(report)

            self._jobs.succeed(
                job_id,
                {
                    "dataset_id": dataset_id,
                    "row_count": report.row_count,
                    "column_count": report.column_count,
                    "warning_count": len(report.warnings),
                    "duration_ms": report.duration_ms,
                },
            )
        except Exception as exc:  # noqa: BLE001 - surfaced to the client as job error
            self._jobs.fail(job_id, self._describe_failure(dataset_id, summary, exc))

    @staticmethod
    def _describe_failure(dataset_id: str, summary: DatasetSummary | None, exc: Exception) -> str:
        """Build the job error, naming the dataset without leaking filesystem paths."""

        filename = summary.filename if summary is not None else dataset_id
        message = str(exc).strip() or type(exc).__name__
        return f"Could not profile '{filename}': {type(exc).__name__}: {message}"


def compact_json(payload: dict[str, object]) -> str:
    """Serialise a payload for logs and diagnostics."""

    return json.dumps(payload, default=str, separators=(",", ":"))
