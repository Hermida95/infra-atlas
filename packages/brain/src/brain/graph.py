"""Build graph.json for the web app from validated content."""

from __future__ import annotations

import json
from collections.abc import Container, Sequence
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from brain.layout import compute_layout
from brain.models import Case, CaseOption, Domain, Node, Planner, Requirement

GRAPH_VERSION = 1

# (source, target, text): `text` is the sentence that says what crosses the edge, empty for
# a plain `related` line.
Link = tuple[str, str, str]


def sort_nodes(nodes: Sequence[Node], domains: Sequence[Domain]) -> list[Node]:
    order = {domain.id: domain.order for domain in domains}
    return sorted(nodes, key=lambda node: (order[node.domain], node.id))


def related_links(nodes: Sequence[Node]) -> list[Link]:
    """Undirected edges between the given nodes, a-b == b-a, first declaration wins.

    A `connects` entry is the same line as a `related` one plus the sentence that explains it,
    so declaring both ways round is harmless: the explained one wins whichever comes first.
    """
    present = {node.id for node in nodes}
    seen: set[frozenset[str]] = set()
    links: list[Link] = []
    for node in nodes:
        explained = [(c.to, c.text) for c in node.meta.connects]
        plain = [(target, "") for target in node.meta.relations.related]
        for target, text in explained + plain:
            key = frozenset((node.id, target))
            if target == node.id or target not in present or key in seen:
                continue
            seen.add(key)
            links.append((node.id, target, text))
    return links


def build_graph(
    domains: Sequence[Domain],
    nodes: Sequence[Node],
    *,
    requirements: Sequence[Requirement] = (),
    cases: Sequence[Case] = (),
    include_pro: bool = False,
    generated_at: datetime | None = None,
) -> dict[str, Any]:
    published = [node for node in nodes if include_pro or node.meta.access != "pro"]
    published = sort_nodes(published, domains)
    links = related_links(published)
    # The ids that actually got published. `related_links` already drops edges that leave
    # this set; `alternatives` has to drop the same ones, or a `pro` node is named in a
    # graph.json that does not contain it.
    present = {node.id for node in published}
    positions = compute_layout(published, {d.id: d for d in domains}, [(s, t) for s, t, _ in links])
    timestamp = (generated_at or datetime.now(UTC)).astimezone(UTC)

    return {
        "version": GRAPH_VERSION,
        "generatedAt": timestamp.isoformat(timespec="seconds").replace("+00:00", "Z"),
        "domains": [_domain_json(d) for d in sorted(domains, key=lambda d: (d.order, d.id))],
        "requirements": [_requirement_json(r) for r in requirements],
        # A case only offers options the published graph can draw, so a `pro` service never
        # shows up as a choice in a free build.
        "cases": [_case_json(case, present) for case in cases],
        "nodes": [_node_json(node, positions[node.id], present) for node in published],
        "links": [_link_json(source, target, text) for source, target, text in links],
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


def _link_json(source: str, target: str, text: str) -> dict[str, Any]:
    link: dict[str, Any] = {"source": source, "target": target, "type": "related"}
    if text:
        link["text"] = text
    return link


def _case_json(case: Case, present: Container[str]) -> dict[str, Any]:
    return {
        "id": case.id,
        "title": case.title,
        "exam": list(case.exam),
        "scenario": case.scenario,
        "asks": list(case.asks),
        "nodes": [nid for nid in case.nodes if nid in present],
        "options": [_option_json(option, present) for option in case.options],
        "teaches": case.teaches,
    }


def _option_json(option: CaseOption, present: Container[str]) -> dict[str, Any]:
    return {
        "id": option.id,
        "name": option.name,
        "verdict": option.verdict,
        "nodes": [nid for nid in option.nodes if nid in present],
        "why": option.why,
        "cost": option.cost,
        "watch": list(option.watch),
    }


def _domain_json(domain: Domain) -> dict[str, Any]:
    return {
        "id": domain.id,
        "name": domain.name,
        "order": domain.order,
        "position": list(domain.position),
        "hue": domain.hue,
    }


def _node_json(
    node: Node, position: tuple[float, float, float], present: Container[str]
) -> dict[str, Any]:
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
        "exam": list(meta.exam),
        "lead": meta.lead,
        "parts": [{"name": p.name, "kind": p.kind, "text": p.text} for p in meta.parts],
        "layout": meta.layout,
        "lab": meta.lab,
        # Alternatives travel with the node, not as links: the planner needs them to say
        # which option it picked and which it left out, and a left-out one is never drawn.
        "alternatives": [alt for alt in meta.relations.alternative_to if alt in present],
        "evidence": [
            {"path": e.path, "lines": list(e.lines), "text": e.text} for e in meta.evidence
        ],
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
