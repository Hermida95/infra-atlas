"""Structured logs and Prometheus metrics.

Every log line is one JSON object carrying the request id, so a log collector (CloudWatch
Logs Insights, Loki) can filter one request across services. Metrics use route templates
(`/nodes/{node_id}`), never raw paths, so their cardinality stays bounded.
"""

from __future__ import annotations

import json
import logging
import sys
from contextvars import ContextVar
from datetime import UTC, datetime

from prometheus_client import CollectorRegistry, Counter, Histogram

request_id: ContextVar[str] = ContextVar("request_id", default="-")

REGISTRY = CollectorRegistry(auto_describe=True)
REQUESTS = Counter(
    "http_requests_total",
    "HTTP requests by method, route template and status code.",
    ["method", "route", "status"],
    registry=REGISTRY,
)
LATENCY = Histogram(
    "http_request_duration_seconds",
    "HTTP request latency by method and route template.",
    ["method", "route"],
    buckets=(0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5),
    registry=REGISTRY,
)
REJECTED = Counter(
    "http_requests_rejected_total",
    "Requests refused before reaching a route, by reason.",
    ["reason"],
    registry=REGISTRY,
)

_RESERVED = set(logging.makeLogRecord({}).__dict__) | {"message", "asctime"}


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        entry = {
            "time": datetime.fromtimestamp(record.created, UTC).isoformat(timespec="milliseconds"),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
            "request_id": request_id.get(),
        }
        entry.update({k: v for k, v in record.__dict__.items() if k not in _RESERVED})
        if record.exc_info:
            entry["exception"] = self.formatException(record.exc_info)
        return json.dumps(entry, default=str, ensure_ascii=False)


def configure_logging(log_format: str = "json", level: str = "INFO") -> None:
    """Route the app's and uvicorn's loggers through one handler on stdout."""
    handler = logging.StreamHandler(sys.stdout)
    if log_format == "json":
        handler.setFormatter(JsonFormatter())
    else:
        handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(name)s %(message)s"))
    root = logging.getLogger()
    root.handlers[:] = [handler]
    root.setLevel(level)
    for name in ("uvicorn", "uvicorn.error", "uvicorn.access"):
        logger = logging.getLogger(name)
        logger.handlers[:] = []
        logger.propagate = True
    # The request middleware writes one access line per request; uvicorn's would duplicate it.
    logging.getLogger("uvicorn.access").disabled = True
