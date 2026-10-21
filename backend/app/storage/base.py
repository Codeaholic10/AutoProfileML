"""Storage interface used by datasets, profiles and artifacts."""

from abc import ABC, abstractmethod
from pathlib import Path


class Storage(ABC):
    """Minimal file storage contract.

    Only the operations the platform actually needs are declared so the local
    disk implementation can later be swapped for an S3/MinIO backed one without
    touching the API or service layers.
    """

    @abstractmethod
    def dataset_path(self, dataset_id: str, filename: str) -> Path:
        """Return the location a dataset file should be written to."""

    @abstractmethod
    def write_bytes(self, path: Path, data: bytes) -> Path:
        """Persist raw bytes at ``path``."""

    @abstractmethod
    def write_text(self, path: Path, text: str) -> Path:
        """Persist text at ``path``."""

    @abstractmethod
    def read_text(self, path: Path) -> str:
        """Read a previously stored text payload."""

    @abstractmethod
    def exists(self, path: Path) -> bool:
        """Report whether a stored object exists."""

    @abstractmethod
    def delete(self, path: Path) -> None:
        """Remove a stored object if it exists."""
