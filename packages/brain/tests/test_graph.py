import json
from datetime import UTC, datetime
from pathlib import Path

from brain.graph import build_graph, write_graph
from brain.loader import load_content

FIXED = datetime(2026, 10, 20, 12, 0, tzinfo=UTC)


def make_graph(content_dir: Path, **kwargs):
    loaded = load_content(content_dir)
    return build_graph(loaded.domains, loaded.nodes, generated_at=FIXED, **kwargs)


def test_excludes_pro_nodes_and_their_links(content_dir: Path, write_node) -> None:
    write_node("docker", relations={"related": ["secret", "image"]})
    write_node("image")
    write_node("secret", access="pro")

    graph = make_graph(content_dir)

    assert [n["id"] for n in graph["nodes"]] == ["docker", "image"]
    assert graph["links"] == [{"source": "docker", "target": "image", "type": "related"}]


def test_pro_nodes_are_not_named_as_alternatives(content_dir: Path, write_node) -> None:
    """A `pro` node is excluded from the graph, so its id cannot travel inside a free one."""
    write_node("free", relations={"alternative_to": ["secret"]})
    write_node("secret", access="pro")

    graph = make_graph(content_dir)

    assert [n["id"] for n in graph["nodes"]] == ["free"]
    assert graph["nodes"][0]["alternatives"] == []


def test_include_pro_keeps_them(content_dir: Path, write_node) -> None:
    write_node("docker", relations={"related": ["secret"]})
    write_node("secret", access="pro")

    graph = make_graph(content_dir, include_pro=True)

    assert {n["id"] for n in graph["nodes"]} == {"docker", "secret"}
    assert len(graph["links"]) == 1


def test_shape_and_ordering(content_dir: Path, write_node, tmp_path: Path) -> None:
    write_node("zeta", "local", monogram="ZT")
    write_node("alpha", "containers", parts=[{"name": "P", "text": "t"}])
    write_node("beta", "local")

    graph = make_graph(content_dir)
    out = tmp_path / "nested" / "graph.json"
    write_graph(graph, out)
    written = json.loads(out.read_text())

    assert written["version"] == 1
    assert written["generatedAt"] == "2026-10-20T12:00:00Z"
    assert [d["id"] for d in written["domains"]] == ["local", "containers"]
    assert [n["id"] for n in written["nodes"]] == ["beta", "zeta", "alpha"]
    alpha = written["nodes"][2]
    assert set(alpha) == {
        "id",
        "title",
        "type",
        "domain",
        "hub",
        "summary",
        "logo",
        "monogram",
        "level",
        "access",
        "lead",
        "parts",
        "layout",
        "lab",
        "alternatives",
        "evidence",
        "position",
        "planner",
    }
    assert alpha["parts"] == [{"name": "P", "kind": None, "text": "t"}]
    assert alpha["logo"] is None and len(alpha["position"]) == 3


def test_requirements_and_planner_blocks(content_dir: Path, write_node, write_requirements) -> None:
    write_requirements()
    rule = {"stage": "data", "when": "sql", "why": "Managed Postgres.", "notes": []}
    write_node("rds", planner=rule | {"notes": [{"when": "cheap", "text": "Idle cost."}]})
    write_node("docker")

    loaded = load_content(content_dir)
    graph = build_graph(
        loaded.domains, loaded.nodes, requirements=loaded.requirements, generated_at=FIXED
    )

    assert list(graph) == ["version", "generatedAt", "domains", "requirements", "nodes", "links"]
    assert graph["requirements"][0] == {
        "id": "api",
        "label": "Python API",
        "keywords": ["api", "fastapi"],
    }
    by_id = {node["id"]: node for node in graph["nodes"]}
    assert by_id["docker"]["planner"] is None
    assert by_id["rds"]["planner"] == rule | {"notes": [{"when": "cheap", "text": "Idle cost."}]}
