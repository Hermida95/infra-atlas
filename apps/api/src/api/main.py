"""Infra Atlas API."""

from __future__ import annotations

import json
import os
from functools import lru_cache
from pathlib import Path
from typing import Annotated

from fastapi import Depends, FastAPI, HTTPException, Query, Response, status
from fastapi.middleware.cors import CORSMiddleware

from api.atlas import Atlas, atlas_from_bytes
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
from api.semantic import get_embedder, get_index, semantic_search
from brain.embeddings import Embedder
from brain.planner import UnknownRequirementError
from brain.vectors import IndexUnavailableError, VectorIndex

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


def get_atlas(raw: Annotated[bytes, Depends(get_graph_bytes)]) -> Atlas:
    return atlas_from_bytes(raw)


AtlasDep = Annotated[Atlas, Depends(get_atlas)]

app = FastAPI(title="Infra Atlas API", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/graph")
def graph(raw: Annotated[bytes, Depends(get_graph_bytes)]) -> Response:
    # Served as stored bytes: no parse/re-serialize per request.
    return Response(content=raw, media_type="application/json")


@app.get("/domains")
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


@app.get("/requirements")
def requirements(atlas: AtlasDep) -> list[RequirementOut]:
    return [RequirementOut(**r.model_dump()) for r in atlas.requirements]


@app.get("/nodes")
def nodes(
    atlas: AtlasDep,
    domain: str | None = None,
    type: str | None = None,
    level: str | None = None,
) -> list[NodeSummary]:
    return [NodeSummary.of(n) for n in atlas.filter_nodes(domain=domain, type=type, level=level)]


@app.get("/nodes/{node_id}", responses={404: {"description": "No node with that id"}})
def node(node_id: str, atlas: AtlasDep) -> NodeDetail:
    found = atlas.by_id.get(node_id)
    if found is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail=f"no node {node_id!r}")
    related = [NodeSummary.of(n) for n in atlas.related(node_id)]
    return NodeDetail.model_validate({**found, "related": related})


def _unavailable(exc: IndexUnavailableError) -> HTTPException:
    return HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc))


def vector_index() -> VectorIndex:
    try:
        return get_index()
    except IndexUnavailableError as exc:
        raise _unavailable(exc) from exc


def embedder() -> Embedder:
    try:
        return get_embedder()
    except IndexUnavailableError as exc:
        raise _unavailable(exc) from exc


@app.get("/search", responses={503: {"description": "No vector index: run `brain embed`"}})
def search(
    index: Annotated[VectorIndex, Depends(vector_index)],
    model: Annotated[Embedder, Depends(embedder)],
    q: Annotated[str, Query(min_length=1, max_length=200)],
    k: Annotated[int, Query(ge=1, le=20)] = 5,
) -> SemanticSearchOut:
    """Search by meaning: the best matching chunk of each concept, closest first."""
    try:
        hits = semantic_search(index, model, q, k)
    except IndexUnavailableError as exc:
        raise _unavailable(exc) from exc
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


@app.get("/search/keyword")
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


@app.post("/plan", responses={422: {"description": "Unknown requirement id"}})
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
