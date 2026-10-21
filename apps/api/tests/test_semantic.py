from collections.abc import Iterator
from pathlib import Path

import pytest
from api_fakes import HashEmbedder
from fastapi.testclient import TestClient

from api import semantic
from api.main import app, embedder
from brain.chunks import chunk_nodes
from brain.loader import find_repo_root, load_content
from brain.vectors import build_index

CONTENT = find_repo_root(Path(__file__)) / "content"


@pytest.fixture(scope="module")
def real_index(tmp_path_factory: pytest.TempPathFactory) -> Path:
    loaded = load_content(CONTENT)
    assert loaded.errors == []
    path = tmp_path_factory.mktemp("index") / "vectors.lance"
    build_index(chunk_nodes(loaded.nodes), HashEmbedder(), path)
    return path


@pytest.fixture
def client(real_index: Path, monkeypatch: pytest.MonkeyPatch) -> Iterator[TestClient]:
    monkeypatch.setenv("VECTORS_PATH", str(real_index))
    semantic.clear_caches()
    app.dependency_overrides[embedder] = HashEmbedder
    yield TestClient(app)
    app.dependency_overrides.clear()
    semantic.clear_caches()


def test_search_returns_best_chunk_per_concept(client: TestClient) -> None:
    response = client.get("/search", params={"q": "the daemon that runs images", "k": 5})

    assert response.status_code == 200
    body = response.json()
    assert body["model"] == "test:hash"
    ids = [hit["id"] for hit in body["hits"]]
    assert len(ids) == len(set(ids)) == 5  # grouped by concept
    scores = [hit["score"] for hit in body["hits"]]
    assert scores == sorted(scores, reverse=True)
    top = body["hits"][0]
    assert {"id", "title", "score", "chunk"} <= top.keys()
    assert top["chunk"]["kind"] in {"overview", "part"}
    assert top["chunk"]["id"].startswith(top["id"] + ":")


def test_search_k_bounds(client: TestClient) -> None:
    assert len(client.get("/search", params={"q": "containers"}).json()["hits"]) == 5
    assert len(client.get("/search", params={"q": "containers", "k": 1}).json()["hits"]) == 1
    assert client.get("/search", params={"q": "containers", "k": 0}).status_code == 422
    assert client.get("/search", params={"q": "containers", "k": 21}).status_code == 422
    assert client.get("/search", params={"q": ""}).status_code == 422


def test_search_without_index_is_503(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("VECTORS_PATH", str(tmp_path / "missing.lance"))
    semantic.clear_caches()
    app.dependency_overrides[embedder] = HashEmbedder
    try:
        response = TestClient(app).get("/search", params={"q": "docker"})
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 503
    assert response.json()["detail"] == "search index not available; run `brain embed`"
    assert str(tmp_path) not in response.text


def test_search_with_another_model_is_503(client: TestClient) -> None:
    class Other(HashEmbedder):
        model = "other"

    app.dependency_overrides[embedder] = Other

    response = client.get("/search", params={"q": "docker"})

    assert response.status_code == 503
    assert "another embedding model" in response.json()["detail"]


def test_embedder_failure_is_503(real_index: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("VECTORS_PATH", str(real_index))
    monkeypatch.setenv("EMBEDDINGS_PROVIDER", "nope")
    semantic.clear_caches()

    response = TestClient(app).get("/search", params={"q": "docker"})

    assert response.status_code == 503
    assert response.json()["detail"] == "embedding model not available"
    semantic.clear_caches()


def test_best_per_concept_keeps_first_hit() -> None:
    from brain.vectors import ChunkHit

    hits = [
        ChunkHit("a:part:0", "a", "part", "A", "x", 0.9),
        ChunkHit("a:overview", "a", "overview", "A", "y", 0.8),
        ChunkHit("b:overview", "b", "overview", "B", "z", 0.7),
    ]

    best = semantic.best_per_concept(hits, k=5, part_weight=1.0)

    assert [(h.node_id, h.chunk.id) for h in best] == [("a", "a:part:0"), ("b", "b:overview")]
    assert len(semantic.best_per_concept(hits, k=1, part_weight=1.0)) == 1


def test_part_weight_lets_overview_win() -> None:
    from brain.vectors import ChunkHit

    hits = [
        ChunkHit("a:part:0", "a", "part", "A", "x", 0.80),
        ChunkHit("b:overview", "b", "overview", "B", "y", 0.76),
        ChunkHit("a:overview", "a", "overview", "A", "z", 0.50),
    ]

    assert [h.node_id for h in semantic.best_per_concept(hits, 2, part_weight=1.0)] == ["a", "b"]
    weighted = semantic.best_per_concept(hits, 2, part_weight=0.9)
    assert [h.node_id for h in weighted] == ["b", "a"]
    assert weighted[1].chunk.id == "a:part:0" and weighted[1].score == 0.72


def test_min_score_comes_from_the_model_and_can_be_overridden(
    real_index: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    from brain.vectors import VectorIndex

    index, model = VectorIndex(real_index), HashEmbedder()
    everything = semantic.semantic_search(index, model, "containers", 5)
    assert len(everything) == 5  # the test model has no entry: nothing is filtered

    best = everything[0].score
    monkeypatch.setitem(semantic.MIN_SCORE, model.model, best)
    assert [h.node_id for h in semantic.semantic_search(index, model, "containers", 5)] == [
        everything[0].node_id
    ]
    assert len(semantic.semantic_search(index, model, "containers", 5, min_score=0.0)) == 5
    assert semantic.semantic_search(index, model, "containers", 5, min_score=1.1) == []


def test_search_endpoint_returns_no_hits_under_the_floor(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setitem(semantic.MIN_SCORE, HashEmbedder.model, 1.1)

    body = client.get("/search", params={"q": "containers"}).json()

    assert body["hits"] == []
