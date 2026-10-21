"""Semantic search over the LanceDB index that `brain embed` writes."""

from __future__ import annotations

import os
import threading
import time
from collections.abc import Sequence
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

from brain.embeddings import LOCAL_MODEL, Embedder, ModelIntegrityError, embedder_from_env
from brain.vectors import ChunkHit, IndexUnavailableError, VectorIndex, default_index_path

# Chunks fetched per requested concept: a concept can own several of the top chunks.
OVERFETCH = 8
# Teardown parts are short and generic ("Models", "Guardrails"), so on their own they win
# unrelated queries. Measured on content/search-eval.yaml (python -m api.evaluation):
# recall@3 0.74 at 1.0, 0.93 anywhere from 0.9 to 0.8; 0.85 sits in the middle of that plateau.
PART_WEIGHT = 0.85
# Weighted score (cosine, times PART_WEIGHT for parts) under which a hit is noise, per model:
# every model has its own scale, so a number measured on one says nothing about another.
# bge-small, measured with the real model: gibberish and off-topic queries ("asdf qwer",
# "zzzz", Spanish questions) top out at 0.576, while the expected concept of each query in
# content/search-eval.yaml scores 0.581 or more. A model without an entry is not filtered.
MIN_SCORE: dict[str, float] = {LOCAL_MODEL: 0.58}


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


# After a failed load, wait this long before trying again: /search and /ready (every few
# seconds) would otherwise reload the ONNX model on each call, burning CPU while it is down.
EMBEDDER_RETRY_SECONDS = 30.0
# What a model that cannot be loaded raises: a failed integrity check, a missing or unreadable
# file or download, a bad provider setting, an ONNX runtime error. Anything else is a bug and
# must surface as one, not as a "model unavailable" 503.
_LOAD_ERRORS = (ModelIntegrityError, OSError, ValueError, RuntimeError)

_clock = time.monotonic
_load_lock = threading.Lock()
_failures: dict[str, tuple[float, str]] = {}  # provider -> (when, why)


def get_embedder() -> Embedder:
    provider = os.environ.get("EMBEDDINGS_PROVIDER", "local")
    with _load_lock:
        failure = _failures.get(provider)
        if failure and _clock() - failure[0] < EMBEDDER_RETRY_SECONDS:
            raise EmbedderUnavailableError(failure[1])
        try:
            loaded = _embedder(provider)
        except _LOAD_ERRORS as exc:
            message = f"embedding model unavailable: {exc}"
            _failures[provider] = (_clock(), message)
            raise EmbedderUnavailableError(message) from exc
        _failures.pop(provider, None)
        return loaded


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
    index: VectorIndex,
    embedder: Embedder,
    query: str,
    k: int,
    part_weight: float = PART_WEIGHT,
    min_score: float | None = None,
) -> list[ConceptHit]:
    """The best concepts for `query`. `min_score` defaults to the embedder's `MIN_SCORE`;
    concepts under it are dropped, so a query that means nothing returns no hits."""
    index.check(embedder)
    floor = MIN_SCORE.get(embedder.model, 0.0) if min_score is None else min_score
    if len(index) == 0:  # LanceDB refuses limit(0); an index with no chunks has no answers
        return []
    vector = embedder.embed_query(query)
    hits = index.search(vector, limit=min(len(index), k * OVERFETCH))
    return [h for h in best_per_concept(hits, k, part_weight) if h.score >= floor]


def clear_caches() -> None:
    _open_index.cache_clear()
    _embedder.cache_clear()
    _failures.clear()
