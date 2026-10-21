"""Runtime configuration, read once from environment variables (twelve-factor style).

Defaults suit local development; the image and the Helm chart override what production needs.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field

TRUE = {"1", "true", "yes", "on"}


def _flag(name: str, default: bool) -> bool:
    value = os.environ.get(name)
    return default if value is None else value.strip().lower() in TRUE


def _int(name: str, default: int) -> int:
    value = os.environ.get(name)
    return default if value is None or not value.strip() else int(value)


def _list(name: str, default: str) -> list[str]:
    return [item.strip() for item in os.environ.get(name, default).split(",") if item.strip()]


@dataclass(frozen=True)
class Settings:
    # Browsers may call the API only from these origins (CORS). No credentials are allowed.
    cors_origins: list[str] = field(default_factory=lambda: ["http://localhost:3000"])
    # Interactive docs at /docs and /redoc, and the schema at /openapi.json.
    docs_enabled: bool = True
    # Requests per client IP per minute on the endpoints that cost CPU (/search, /plan).
    # 0 disables it. A real deployment also limits at the edge (API Gateway, Ingress, WAF).
    rate_limit_per_minute: int = 60
    # Largest request body accepted, in bytes. Only POST /plan has a body.
    max_body_bytes: int = 16 * 1024
    # Load the graph, the index and the embedding model at startup, before /ready says yes.
    warmup: bool = True
    # "json" for log collectors (CloudWatch, Loki); "text" for a human at a terminal.
    log_format: str = "json"
    log_level: str = "INFO"

    @classmethod
    def from_env(cls) -> Settings:
        return cls(
            cors_origins=_list("CORS_ORIGINS", "http://localhost:3000"),
            docs_enabled=_flag("API_DOCS", True),
            rate_limit_per_minute=_int("RATE_LIMIT_PER_MINUTE", 60),
            max_body_bytes=_int("MAX_BODY_BYTES", 16 * 1024),
            warmup=_flag("WARMUP", True),
            log_format=os.environ.get("LOG_FORMAT", "json").strip().lower(),
            log_level=os.environ.get("LOG_LEVEL", "INFO").strip().upper(),
        )
