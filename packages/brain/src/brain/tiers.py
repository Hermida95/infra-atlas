"""Which nodes and links a dense world shows before you have asked for anything.

A map of 77 nodes at 1.75 links each reads at a glance. The same hologram with 156 nodes and
385 links does not: the lines cross everything and the logos sit on top of each other. So a
world that is too dense to read whole gets a first tier -- the few nodes per area that carry
the shape of it, and only the links between those -- and everything else arrives when you ask
for it, by opening a node or a case.

Nothing is dropped. Every node and every link is still in graph.json; `major` and `primary`
only say what is drawn before the reader has chosen a direction, which is what makes the map
go from general to specific instead of showing all of it at once.
"""

from __future__ import annotations

from collections.abc import Iterable, Sequence
from dataclasses import dataclass

from brain.models import Domain, Node

# Above this many links per node a map stops being readable whole. The journey map sits at
# 1.75 and is drawn in full; the AWS atlas (2.47) and the Kubernetes one (2.94) are tiered.
TIER_ABOVE_DENSITY = 2.0
# How many nodes per area the first tier keeps. Three across fifteen areas is about forty-five
# nodes, which lands back under two links each -- the density the journey map reads at.
PER_AREA = 3

_LEVEL_ORDER = {"core": 0, "intermediate": 1, "advanced": 2}


@dataclass(frozen=True, slots=True)
class Tiers:
    """Ids drawn in the overview, and the links drawn between them."""

    major: frozenset[str]
    primary: frozenset[frozenset[str]]

    def is_primary(self, source: str, target: str) -> bool:
        return frozenset((source, target)) in self.primary


def _degrees(links: Iterable[tuple[str, str]]) -> dict[str, int]:
    degree: dict[str, int] = {}
    for source, target in links:
        degree[source] = degree.get(source, 0) + 1
        degree[target] = degree.get(target, 0) + 1
    return degree


def compute_tiers(
    nodes: Sequence[Node],
    domains: Sequence[Domain],
    links: Sequence[tuple[str, str]],
    per_area: int = PER_AREA,
) -> Tiers:
    """Rank each area's nodes and keep the first few, plus the links among them.

    A world under the density threshold is left whole: every node is major and every link is
    primary, so a map that already reads well is not thinned for nothing.
    """
    if not nodes:
        return Tiers(frozenset(), frozenset())

    every = frozenset(node.id for node in nodes)
    every_link = frozenset(frozenset((s, t)) for s, t in links)
    if len(links) / len(nodes) <= TIER_ABOVE_DENSITY:
        return Tiers(every, every_link)

    degree = _degrees(links)
    order = {domain.id: domain.order for domain in domains}
    major: set[str] = set()
    for domain_id in sorted(order, key=lambda d: order[d]):
        inside = [node for node in nodes if node.domain == domain_id]
        # A hub first, then the more general of what is left, then the best connected. The id
        # breaks the last tie so the same content always yields the same map.
        inside.sort(
            key=lambda node: (
                not node.meta.hub,
                _LEVEL_ORDER.get(node.meta.level, 1),
                -degree.get(node.id, 0),
                node.id,
            )
        )
        major.update(node.id for node in inside[:per_area])

    # Everything has to be one click from the first screen, or the overview is hiding content
    # rather than summarising it. Any node that no major node touches promotes its best-connected
    # neighbour, which usually covers several at once.
    neighbours: dict[str, list[str]] = {}
    for source, target in links:
        neighbours.setdefault(source, []).append(target)
        neighbours.setdefault(target, []).append(source)

    def covered() -> set[str]:
        reached = set(major)
        for node_id in major:
            reached.update(neighbours.get(node_id, []))
        return reached

    while orphans := sorted(every - covered()):
        candidates = neighbours.get(orphans[0], [])
        if not candidates:
            break  # nothing touches it at all: it can only be reached from the catalogue
        major.add(min(candidates, key=lambda other: (-degree.get(other, 0), other)))

    primary = {key for key in every_link if all(end in major for end in key)}

    # A major node with nothing to connect to would float alone in its area, which reads as a
    # mistake rather than as a summary. Give it back its best link to another major node.
    for node_id in sorted(major):
        if any(node_id in key for key in primary):
            continue
        candidates = [other for other in neighbours.get(node_id, []) if other in major]
        if not candidates:
            continue
        best = min(candidates, key=lambda other: (-degree.get(other, 0), other))
        primary.add(frozenset((node_id, best)))

    return Tiers(frozenset(major), frozenset(primary))
