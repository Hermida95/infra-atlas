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


def get_embedder() -> Embedder:
    try:
        return _embedder(os.environ.get("EMBEDDINGS_PROVIDER", "local"))
    except Exception as exc:  # model download or provider config failed
        raise IndexUnavailableError(f"embedding model unavailable: {exc}") from exc


def best_per_concept(hits: Sequence[ChunkHit], k: int) -> list[ConceptHit]:
    """Keep each concept's best chunk. Hits arrive best first, so the first one wins."""
    seen: dict[str, ConceptHit] = {}
    for hit in hits:
        if hit.node_id not in seen:
            seen[hit.node_id] = ConceptHit(hit.node_id, hit.title, hit.score, hit)
            if len(seen) == k:
                break
    return list(seen.values())


def semantic_search(index: VectorIndex, embedder: Embedder, query: str, k: int) -> list[ConceptHit]:
    index.check(embedder)
    vector = embedder.embed_query(query)
    return best_per_concept(index.search(vector, limit=min(len(index), k * OVERFETCH)), k)


def clear_caches() -> None:
    _open_index.cache_clear()
    _embedder.cache_clear()
