"""Runtime configuration for the AutoProfileML backend."""

from functools import lru_cache
from pathlib import Path

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Environment-driven settings.

    Every value can be overridden with an ``AUTOPROFILEML_``-prefixed
    environment variable, which keeps local development, tests and hosted
    deployments on the same code path.
    """

    model_config = SettingsConfigDict(
        env_prefix="AUTOPROFILEML_",
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    env: str = "development"
    storage_root: Path = Path("./data")
    max_upload_mb: int = Field(default=200, gt=0)
    cors_origins: list[str] = Field(default_factory=lambda: ["http://localhost:3000"])
    job_retention_seconds: int = Field(default=60 * 60 * 6, gt=0)

    @field_validator("cors_origins", mode="before")
    @classmethod
    def _split_origins(cls, value: object) -> object:
        if isinstance(value, str):
            return [origin.strip() for origin in value.split(",") if origin.strip()]
        return value

    @property
    def max_upload_bytes(self) -> int:
        return self.max_upload_mb * 1024 * 1024

    @property
    def datasets_dir(self) -> Path:
        return self.storage_root / "datasets"

    @property
    def profiles_dir(self) -> Path:
        return self.storage_root / "profiles"

    @property
    def benchmarks_dir(self) -> Path:
        return self.storage_root / "benchmarks"

    @property
    def artifacts_dir(self) -> Path:
        return self.storage_root / "artifacts"


@lru_cache
def get_settings() -> Settings:
    """Return a cached settings instance."""

    return Settings()
