"""Infra Atlas API."""

from __future__ import annotations

import json
import os
from functools import lru_cache
from pathlib import Path
from typing import Annotated

from fastapi import Depends, FastAPI, HTTPException, Response, status
from fastapi.middleware.cors import CORSMiddleware

REPO_MARKER = "pnpm-workspace.yaml"
DEFAULT_GRAPH_RELATIVE = Path("apps/web/src/data/graph.json")
ALLOWED_ORIGINS = ["http://localhost:3000"]


class GraphUnavailableError(Exception):
    pass


def _default_graph_path() -> Path | None:
    here = Path(__file__).resolve()
    for directory in here.parents:
        if (directory / REPO_MARKER).is_file():
            return directory / DEFAULT_GRAPH_RELATIVE
    return None


def graph_path() -> Path | None:
    configured = os.environ.get("GRAPH_PATH")
    return Path(configured) if configured else _default_graph_path()


@lru_cache(maxsize=4)
def _load_graph_bytes(path: Path) -> bytes:
    """Read and check once per path. Failures raise, so they are never cached."""
    try:
        raw = path.read_bytes()
    except FileNotFoundError as exc:
        raise GraphUnavailableError(f"graph file not found at {path}; run `brain graph`") from exc
    except OSError as exc:
        raise GraphUnavailableError(f"graph file at {path} is not readable: {exc}") from exc
    try:
        json.loads(raw)
    except json.JSONDecodeError as exc:
        raise GraphUnavailableError(f"graph file at {path} is not valid JSON: {exc}") from exc
    return raw


def get_graph_bytes(path: Annotated[Path | None, Depends(graph_path)]) -> bytes:
    if path is None:
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="GRAPH_PATH is not set and the repo root could not be found",
        )
    try:
        return _load_graph_bytes(path)
    except GraphUnavailableError as exc:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)) from exc


app = FastAPI(title="Infra Atlas API", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_methods=["GET"],
    allow_headers=["*"],
)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/graph")
def graph(raw: Annotated[bytes, Depends(get_graph_bytes)]) -> Response:
    # Served as stored bytes: no parse/re-serialize per request.
    return Response(content=raw, media_type="application/json")
