"""Retrieval evaluation: recall@k and MRR of each search method on content/search-eval.yaml.

    uv run python -m api.evaluation     # needs `brain embed` and `brain graph` first

recall@k  share of queries whose expected concept is in the top k.
MRR       mean of 1/rank of the expected concept (0 when it is not in the top 10).
"""

from __future__ import annotations

import json
import math
import re
from collections import Counter
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import yaml

from brain.chunks import Chunk
from brain.loader import find_repo_root

DEPTH = 10  # ranks looked at; a concept below this counts as not found

Ranker = Callable[[str], list[str]]

_WORD = re.compile(r"[a-z0-9]+")


@dataclass(frozen=True, slots=True)
class Case:
    query: str
    expected: str


@dataclass(frozen=True, slots=True)
class Scores:
    recall_at_1: float
    recall_at_3: float
    mrr: float
    misses: list[tuple[str, str, list[str]]]  # query, expected, top 3


def load_cases(path: Path | None = None) -> list[Case]:
    path = path or find_repo_root() / "content/search-eval.yaml"
    return [Case(**row) for row in yaml.safe_load(path.read_text(encoding="utf-8"))]


def rank_of(expected: str, ranked: Sequence[str]) -> int | None:
    """1-based position of `expected`, None if it is not in the first DEPTH results."""
    top = list(ranked[:DEPTH])
    return top.index(expected) + 1 if expected in top else None


def evaluate(cases: Sequence[Case], ranker: Ranker) -> Scores:
    ranks: list[int | None] = []
    misses = []
    for case in cases:
        ranked = ranker(case.query)
        rank = rank_of(case.expected, ranked)
        ranks.append(rank)
        if rank is None or rank > 3:
            misses.append((case.query, case.expected, ranked[:3]))
    total = len(cases)
    return Scores(
        recall_at_1=sum(1 for r in ranks if r == 1) / total,
        recall_at_3=sum(1 for r in ranks if r is not None and r <= 3) / total,
        mrr=sum(1 / r for r in ranks if r is not None) / total,
        misses=misses,
    )


class BM25:
    """Classic BM25 over each concept's chunks joined: the fair keyword baseline (any word)."""

    def __init__(self, chunks: Sequence[Chunk], k1: float = 1.5, b: float = 0.75) -> None:
        texts: dict[str, list[str]] = {}
        for chunk in chunks:
            texts.setdefault(chunk.node_id, []).extend(_WORD.findall(chunk.text.lower()))
        self.docs = {node_id: Counter(words) for node_id, words in texts.items()}
        self.lengths = {node_id: len(words) for node_id, words in texts.items()}
        self.average = sum(self.lengths.values()) / len(self.lengths)
        frequency = Counter(word for doc in self.docs.values() for word in doc)
        n = len(self.docs)
        self.idf = {w: math.log(1 + (n - f + 0.5) / (f + 0.5)) for w, f in frequency.items()}
        self.k1, self.b = k1, b

    def rank(self, query: str) -> list[str]:
        words = _WORD.findall(query.lower())
        scores = {}
        for node_id, doc in self.docs.items():
            norm = self.k1 * (1 - self.b + self.b * self.lengths[node_id] / self.average)
            score = sum(
                self.idf[w] * doc[w] * (self.k1 + 1) / (doc[w] + norm) for w in words if w in doc
            )
            if score > 0:
                scores[node_id] = score
        return sorted(scores, key=lambda node_id: (-scores[node_id], node_id))


def report(results: dict[str, Scores]) -> str:
    lines = ["| Method | recall@1 | recall@3 | MRR |", "| --- | --- | --- | --- |"]
    lines += [
        f"| {name} | {s.recall_at_1:.2f} | {s.recall_at_3:.2f} | {s.mrr:.2f} |"
        for name, s in results.items()
    ]
    return "\n".join(lines)


def main() -> None:  # pragma: no cover - exercised in CI
    from api.atlas import Atlas
    from api.main import graph_path
    from api.semantic import index_path, semantic_search
    from brain.chunks import chunk_nodes
    from brain.embeddings import LocalEmbedder, embedder_from_env
    from brain.loader import load_content
    from brain.vectors import VectorIndex

    root = find_repo_root()
    cases = load_cases()
    loaded = load_content(root / "content")
    atlas = Atlas.from_graph(json.loads(graph_path().read_bytes()))
    index, embedder = VectorIndex(index_path()), embedder_from_env()
    bm25 = BM25(chunk_nodes(loaded.nodes))

    results = {
        f"semantic ({embedder.model})": evaluate(
            cases, lambda q: [h.node_id for h in semantic_search(index, embedder, q, DEPTH)]
        ),
        "keyword BM25 (any word)": evaluate(cases, bm25.rank),
        "keyword /search/keyword (all words)": evaluate(
            cases, lambda q: [h.node["id"] for h in atlas.search(q, DEPTH)]
        ),
    }
    print(f"{len(cases)} queries\n\n{report(results)}\n")
    shipped = next(iter(results))
    print(f"{shipped}: rank of the expected concept per query")
    for case in cases:
        ranked = [h.node_id for h in semantic_search(index, embedder, case.query, DEPTH)]
        print(f"  {rank_of(case.expected, ranked) or '-':>2}  {case.query} -> {case.expected}")
    print()
    if isinstance(embedder, LocalEmbedder):
        print(f"Ablations\n\n{report(ablations(cases, loaded.nodes, embedder))}\n")
    for name, scores in results.items():
        print(f"{name}: not in top 3")
        for query, expected, top in scores.misses:
            print(f"  {query!r}: expected {expected}, got {top}")


def ablations(cases: Sequence[Case], nodes: Sequence[Any], embedder: Any) -> dict[str, Scores]:
    """What each choice buys: the same evaluation with one design decision undone."""
    import tempfile

    from api.semantic import semantic_search
    from brain.chunks import chunk_nodes
    from brain.embeddings import LocalEmbedder
    from brain.vectors import VectorIndex, build_index

    chunks = chunk_nodes(nodes)
    variants = {
        "shipped: all chunks + query instruction + part_weight": (chunks, embedder),
        "all chunks, no query instruction": (chunks, LocalEmbedder(query_prefix="")),
        "overview chunks only": ([c for c in chunks if c.kind == "overview"], embedder),
        "overview chunks only, no query instruction": (
            [c for c in chunks if c.kind == "overview"],
            LocalEmbedder(query_prefix=""),
        ),
    }
    results = {}
    indexes = []
    with tempfile.TemporaryDirectory() as tmp:
        for number, (name, (subset, model)) in enumerate(variants.items()):
            path = Path(tmp) / f"variant-{number}.lance"
            build_index(subset, model, path)
            index = VectorIndex(path)
            indexes.append(index)
            results[name] = evaluate(
                cases,
                lambda q, i=index, m=model: [h.node_id for h in semantic_search(i, m, q, DEPTH)],
            )

        bm25 = BM25(chunks)

        def hybrid(query: str) -> list[str]:
            semantic = [h.node_id for h in semantic_search(indexes[0], embedder, query, DEPTH)]
            return reciprocal_rank_fusion([semantic, bm25.rank(query)[:DEPTH]])

        results["hybrid: shipped + BM25 (RRF)"] = evaluate(cases, hybrid)
        for weight in (1.0, 0.95, 0.9, 0.8):
            results[f"all chunks, part_weight {weight}"] = evaluate(
                cases,
                lambda q, w=weight: [
                    h.node_id for h in semantic_search(indexes[0], embedder, q, DEPTH, w)
                ],
            )
    return results


def reciprocal_rank_fusion(rankings: Sequence[Sequence[str]], k: int = 60) -> list[str]:
    """Merge rankings by summing 1/(k + rank): robust to scores on different scales."""
    scores: dict[str, float] = {}
    for ranking in rankings:
        for rank, item in enumerate(ranking, start=1):
            scores[item] = scores.get(item, 0.0) + 1 / (k + rank)
    return sorted(scores, key=lambda item: (-scores[item], item))


if __name__ == "__main__":  # pragma: no cover
    main()
