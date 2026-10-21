import json
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest
import yaml
from fastapi.testclient import TestClient

from api.main import _load_graph_bytes, app
from brain.graph import build_graph
from brain.loader import find_repo_root, load_content

CONTENT = find_repo_root(Path(__file__)) / "content"


def node(node_id: str, domain: str, title: str, summary: str, **extra: Any) -> dict[str, Any]:
    return {
        "id": node_id,
        "title": title,
        "type": "concept",
        "domain": domain,
        "hub": False,
        "summary": summary,
        "logo": None,
        "monogram": None,
        "level": "core",
        "access": "free",
        "lead": None,
        "parts": [],
        "layout": "stack",
        "lab": None,
        "position": [0, 0, 0],
        "planner": None,
        **extra,
    }


def rule(stage: str, when: str, why: str, notes: list[dict[str, str]] | None = None) -> dict:
    return {"stage": stage, "when": when, "why": why, "notes": notes or []}


GRAPH = {
    "version": 1,
    "generatedAt": "2026-10-20T00:00:00Z",
    "domains": [
        {"id": "local", "name": "Local", "order": 0, "position": [0, 0, 0], "hue": 200},
        {"id": "containers", "name": "Containers", "order": 1, "position": [0, 0, 0], "hue": 190},
    ],
    "requirements": [
        {"id": "sql", "label": "Relational database", "keywords": ["postgres", "sql"]},
        {"id": "cheap", "label": "Small budget", "keywords": ["budget", "cheap"]},
    ],
    "nodes": [
        node(
            "app",
            "local",
            "Python app",
            "Your FastAPI code.",
            planner=rule("build", "true", "Code."),
        ),
        node(
            "docker",
            "containers",
            "Docker",
            "Builds and runs containers.",
            level="intermediate",
            parts=[{"name": "Engine", "kind": None, "text": "The daemon that runs images."}],
            planner=rule(
                "containerize",
                "true",
                "One image everywhere.",
                [{"when": "cheap", "text": "Use slim base images."}],
            ),
        ),
        node(
            "compose",
            "containers",
            "Docker Compose",
            "Runs several containers together.",
            planner=rule("build", "sql", "Postgres next to the app."),
        ),
    ],
    "links": [
        {"source": "app", "target": "docker", "type": "related"},
        {"source": "docker", "target": "compose", "type": "related"},
    ],
}


@pytest.fixture(autouse=True)
def clear_cache() -> Iterator[None]:
    _load_graph_bytes.cache_clear()
    yield
    _load_graph_bytes.cache_clear()


def client_for(
    graph: dict[str, Any], tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> TestClient:
    path = tmp_path / "graph.json"
    path.write_text(json.dumps(graph))
    monkeypatch.setenv("GRAPH_PATH", str(path))
    return TestClient(app)


@pytest.fixture
def client(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> TestClient:
    return client_for(GRAPH, tmp_path, monkeypatch)


def test_domains_count_nodes(client: TestClient) -> None:
    assert client.get("/domains").json() == [
        {"id": "local", "name": "Local", "order": 0, "hue": 200, "node_count": 1},
        {"id": "containers", "name": "Containers", "order": 1, "hue": 190, "node_count": 2},
    ]


def test_requirements(client: TestClient) -> None:
    assert [r["id"] for r in client.get("/requirements").json()] == ["sql", "cheap"]


def test_nodes_filters(client: TestClient) -> None:
    assert [n["id"] for n in client.get("/nodes").json()] == ["app", "docker", "compose"]
    assert [n["id"] for n in client.get("/nodes?domain=containers").json()] == ["docker", "compose"]
    assert [n["id"] for n in client.get("/nodes?level=intermediate").json()] == ["docker"]
    assert client.get("/nodes?type=service").json() == []


def test_node_detail_includes_related_both_ways(client: TestClient) -> None:
    response = client.get("/nodes/docker")

    assert response.status_code == 200
    body = response.json()
    assert body["title"] == "Docker"
    assert body["parts"][0]["name"] == "Engine"
    assert body["planner"]["stage"] == "containerize"
    assert [r["id"] for r in body["related"]] == ["app", "compose"]
    assert "position" not in body


def test_unknown_node_is_404(client: TestClient) -> None:
    response = client.get("/nodes/nope")
    assert response.status_code == 404
    assert "nope" in response.json()["detail"]


@pytest.mark.parametrize(
    ("query", "expected"),
    [
        ("docker", ["docker", "compose"]),  # exact id first, then title word
        ("Docker Compose", ["compose"]),  # every word must match
        ("comp", ["compose"]),  # title prefix
        ("daemon", ["docker"]),  # teardown part text
        ("fastapi", ["app"]),  # summary
        ("kubernetes", []),
        ("!!!", []),
    ],
)
def test_search_ranking(client: TestClient, query: str, expected: list[str]) -> None:
    response = client.get("/search/keyword", params={"q": query})

    assert response.status_code == 200
    assert [hit["id"] for hit in response.json()["hits"]] == expected


def test_search_limit_and_validation(client: TestClient) -> None:
    assert len(client.get("/search/keyword", params={"q": "o", "limit": 1}).json()["hits"]) == 1
    assert client.get("/search/keyword", params={"q": ""}).status_code == 422
    assert client.get("/search/keyword", params={"q": "docker", "limit": 0}).status_code == 422


def test_plan_groups_by_stage_order(client: TestClient) -> None:
    body = client.post("/plan", json={"requirements": ["sql"]}).json()

    assert body["requirements"] == ["sql"]
    assert [(s["stage"], [step["id"] for step in s["steps"]]) for s in body["stages"]] == [
        ("build", ["app", "compose"]),
        ("containerize", ["docker"]),
    ]
    assert body["stages"][0]["steps"][1]["why"] == "Postgres next to the app."
    assert body["notes"] == []


def test_plan_from_text_and_notes(client: TestClient) -> None:
    body = client.post("/plan", json={"text": "Postgres on a small BUDGET"}).json()

    assert body["requirements"] == ["sql", "cheap"]
    assert body["notes"] == [{"node": "docker", "text": "Use slim base images."}]


def test_plan_unknown_requirement_is_422(client: TestClient) -> None:
    response = client.post("/plan", json={"requirements": ["sql", "mainframe"]})

    assert response.status_code == 422
    detail = response.json()["detail"]
    assert detail["unknown"] == ["mainframe"]
    assert detail["known"] == ["sql", "cheap"]


def test_cors_allows_post_from_local_web(client: TestClient) -> None:
    response = client.options(
        "/plan",
        headers={"Origin": "http://localhost:3000", "Access-Control-Request-Method": "POST"},
    )
    assert response.status_code == 200
    assert "POST" in response.headers["access-control-allow-methods"]


# --- Parity with brain and the web planner, on the real content ------------------------

CASES = yaml.safe_load((CONTENT / "planner-cases.yaml").read_text(encoding="utf-8"))


@pytest.fixture(scope="module")
def real_graph() -> dict[str, Any]:
    loaded = load_content(CONTENT)
    assert loaded.errors == []
    return build_graph(loaded.domains, loaded.nodes, requirements=loaded.requirements)


@pytest.mark.parametrize("case", CASES, ids=[case["id"] for case in CASES])
def test_plan_parity_with_planner_cases(
    case: dict[str, Any],
    real_graph: dict[str, Any],
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    client = client_for(real_graph, tmp_path, monkeypatch)

    body = client.post("/plan", json={"requirements": case["requirements"]}).json()

    assert (
        sorted(step["id"] for stage in body["stages"] for step in stage["steps"]) == case["nodes"]
    )
    assert len(body["notes"]) == case["notes"]


def test_real_graph_node_detail(real_graph: dict[str, Any], tmp_path: Path, monkeypatch) -> None:
    client = client_for(real_graph, tmp_path, monkeypatch)

    for summary in client.get("/nodes").json():
        assert client.get(f"/nodes/{summary['id']}").status_code == 200
