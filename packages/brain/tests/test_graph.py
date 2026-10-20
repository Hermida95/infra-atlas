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
        "lab",
        "position",
    }
    assert alpha["parts"] == [{"name": "P", "kind": None, "text": "t"}]
    assert alpha["logo"] is None and len(alpha["position"]) == 3
