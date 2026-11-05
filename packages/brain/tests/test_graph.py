import json
from datetime import UTC, datetime
from pathlib import Path

from brain.graph import build_graph, write_graph
from brain.loader import load_content
from brain.models import Case

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

    assert written["version"] == 2
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
        "exam",
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

    assert list(graph) == [
        "version",
        "generatedAt",
        "world",
        "domains",
        "requirements",
        "cases",
        "nodes",
        "links",
    ]
    assert graph["requirements"][0] == {
        "id": "api",
        "label": "Python API",
        "keywords": ["api", "fastapi"],
    }
    by_id = {node["id"]: node for node in graph["nodes"]}
    assert by_id["docker"]["planner"] is None
    assert by_id["rds"]["planner"] == rule | {"notes": [{"when": "cheap", "text": "Idle cost."}]}


def test_connects_adds_the_sentence_to_the_link(content_dir: Path, write_node) -> None:
    write_node("docker", connects=[{"to": "image", "text": "A build produces one."}])
    write_node("image")

    graph = make_graph(content_dir)

    assert graph["links"] == [
        {"source": "docker", "target": "image", "type": "related", "text": "A build produces one."}
    ]


def test_an_explained_edge_is_not_drawn_twice(content_dir: Path, write_node) -> None:
    """`connects` and `related` naming the same pair is one line, and it keeps the sentence."""
    write_node("docker", connects=[{"to": "image", "text": "A build produces one."}])
    write_node("image", relations={"related": ["docker"]})

    graph = make_graph(content_dir)

    assert len(graph["links"]) == 1
    assert graph["links"][0]["text"] == "A build produces one."


def test_connects_to_a_pro_node_is_dropped(content_dir: Path, write_node) -> None:
    write_node("docker", connects=[{"to": "secret", "text": "Never published."}])
    write_node("secret", access="pro")

    assert make_graph(content_dir)["links"] == []


def test_cases_travel_with_the_graph(content_dir: Path, write_node) -> None:
    loaded_case = Case.model_validate(
        {
            "id": "pick-one",
            "title": "Pick one",
            "exam": ["saa"],
            "scenario": "Something has to be chosen.",
            "asks": ["Cheap"],
            "nodes": ["docker", "secret"],
            "options": [
                {"id": "a", "name": "A", "verdict": "best", "nodes": ["docker"], "why": "It is."},
                {
                    "id": "b",
                    "name": "B",
                    "verdict": "avoid",
                    "nodes": ["docker", "secret"],
                    "why": "It is not.",
                    "watch": ["Costs more."],
                },
            ],
            "teaches": "Pick A.",
        }
    )
    write_node("docker")
    write_node("secret", access="pro")

    graph = make_graph(content_dir, cases=[loaded_case])

    # A `pro` node is not in the published graph, so it cannot be named by a case either.
    assert graph["cases"][0]["nodes"] == ["docker"]
    assert graph["cases"][0]["options"][1]["nodes"] == ["docker"]
    assert graph["cases"][0]["options"][0]["verdict"] == "best"
    assert graph["cases"][0]["teaches"] == "Pick A."
