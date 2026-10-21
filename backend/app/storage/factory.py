"""Storage backend selection."""

from functools import lru_cache

from app.core.config import get_settings
from app.storage.base import Storage
from app.storage.local import LocalStorage


@lru_cache
def get_storage() -> Storage:
    """Return the process-wide storage backend."""

    return LocalStorage(get_settings())
