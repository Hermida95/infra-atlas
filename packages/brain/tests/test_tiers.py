from __future__ import annotations

from pathlib import Path
from typing import Any

from brain.models import Domain, Node, NodeFrontmatter
from brain.tiers import TIER_ABOVE_DENSITY, compute_tiers

DOMAINS = [
    Domain(id="a", name="A", order=0, position=(0, 0, 0), hue=200),
    Domain(id="b", name="B", order=1, position=(1, 0, 0), hue=210),
]


def node(node_id: str, domain: str = "a", **overrides: Any) -> Node:
    meta = NodeFrontmatter.model_validate(
        {
            "id": node_id,
            "title": node_id,
            "type": "concept",
            "domain": domain,
            "summary": f"About {node_id}.",
            "reviewed": "2026-11-05",
            **overrides,
        }
    )
    return Node(meta=meta, body="", source=Path(f"{node_id}.mdx"))


def chain(ids: list[str]) -> list[tuple[str, str]]:
    return [(ids[i], ids[i + 1]) for i in range(len(ids) - 1)]


def test_a_sparse_world_is_left_whole() -> None:
    """A map that already reads at a glance is not thinned for nothing."""
    nodes = [node(f"n{i}") for i in range(6)]
    links = chain([n.id for n in nodes])  # 5 links over 6 nodes: well under the threshold

    tiers = compute_tiers(nodes, DOMAINS, links)

    assert tiers.major == {n.id for n in nodes}
    assert all(tiers.is_primary(s, t) for s, t in links)


def test_a_dense_world_keeps_a_few_nodes_per_area() -> None:
    nodes = [node(f"a{i}", "a") for i in range(8)] + [node(f"b{i}", "b") for i in range(8)]
    ids = [n.id for n in nodes]
    # Every node joined to every other in its area: far above the density threshold.
    links = [(x, y) for i, x in enumerate(ids) for y in ids[i + 1 :]]
    assert len(links) / len(nodes) > TIER_ABOVE_DENSITY

    tiers = compute_tiers(nodes, DOMAINS, links, per_area=3)

    assert len(tiers.major) == 6
    assert len({n.domain for n in nodes if n.id in tiers.major}) == 2


def test_a_hub_is_kept_before_anything_else() -> None:
    nodes = [node("plain", "a", level="core"), node("star", "a", hub=True, level="advanced")]
    nodes += [node(f"filler{i}", "b") for i in range(6)]
    ids = [n.id for n in nodes]
    links = [(x, y) for i, x in enumerate(ids) for y in ids[i + 1 :]]

    tiers = compute_tiers(nodes, DOMAINS, links, per_area=1)

    assert "star" in tiers.major
    assert "plain" not in tiers.major


def test_the_more_general_node_is_kept_before_the_advanced_one() -> None:
    nodes = [node("basic", "a", level="core"), node("deep", "a", level="advanced")]
    nodes += [node(f"filler{i}", "b") for i in range(6)]
    ids = [n.id for n in nodes]
    links = [(x, y) for i, x in enumerate(ids) for y in ids[i + 1 :]]

    tiers = compute_tiers(nodes, DOMAINS, links, per_area=1)

    assert "basic" in tiers.major
    assert "deep" not in tiers.major


def test_the_better_connected_node_breaks_a_tie() -> None:
    nodes = [node("busy", "a"), node("quiet", "a")] + [node(f"b{i}", "b") for i in range(8)]
    others = [f"b{i}" for i in range(8)]
    # Dense enough to be tiered at all, and `busy` touches eight of it while `quiet` touches one.
    links = [(x, y) for i, x in enumerate(others) for y in others[i + 1 :]]
    links += [("busy", other) for other in others] + [("quiet", "b0")]

    tiers = compute_tiers(nodes, DOMAINS, links, per_area=1)

    assert "busy" in tiers.major
    assert "quiet" not in tiers.major


def test_a_primary_link_joins_two_major_nodes_only() -> None:
    nodes = [node(f"a{i}", "a") for i in range(6)] + [node(f"b{i}", "b") for i in range(6)]
    ids = [n.id for n in nodes]
    links = [(x, y) for i, x in enumerate(ids) for y in ids[i + 1 :]]

    tiers = compute_tiers(nodes, DOMAINS, links, per_area=2)

    for source, target in links:
        both = source in tiers.major and target in tiers.major
        assert tiers.is_primary(source, target) is both


def test_a_major_node_is_never_left_without_a_line() -> None:
    """Alone in its area, a node reads as a mistake rather than as a summary."""
    nodes = [node("lonely", "a", hub=True)] + [node(f"b{i}", "b") for i in range(9)]
    # `lonely` touches exactly one node, which is itself major: a hub in the other area.
    links = [("lonely", "b0")] + [(f"b{i}", f"b{j}") for i in range(9) for j in range(i + 1, 9)]
    nodes[1] = node("b0", "b", hub=True)

    tiers = compute_tiers(nodes, DOMAINS, links, per_area=2)

    assert "lonely" in tiers.major and "b0" in tiers.major
    assert tiers.is_primary("lonely", "b0")


def test_the_same_content_always_yields_the_same_overview() -> None:
    nodes = [node(f"a{i}", "a") for i in range(8)] + [node(f"b{i}", "b") for i in range(8)]
    ids = [n.id for n in nodes]
    links = [(x, y) for i, x in enumerate(ids) for y in ids[i + 1 :]]

    first = compute_tiers(nodes, DOMAINS, links)
    second = compute_tiers(list(reversed(nodes)), DOMAINS, list(reversed(links)))

    assert first.major == second.major
    assert first.primary == second.primary


def test_an_empty_world_has_an_empty_overview() -> None:
    tiers = compute_tiers([], DOMAINS, [])

    assert tiers.major == frozenset()
    assert tiers.primary == frozenset()


def test_every_node_is_one_click_from_the_overview() -> None:
    """An overview that hides a node nothing on it touches conceals content, not summarises."""
    # Two areas of eight, densely joined inside, plus one node hanging off a node that will not
    # make the first cut on its own.
    nodes = [node(f"a{i}", "a") for i in range(8)] + [node(f"b{i}", "b") for i in range(8)]
    nodes.append(node("far", "b"))
    ids = [n.id for n in nodes if n.id != "far"]
    links = [(x, y) for i, x in enumerate(ids) for y in ids[i + 1 :]]
    links.append(("far", "b7"))

    tiers = compute_tiers(nodes, DOMAINS, links, per_area=2)

    neighbours: dict[str, set[str]] = {}
    for source, target in links:
        neighbours.setdefault(source, set()).add(target)
        neighbours.setdefault(target, set()).add(source)
    for item in nodes:
        reached = item.id in tiers.major or bool(neighbours.get(item.id, set()) & tiers.major)
        assert reached, f"{item.id} is more than one click from the overview"


def test_a_node_nothing_touches_cannot_be_covered() -> None:
    """It is still in the catalogue and in search; the overview has no line to reach it by."""
    nodes = [node(f"a{i}", "a") for i in range(8)] + [node(f"b{i}", "b") for i in range(8)]
    nodes.append(node("island", "b"))
    ids = [n.id for n in nodes if n.id != "island"]
    links = [(x, y) for i, x in enumerate(ids) for y in ids[i + 1 :]]

    tiers = compute_tiers(nodes, DOMAINS, links, per_area=2)

    assert "island" not in tiers.major  # and compute_tiers returned rather than looping forever
