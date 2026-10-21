"""Semantic search over the LanceDB index that `brain embed` writes."""

from __future__ import annotations

import os
from collections.abc import Sequence
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

from brain.embeddings import Embedder, embedder_from_env
from brain.vectors import ChunkHit, IndexUnavailableError, VectorIndex, default_index_path

# Chunks fetched per requested concept: a concept can own several of the top chunks.
OVERFETCH = 8
# Teardown parts are short and generic ("Models", "Guardrails"), so on their own they win
# unrelated queries. Measured on content/search-eval.yaml (python -m api.evaluation):
# recall@3 0.74 at 1.0, 0.93 anywhere from 0.9 to 0.8; 0.85 sits in the middle of that plateau.
PART_WEIGHT = 0.85


@dataclass(frozen=True, slots=True)
class ConceptHit:
    node_id: str
    title: str
    score: float
    chunk: ChunkHit


def index_path() -> Path:
    configured = os.environ.get("VECTORS_PATH")
    return Path(configured) if configured else default_index_path()


@lru_cache(maxsize=4)
def _open_index(path: Path) -> VectorIndex:
    """Failures raise, so a missing index is retried on the next request, never cached."""
    return VectorIndex(path)


@lru_cache(maxsize=1)
def _embedder(provider: str) -> Embedder:
    return embedder_from_env()


def get_index() -> VectorIndex:
    return _open_index(index_path())


class EmbedderUnavailableError(IndexUnavailableError):
    """The configured embedding provider could not be loaded."""


def get_embedder() -> Embedder:
    try:
        return _embedder(os.environ.get("EMBEDDINGS_PROVIDER", "local"))
    except Exception as exc:  # model download or provider config failed
        raise EmbedderUnavailableError(f"embedding model unavailable: {exc}") from exc


def best_per_concept(
    hits: Sequence[ChunkHit], k: int, part_weight: float = PART_WEIGHT
) -> list[ConceptHit]:
    """Rank concepts by their best chunk. A part chunk's score is multiplied by `part_weight`,
    so an overview wins unless a teardown part matches clearly better."""
    best: dict[str, ConceptHit] = {}
    for hit in hits:
        score = round(hit.score * (part_weight if hit.kind == "part" else 1.0), 4)
        if hit.node_id not in best or score > best[hit.node_id].score:
            best[hit.node_id] = ConceptHit(hit.node_id, hit.title, score, hit)
    return sorted(best.values(), key=lambda h: -h.score)[:k]


def semantic_search(
    index: VectorIndex, embedder: Embedder, query: str, k: int, part_weight: float = PART_WEIGHT
) -> list[ConceptHit]:
    index.check(embedder)
    vector = embedder.embed_query(query)
    hits = index.search(vector, limit=min(len(index), k * OVERFETCH))
    return best_per_concept(hits, k, part_weight)


def clear_caches() -> None:
    _open_index.cache_clear()
    _embedder.cache_clear()
