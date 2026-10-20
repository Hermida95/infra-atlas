import json
from collections.abc import Iterator
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from api.main import _load_graph_bytes, app

GRAPH = {"version": 1, "domains": [], "nodes": [], "links": []}


@pytest.fixture(autouse=True)
def clear_cache() -> Iterator[None]:
    _load_graph_bytes.cache_clear()
    yield
    _load_graph_bytes.cache_clear()


@pytest.fixture
def client() -> TestClient:
    return TestClient(app)


def test_health(client: TestClient) -> None:
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_graph_serves_file(
    client: TestClient, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    path = tmp_path / "graph.json"
    path.write_text(json.dumps(GRAPH))
    monkeypatch.setenv("GRAPH_PATH", str(path))

    response = client.get("/graph")

    assert response.status_code == 200
    assert response.headers["content-type"] == "application/json"
    assert response.json() == GRAPH


def test_graph_is_cached_after_first_load(
    client: TestClient, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    path = tmp_path / "graph.json"
    path.write_text(json.dumps(GRAPH))
    monkeypatch.setenv("GRAPH_PATH", str(path))
    client.get("/graph")
    path.unlink()

    assert client.get("/graph").json() == GRAPH


def test_graph_missing_returns_503(
    client: TestClient, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("GRAPH_PATH", str(tmp_path / "missing.json"))

    response = client.get("/graph")

    assert response.status_code == 503
    assert "not found" in response.json()["detail"]


def test_graph_invalid_json_returns_503(
    client: TestClient, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    path = tmp_path / "graph.json"
    path.write_text("{not json")
    monkeypatch.setenv("GRAPH_PATH", str(path))

    assert client.get("/graph").status_code == 503


def test_cors_allows_local_web(client: TestClient) -> None:
    response = client.get("/health", headers={"Origin": "http://localhost:3000"})
    assert response.headers["access-control-allow-origin"] == "http://localhost:3000"
