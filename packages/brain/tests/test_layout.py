import math
from pathlib import Path

from brain.graph import related_links
from brain.layout import compute_layout
from brain.loader import load_content


def build(content_dir: Path):
    loaded = load_content(content_dir)
    return loaded.nodes, {d.id: d for d in loaded.domains}, related_links(loaded.nodes)


def test_layout_is_deterministic_and_finite(content_dir: Path, write_node) -> None:
    write_node("docker", hub=True, relations={"related": ["image", "localhost"]})
    write_node("image", relations={"related": ["docker"]})
    write_node("localhost", "local")
    nodes, domains, links = build(content_dir)

    first = compute_layout(nodes, domains, links)
    second = compute_layout(list(reversed(nodes)), domains, links)

    assert first == second
    assert set(first) == {"docker", "image", "localhost"}
    for position in first.values():
        assert len(position) == 3
        assert all(math.isfinite(c) and round(c, 1) == c for c in position)


def test_coincident_nodes_do_not_produce_nan(content_dir: Path, write_node) -> None:
    write_node("a")
    write_node("b")
    nodes, domains, _ = build(content_dir)

    positions = compute_layout(nodes, domains, [], seed=0)

    assert all(math.isfinite(c) for p in positions.values() for c in p)


def test_related_links_are_undirected_and_deduplicated(content_dir: Path, write_node) -> None:
    write_node("docker", relations={"related": ["image", "image"]})
    write_node("image", relations={"related": ["docker"]})
    nodes, _, _ = build(content_dir)

    assert related_links(nodes) == [("docker", "image")]
