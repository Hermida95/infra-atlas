"""Build graph.json for the web app from validated content."""

from __future__ import annotations

import json
from collections.abc import Sequence
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from brain.layout import compute_layout
from brain.models import Domain, Node, Planner, Requirement

GRAPH_VERSION = 1

Link = tuple[str, str]


def sort_nodes(nodes: Sequence[Node], domains: Sequence[Domain]) -> list[Node]:
    order = {domain.id: domain.order for domain in domains}
    return sorted(nodes, key=lambda node: (order[node.domain], node.id))


def related_links(nodes: Sequence[Node]) -> list[Link]:
    """Undirected `related` edges between the given nodes, a-b == b-a, first declaration wins."""
    present = {node.id for node in nodes}
    seen: set[frozenset[str]] = set()
    links: list[Link] = []
    for node in nodes:
        for target in node.meta.relations.related:
            key = frozenset((node.id, target))
            if target == node.id or target not in present or key in seen:
                continue
            seen.add(key)
            links.append((node.id, target))
    return links


def build_graph(
    domains: Sequence[Domain],
    nodes: Sequence[Node],
    *,
    requirements: Sequence[Requirement] = (),
    include_pro: bool = False,
    generated_at: datetime | None = None,
) -> dict[str, Any]:
    published = [node for node in nodes if include_pro or node.meta.access != "pro"]
    published = sort_nodes(published, domains)
    links = related_links(published)
    positions = compute_layout(published, {d.id: d for d in domains}, links)
    timestamp = (generated_at or datetime.now(UTC)).astimezone(UTC)

    return {
        "version": GRAPH_VERSION,
        "generatedAt": timestamp.isoformat(timespec="seconds").replace("+00:00", "Z"),
        "domains": [_domain_json(d) for d in sorted(domains, key=lambda d: (d.order, d.id))],
        "requirements": [_requirement_json(r) for r in requirements],
        "nodes": [_node_json(node, positions[node.id]) for node in published],
        "links": [{"source": s, "target": t, "type": "related"} for s, t in links],
    }


def write_graph(graph: dict[str, Any], out: Path) -> None:
    """Atomic write: a crashed build never leaves a half-written graph.json behind."""
    out.parent.mkdir(parents=True, exist_ok=True)
    tmp = out.with_name(f".{out.name}.tmp")
    try:
        tmp.write_text(json.dumps(graph, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        tmp.replace(out)
    finally:
        tmp.unlink(missing_ok=True)


def _domain_json(domain: Domain) -> dict[str, Any]:
    return {
        "id": domain.id,
        "name": domain.name,
        "order": domain.order,
        "position": list(domain.position),
        "hue": domain.hue,
    }


def _node_json(node: Node, position: tuple[float, float, float]) -> dict[str, Any]:
    meta = node.meta
    return {
        "id": meta.id,
        "title": meta.title,
        "type": meta.type,
        "domain": meta.domain,
        "hub": meta.hub,
        "summary": meta.summary,
        "logo": meta.logo,
        "monogram": meta.monogram,
        "level": meta.level,
        "access": meta.access,
        "lead": meta.lead,
        "parts": [{"name": p.name, "kind": p.kind, "text": p.text} for p in meta.parts],
        "lab": meta.lab,
        "position": list(position),
        "planner": _planner_json(meta.planner),
    }


def _requirement_json(requirement: Requirement) -> dict[str, Any]:
    return {"id": requirement.id, "label": requirement.label, "keywords": requirement.keywords}


def _planner_json(planner: Planner | None) -> dict[str, Any] | None:
    if planner is None:
        return None
    return {
        "stage": planner.stage,
        "when": planner.when,
        "why": planner.why,
        "notes": [{"when": note.when, "text": note.text} for note in planner.notes],
    }
