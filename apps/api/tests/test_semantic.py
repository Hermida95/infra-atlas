import hashlib
import math
import re
from collections.abc import Iterator, Sequence
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from api import semantic
from api.main import app, embedder
from brain.chunks import chunk_nodes
from brain.loader import find_repo_root, load_content
from brain.vectors import build_index

CONTENT = find_repo_root(Path(__file__)) / "content"


class HashEmbedder:
    """Deterministic bag-of-words vectors: tests the endpoint, not the quality of the model."""

    provider = "test"
    model = "hash"
    model_version = "1"
    dimensions = 256

    def _vector(self, text: str) -> list[float]:
        vector = [0.0] * self.dimensions
        for word in re.findall(r"[a-z0-9]+", text.lower()):
            vector[int(hashlib.md5(word.encode()).hexdigest(), 16) % self.dimensions] += 1.0
        norm = math.sqrt(sum(x * x for x in vector)) or 1.0
        return [x / norm for x in vector]

    def embed_documents(self, texts: Sequence[str]) -> list[list[float]]:
        return [self._vector(t) for t in texts]

    def embed_query(self, text: str) -> list[float]:
        return self._vector(text)


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
    assert "brain embed" in response.json()["detail"]


def test_search_with_another_model_is_503(client: TestClient) -> None:
    class Other(HashEmbedder):
        model = "other"

    app.dependency_overrides[embedder] = Other

    response = client.get("/search", params={"q": "docker"})

    assert response.status_code == 503
    assert "built with" in response.json()["detail"]


def test_embedder_failure_is_503(real_index: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("VECTORS_PATH", str(real_index))
    monkeypatch.setenv("EMBEDDINGS_PROVIDER", "nope")
    semantic.clear_caches()

    response = TestClient(app).get("/search", params={"q": "docker"})

    assert response.status_code == 503
    assert "embedding model unavailable" in response.json()["detail"]
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
