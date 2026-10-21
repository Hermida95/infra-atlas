"""Infra Atlas API."""

from __future__ import annotations

import json
import logging
import os
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from functools import lru_cache
from pathlib import Path
from typing import Annotated, Any

from anyio import to_thread
from fastapi import APIRouter, Depends, FastAPI, HTTPException, Query, Request, Response, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from prometheus_client import CONTENT_TYPE_LATEST, generate_latest, start_http_server

from api.atlas import Atlas, atlas_from_bytes
from api.middleware import BodySizeLimitMiddleware, RateLimitMiddleware, RequestContextMiddleware
from api.observability import REGISTRY, configure_logging
from api.schemas import (
    DomainOut,
    NodeDetail,
    NodeSummary,
    PlanIn,
    PlanNoteOut,
    PlanOut,
    PlanStageOut,
    PlanStepOut,
    RequirementOut,
    SearchHitOut,
    SearchOut,
    SemanticChunkOut,
    SemanticHitOut,
    SemanticSearchOut,
)
from api.semantic import EmbedderUnavailableError, get_embedder, get_index, semantic_search
from api.settings import Settings
from brain.embeddings import Embedder
from brain.planner import UnknownRequirementError
from brain.vectors import (
    IndexModelMismatchError,
    IndexUnavailableError,
    SearchUnavailableError,
    VectorIndex,
)

REPO_MARKER = "pnpm-workspace.yaml"
DEFAULT_GRAPH_RELATIVE = Path("apps/web/src/data/graph.json")

log = logging.getLogger("api")

# What a client is told when something is missing. The exact cause (paths, exception text)
# goes to the log only: internal paths and stack details help an attacker, not a user.
GRAPH_UNAVAILABLE = "graph not available; run `brain graph`"
INDEX_UNAVAILABLE = "search index not available; run `brain embed`"
INDEX_MISMATCH = "search index was built with another embedding model; run `brain embed`"
MODEL_UNAVAILABLE = "embedding model not available"


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


def _unavailable(public: str, exc: Exception | None = None) -> HTTPException:
    log.warning(public, extra={"cause": str(exc) if exc else None})
    return HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, detail=public)


def load_graph(path: Path | None) -> bytes:
    if path is None:
        raise GraphUnavailableError("GRAPH_PATH is not set and the repo root could not be found")
    return _load_graph_bytes(path)


def get_graph_bytes(path: Annotated[Path | None, Depends(graph_path)]) -> bytes:
    try:
        return load_graph(path)
    except GraphUnavailableError as exc:
        raise _unavailable(GRAPH_UNAVAILABLE, exc) from exc


def get_atlas(raw: Annotated[bytes, Depends(get_graph_bytes)]) -> Atlas:
    return atlas_from_bytes(raw)


AtlasDep = Annotated[Atlas, Depends(get_atlas)]

router = APIRouter()


def vector_index() -> VectorIndex:
    try:
        return get_index()
    except IndexUnavailableError as exc:
        raise _unavailable(INDEX_UNAVAILABLE, exc) from exc


def embedder() -> Embedder:
    try:
        return get_embedder()
    except EmbedderUnavailableError as exc:
        raise _unavailable(MODEL_UNAVAILABLE, exc) from exc


@router.get("/health")
def health() -> dict[str, str]:
    """Liveness: the process answers. Never checks dependencies, so a missing index does not
    make Kubernetes restart every pod."""
    return {"status": "ok"}


def readiness(request: Request) -> dict[str, str]:
    """Each dependency /search and /graph need, as ok or a short reason (no paths)."""
    checks: dict[str, str] = {}
    try:
        load_graph(graph_path())
        checks["graph"] = "ok"
    except GraphUnavailableError as exc:
        log.warning("readiness: graph", extra={"cause": str(exc)})
        checks["graph"] = "unavailable"
    try:
        index = get_index()
        checks["index"] = "ok"
    except IndexUnavailableError as exc:
        log.warning("readiness: index", extra={"cause": str(exc)})
        checks["index"] = checks["model"] = "unavailable"
        return checks
    # Honour a test override of the `embedder` dependency, like the routes do.
    resolve = request.app.dependency_overrides.get(embedder, get_embedder)
    try:
        index.check(resolve())
        checks["model"] = "ok"
    except IndexModelMismatchError as exc:
        log.warning("readiness: model", extra={"cause": str(exc)})
        checks["model"] = "mismatch"
    except EmbedderUnavailableError as exc:
        log.warning("readiness: model", extra={"cause": str(exc)})
        checks["model"] = "unavailable"
    return checks


@router.get("/ready", responses={503: {"description": "A dependency is not ready"}})
def ready(request: Request) -> JSONResponse:
    """Readiness: 200 only when graph, index and model are loaded and compatible."""
    checks = readiness(request)
    ok = all(value == "ok" for value in checks.values())
    return JSONResponse(
        {"status": "ready" if ok else "not ready", "checks": checks},
        status_code=status.HTTP_200_OK if ok else status.HTTP_503_SERVICE_UNAVAILABLE,
    )


metrics_router = APIRouter()


@metrics_router.get("/metrics", include_in_schema=False)
def metrics() -> Response:
    """Prometheus metrics on the main port, used when METRICS_PORT is not set (local dev).
    With METRICS_PORT they are served by their own listener and this route does not exist."""
    return Response(generate_latest(REGISTRY), media_type=CONTENT_TYPE_LATEST)


@router.get("/graph")
def graph(raw: Annotated[bytes, Depends(get_graph_bytes)]) -> Response:
    # Served as stored bytes: no parse/re-serialize per request.
    return Response(content=raw, media_type="application/json")


@router.get("/domains")
def domains(atlas: AtlasDep) -> list[DomainOut]:
    return [
        DomainOut(
            id=d["id"],
            name=d["name"],
            order=d["order"],
            hue=d["hue"],
            node_count=atlas.node_count(d["id"]),
        )
        for d in atlas.domains
    ]


@router.get("/requirements")
def requirements(atlas: AtlasDep) -> list[RequirementOut]:
    return [RequirementOut(**r.model_dump()) for r in atlas.requirements]


@router.get("/nodes")
def nodes(
    atlas: AtlasDep,
    domain: str | None = None,
    type: str | None = None,
    level: str | None = None,
) -> list[NodeSummary]:
    return [NodeSummary.of(n) for n in atlas.filter_nodes(domain=domain, type=type, level=level)]


@router.get("/nodes/{node_id}", responses={404: {"description": "No node with that id"}})
def node(node_id: str, atlas: AtlasDep) -> NodeDetail:
    found = atlas.by_id.get(node_id)
    if found is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail=f"no node {node_id!r}")
    related = [NodeSummary.of(n) for n in atlas.related(node_id)]
    return NodeDetail.model_validate({**found, "related": related})


@router.get("/search", responses={503: {"description": "No vector index: run `brain embed`"}})
def search(
    index: Annotated[VectorIndex, Depends(vector_index)],
    model: Annotated[Embedder, Depends(embedder)],
    q: Annotated[str, Query(min_length=1, max_length=200, pattern=r"\S")],
    k: Annotated[int, Query(ge=1, le=20)] = 5,
) -> SemanticSearchOut:
    """Search by meaning: the best matching chunk of each concept, closest first."""
    try:
        hits = semantic_search(index, model, q.strip(), k)
    except IndexModelMismatchError as exc:
        raise _unavailable(INDEX_MISMATCH, exc) from exc
    return SemanticSearchOut(
        query=q,
        model=f"{model.provider}:{model.model}",
        hits=[
            SemanticHitOut(
                id=h.node_id,
                title=h.title,
                score=h.score,
                chunk=SemanticChunkOut(id=h.chunk.id, kind=h.chunk.kind, text=h.chunk.text),
            )
            for h in hits
        ],
    )


@router.get("/search/keyword")
def search_keyword(
    atlas: AtlasDep,
    q: Annotated[str, Query(min_length=1, max_length=200)],
    limit: Annotated[int, Query(ge=1, le=50)] = 10,
) -> SearchOut:
    """Every word of `q` must appear in the concept. The baseline /search is measured against."""
    hits = [
        SearchHitOut(**NodeSummary.of(h.node).model_dump(), score=h.score)
        for h in atlas.search(q, limit)
    ]
    return SearchOut(query=q, hits=hits)


@router.post("/plan", responses={422: {"description": "Unknown requirement id"}})
def plan(body: PlanIn, atlas: AtlasDep) -> PlanOut:
    try:
        result = atlas.plan(body.requirements, body.text)
    except UnknownRequirementError as exc:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail={
                "message": str(exc),
                "unknown": exc.unknown,
                "known": [r.id for r in atlas.requirements],
            },
        ) from exc
    return PlanOut(
        requirements=result.requirements,
        stages=[
            PlanStageOut(
                stage=stage,
                steps=[
                    PlanStepOut(
                        id=n["id"], title=n["title"], domain=n["domain"], why=n["planner"]["why"]
                    )
                    for n in steps
                ],
            )
            for stage, steps in result.stages
        ],
        notes=[PlanNoteOut(node=n["id"], text=text) for n, text in result.notes],
    )


def _warm_up() -> None:
    """Load everything /ready checks, and run one query so the ONNX session is initialised.

    Failures are logged, not raised: the process still starts, /health answers and /ready
    reports what is missing, which is easier to debug than a crash loop. That includes the
    ONNX session failing on its first query (a RuntimeError), not only a model that did not load.
    """
    try:
        load_graph(graph_path())
        index = get_index()
        model = get_embedder()
        index.check(model)
        model.embed_query("warm up")
        log.info("warm-up complete", extra={"chunks": len(index), "model": model.model})
    except (GraphUnavailableError, SearchUnavailableError) as exc:
        log.warning("warm-up incomplete", extra={"cause": str(exc)})
    except RuntimeError as exc:
        log.warning("warm-up failed", extra={"cause": f"{type(exc).__name__}: {exc}"})


def _start_metrics_server(port: int) -> Any | None:
    """Serve /metrics on its own port, on all interfaces so the scraper can reach the pod.
    Not exposed by the Service or the Ingress unless the deployment adds it. A port that
    cannot be bound is logged, not fatal: the API matters more than its metrics."""
    if port <= 0:
        return None
    try:
        server, _ = start_http_server(port, registry=REGISTRY)
    except OSError as exc:
        log.warning("metrics listener not started", extra={"cause": str(exc), "port": port})
        return None
    return server


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or Settings.from_env()

    @asynccontextmanager
    async def lifespan(_: FastAPI) -> AsyncIterator[None]:
        configure_logging(settings.log_format, settings.log_level)
        metrics_server = _start_metrics_server(settings.metrics_port)
        if settings.warmup:
            await to_thread.run_sync(_warm_up)
        try:
            yield
        finally:
            if metrics_server is not None:
                metrics_server.shutdown()

    docs: dict[str, Any] = (
        {}
        if settings.docs_enabled
        else {
            "docs_url": None,
            "redoc_url": None,
            "openapi_url": None,
        }
    )
    application = FastAPI(title="Infra Atlas API", version="0.1.0", lifespan=lifespan, **docs)
    application.include_router(router)
    if settings.metrics_port <= 0:
        application.include_router(metrics_router)
    # Added inside out: the last one wraps all the others.
    application.add_middleware(BodySizeLimitMiddleware, max_bytes=settings.max_body_bytes)
    application.add_middleware(RateLimitMiddleware, per_minute=settings.rate_limit_per_minute)
    application.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_methods=["GET", "POST"],
        allow_headers=["content-type", "x-request-id"],
        expose_headers=["x-request-id"],
        allow_credentials=False,
        max_age=600,
    )
    application.add_middleware(RequestContextMiddleware)
    return application


app = create_app()
