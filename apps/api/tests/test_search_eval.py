"""Retrieval quality on content/search-eval.yaml. The real model, not a stand-in.

Thresholds sit a little under the values measured in CI with bge-small-en-v1.5, so a change
to chunking, prefixes or the model that loses quality fails here. Measured: see docs/BUSQUEDA.md.

Without the model (no network and no cache) the quality test is skipped, unless
REQUIRE_EMBEDDINGS=1, as in CI, where a skip would hide a regression.
"""

import os
from pathlib import Path

import pytest

from api.evaluation import BM25, Case, evaluate, load_cases, rank_of, report
from api.semantic import semantic_search
from brain.chunks import chunk_nodes
from brain.loader import find_repo_root, load_content
from brain.vectors import VectorIndex, build_index

RECALL_AT_3_MIN = 0.70
MRR_MIN = 0.60

CONTENT = find_repo_root(Path(__file__)) / "content"


def test_rank_and_metrics() -> None:
    cases = [Case("q1", "a"), Case("q2", "b"), Case("q3", "c"), Case("q4", "d")]
    rankings = {"q1": ["a", "x"], "q2": ["x", "b"], "q3": ["x", "y", "z", "c"], "q4": ["x"]}

    scores = evaluate(cases, rankings.__getitem__)

    assert rank_of("b", ["x", "b"]) == 2 and rank_of("q", ["x"]) is None
    assert scores.recall_at_1 == 0.25
    assert scores.recall_at_3 == 0.5
    assert scores.mrr == pytest.approx((1 + 1 / 2 + 1 / 4) / 4)
    assert [m[0] for m in scores.misses] == ["q3", "q4"]


def test_eval_set_targets_published_concepts() -> None:
    cases = load_cases()
    published = {n.id for n in load_content(CONTENT).nodes if n.meta.access != "pro"}

    assert len(cases) >= 25
    assert {c.expected for c in cases} <= published
    assert len({c.query for c in cases}) == len(cases)


@pytest.fixture(scope="module")
def local_embedder():
    try:
        from brain.embeddings import LocalEmbedder

        return LocalEmbedder()
    except Exception as exc:
        if os.environ.get("REQUIRE_EMBEDDINGS") == "1":
            raise
        pytest.skip(f"embedding model not available here: {exc}")


def test_semantic_search_quality(local_embedder, tmp_path_factory, capsys) -> None:
    loaded = load_content(CONTENT)
    chunks = chunk_nodes(loaded.nodes)
    path = tmp_path_factory.mktemp("eval") / "vectors.lance"
    build_index(chunks, local_embedder, path)
    index = VectorIndex(path)
    cases = load_cases()

    semantic = evaluate(
        cases, lambda q: [h.node_id for h in semantic_search(index, local_embedder, q, 10)]
    )
    keyword = evaluate(cases, BM25(chunks).rank)

    with capsys.disabled():
        print("\n" + report({"semantic": semantic, "keyword BM25": keyword}))
    assert semantic.recall_at_3 >= RECALL_AT_3_MIN, semantic.misses
    assert semantic.mrr >= MRR_MIN, semantic.misses
