"""Local disk implementation of the storage contract."""

from pathlib import Path

from app.core.config import Settings
from app.storage.base import Storage


class LocalStorage(Storage):
    """Filesystem-backed storage rooted at ``settings.storage_root``."""

    def __init__(self, settings: Settings) -> None:
        self._settings = settings
        for directory in (
            settings.storage_root,
            settings.datasets_dir,
            settings.profiles_dir,
            settings.artifacts_dir,
        ):
            directory.mkdir(parents=True, exist_ok=True)

    def dataset_path(self, dataset_id: str, filename: str) -> Path:
        safe_name = Path(filename).name
        return self._settings.datasets_dir / dataset_id / safe_name

    def write_bytes(self, path: Path, data: bytes) -> Path:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
        return path

    def write_text(self, path: Path, text: str) -> Path:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text, encoding="utf-8")
        return path

    def read_text(self, path: Path) -> str:
        return path.read_text(encoding="utf-8")

    def exists(self, path: Path) -> bool:
        return path.exists()

    def delete(self, path: Path) -> None:
        if path.exists():
            path.unlink()
