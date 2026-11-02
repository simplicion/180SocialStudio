"""Worker settings, read once from the environment."""
from __future__ import annotations

import os
import sys
from dataclasses import dataclass, field

# Sources the last30days engine may query. Only lanes whose terms allow server-side commercial use are enabled by
# default. Reddit is NOT run through last30days (its keyless path is blocked and its other paths are third-party
# scrapers); it has its own official-API lane below.
DEFAULT_L30_SOURCES = ("hackernews", "polymarket", "github")


def _flag(name: str) -> bool:
    return os.environ.get(name, "").strip().lower() in {"1", "true", "yes", "on"}


@dataclass(frozen=True)
class Settings:
    secret: str = field(default_factory=lambda: os.environ.get("TREND_WORKER_SECRET", ""))
    allow_no_secret: bool = field(default_factory=lambda: _flag("TREND_WORKER_ALLOW_NO_SECRET"))
    # Path to skills/last30days/scripts/last30days.py of a pinned checkout. Empty = native lanes only.
    last30days_script: str = field(default_factory=lambda: os.environ.get("LAST30DAYS_SCRIPT", ""))
    python_bin: str = field(default_factory=lambda: os.environ.get("LAST30DAYS_PYTHON", sys.executable))
    pulse_timeout_s: float = field(default_factory=lambda: float(os.environ.get("TREND_WORKER_PULSE_TIMEOUT", "90")))
    max_concurrency: int = field(default_factory=lambda: int(os.environ.get("TREND_WORKER_CONCURRENCY", "4")))
    fetch_timeout_s: float = field(default_factory=lambda: float(os.environ.get("TREND_WORKER_FETCH_TIMEOUT", "10")))
    fetch_max_bytes: int = field(default_factory=lambda: int(os.environ.get("TREND_WORKER_FETCH_MAX_BYTES", str(2_000_000))))
    markdown_max_chars: int = 8000
    user_agent: str = "180StudioResearchBot/1.0 (+https://180workspace.com/bot)"
    # Optional official credentials. They are passed to last30days explicitly; nothing else from this process's
    # environment is (no LLM keys, so topics are never sent to a third-party model for reranking).
    github_token: str = field(default_factory=lambda: os.environ.get("TREND_WORKER_GITHUB_TOKEN", ""))
    x_bearer_token: str = field(default_factory=lambda: os.environ.get("TREND_WORKER_X_BEARER_TOKEN", ""))
    # Official Reddit API (app-only OAuth). Requires Reddit's approval for commercial use; off until both are set.
    reddit_client_id: str = field(default_factory=lambda: os.environ.get("REDDIT_CLIENT_ID", ""))
    reddit_client_secret: str = field(default_factory=lambda: os.environ.get("REDDIT_CLIENT_SECRET", ""))

    @property
    def l30_sources(self) -> tuple[str, ...]:
        return DEFAULT_L30_SOURCES + (("x",) if self.x_bearer_token else ())

    @property
    def reddit_enabled(self) -> bool:
        return bool(self.reddit_client_id and self.reddit_client_secret)

    @property
    def all_sources(self) -> tuple[str, ...]:
        return self.l30_sources + (("reddit",) if self.reddit_enabled else ())


def get_settings() -> Settings:
    return Settings()
