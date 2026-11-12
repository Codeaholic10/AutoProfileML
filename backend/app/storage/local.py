"""Local disk implementation of the storage contract."""

import shutil
import uuid
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
            settings.benchmarks_dir,
            settings.artifacts_dir,
        ):
            directory.mkdir(parents=True, exist_ok=True)

    def dataset_path(self, dataset_id: str, filename: str) -> Path:
        safe_name = Path(filename).name
        return self._settings.datasets_dir / dataset_id / safe_name

    def write_bytes(self, path: Path, data: bytes) -> Path:
        """Write bytes atomically: a sibling temp file is replaced into place."""

        path.parent.mkdir(parents=True, exist_ok=True)
        temp_path = path.with_name(f".{path.name}.{uuid.uuid4().hex}.tmp")
        try:
            temp_path.write_bytes(data)
            temp_path.replace(path)
        finally:
            temp_path.unlink(missing_ok=True)
        return path

    def write_text(self, path: Path, text: str) -> Path:
        """Write text atomically: a sibling temp file is replaced into place."""

        path.parent.mkdir(parents=True, exist_ok=True)
        temp_path = path.with_name(f".{path.name}.{uuid.uuid4().hex}.tmp")
        try:
            temp_path.write_text(text, encoding="utf-8")
            temp_path.replace(path)
        finally:
            temp_path.unlink(missing_ok=True)
        return path

    def read_text(self, path: Path) -> str:
        return path.read_text(encoding="utf-8")

    def exists(self, path: Path) -> bool:
        return path.exists()

    def delete(self, path: Path) -> None:
        if path.exists():
            path.unlink()

    def delete_tree(self, path: Path) -> None:
        root = self._settings.storage_root.resolve()
        target = path.resolve()
        if target == root or not target.is_relative_to(root):
            raise ValueError("Refusing to delete a path outside the storage root.")
        if target.exists():
            shutil.rmtree(target)
