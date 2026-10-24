import json
from collections.abc import Sequence
from functools import lru_cache
from pathlib import Path

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


_BACKEND_ENV_FILE = Path(__file__).resolve().parents[1] / ".env"
_PROJECT_ROOT = Path(__file__).resolve().parents[3]


class Settings(BaseSettings):
    app_name: str = "Protein Annotation Distribution Local Edition"
    app_version: str = "1.0.0"
    debug: bool = False

    project_root: Path = Field(default_factory=lambda: _PROJECT_ROOT)
    project_data_root: Path = Field(default_factory=lambda: _PROJECT_ROOT / "project_data")
    local_data_root: Path = Field(default_factory=lambda: _PROJECT_ROOT / "local_data")
    frontend_dist_root: Path = Field(default_factory=lambda: _PROJECT_ROOT / "src" / "frontend" / "dist")
    sqlite_relative_path: str = "database/web_database.sqlite"
    manifest_relative_path: str = "backend_ready/manifest.json"

    cors_origins: list[str] = Field(
        default_factory=lambda: ["http://127.0.0.1:8000", "http://localhost:8000"]
    )
    download_temp_dirname: str = "temp"
    download_archive_dirname: str = "archive"
    saved_workspace_max_bytes: int = Field(default=64 * 1024 * 1024, gt=0)

    model_config = SettingsConfigDict(
        env_prefix="WEB_SERVER_",
        case_sensitive=False,
        env_ignore_empty=True,
        env_file=_BACKEND_ENV_FILE,
        env_file_encoding="utf-8",
        extra="ignore",
    )

    @property
    def sqlite_path(self) -> Path:
        return self.project_data_root / self.sqlite_relative_path

    @property
    def manifest_path(self) -> Path:
        return self.project_data_root / self.manifest_relative_path

    @property
    def saved_queries_root(self) -> Path:
        return self.local_data_root / "saved_queries"

    @property
    def download_root(self) -> Path:
        return self.local_data_root / "downloads"

    @property
    def download_jobs_root(self) -> Path:
        return self.download_root / "jobs"

    @property
    def download_temp_root(self) -> Path:
        return self.download_root / self.download_temp_dirname

    @property
    def download_archive_root(self) -> Path:
        return self.download_root / self.download_archive_dirname

    def ensure_runtime_directories(self) -> None:
        for path in (
            self.local_data_root,
            self.saved_queries_root,
            self.download_root,
            self.download_jobs_root,
            self.download_temp_root,
            self.download_archive_root,
        ):
            path.mkdir(parents=True, exist_ok=True)

    @field_validator("cors_origins", mode="before")
    @classmethod
    def normalize_cors_origins(cls, value: object) -> list[str]:
        if value is None:
            return ["http://127.0.0.1:8000", "http://localhost:8000"]
        if isinstance(value, str):
            raw = value.strip()
            if not raw or raw == "*":
                return ["*"]
            try:
                parsed = json.loads(raw)
            except json.JSONDecodeError:
                parsed = [part.strip() for part in raw.replace(";", ",").split(",") if part.strip()]
            if isinstance(parsed, str):
                return [parsed]
            if isinstance(parsed, Sequence):
                return [str(item).strip() for item in parsed if str(item).strip()]
        elif isinstance(value, Sequence):
            return [str(item).strip() for item in value if str(item).strip()]
        return ["http://127.0.0.1:8000", "http://localhost:8000"]


@lru_cache
def get_settings() -> Settings:
    return Settings()
