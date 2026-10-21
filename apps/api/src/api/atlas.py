"""Read-only queries over graph.json: lookup, text search and the deployment planner."""

from __future__ import annotations

import json
import re
from collections.abc import Iterable
from dataclasses import dataclass, field
from functools import lru_cache
from typing import Any

from brain.models import Requirement
from brain.planner import STAGES, UnknownRequirementError, evaluate, match_requirements, parse

_WORD = re.compile(r"[a-z0-9]+")


@dataclass(frozen=True, slots=True)
class SearchHit:
    node: dict[str, Any]
    score: int


@dataclass(frozen=True, slots=True)
class PlanResult:
    requirements: list[str]
    stages: list[tuple[str, list[dict[str, Any]]]]
    notes: list[tuple[dict[str, Any], str]]


@dataclass(frozen=True)
class Atlas:
    """Indexed view of one graph.json. Node order is the graph's (domain order, then id)."""

    domains: list[dict[str, Any]]
    requirements: list[Requirement]
    nodes: list[dict[str, Any]]
    by_id: dict[str, dict[str, Any]] = field(repr=False)
    neighbours: dict[str, list[str]] = field(repr=False)

    @classmethod
    def from_graph(cls, graph: dict[str, Any]) -> Atlas:
        nodes = graph.get("nodes", [])
        by_id = {node["id"]: node for node in nodes}
        neighbours: dict[str, list[str]] = {node_id: [] for node_id in by_id}
        for link in graph.get("links", []):
            source, target = link["source"], link["target"]
            if source in by_id and target in by_id:
                neighbours[source].append(target)
                neighbours[target].append(source)
        return cls(
            domains=graph.get("domains", []),
            requirements=[Requirement(**r) for r in graph.get("requirements", [])],
            nodes=nodes,
            by_id=by_id,
            neighbours=neighbours,
        )

    def node_count(self, domain_id: str) -> int:
        return sum(1 for node in self.nodes if node["domain"] == domain_id)

    def related(self, node_id: str) -> list[dict[str, Any]]:
        return [self.by_id[other] for other in self.neighbours.get(node_id, [])]

    def filter_nodes(
        self, *, domain: str | None = None, type: str | None = None, level: str | None = None
    ) -> list[dict[str, Any]]:
        return [
            node
            for node in self.nodes
            if (domain is None or node["domain"] == domain)
            and (type is None or node["type"] == type)
            and (level is None or node["level"] == level)
        ]

    def search(self, query: str, limit: int) -> list[SearchHit]:
        """Every query word must appear in the node. Title and id weigh more than body text."""
        words = _WORD.findall(query.lower())
        if not words:
            return []
        hits = [
            SearchHit(node, score)
            for node in self.nodes
            if (score := _score(node, query.strip().lower(), words)) > 0
        ]
        hits.sort(key=lambda hit: -hit.score)  # stable: ties keep graph order
        return hits[:limit]

    def plan(self, requirement_ids: Iterable[str] = (), text: str | None = None) -> PlanResult:
        """Same rules as `brain plan`, over the published graph. Raises UnknownRequirementError."""
        selected = set(requirement_ids)
        if unknown := selected - {r.id for r in self.requirements}:
            raise UnknownRequirementError(unknown)
        if text:
            selected |= match_requirements(text, self.requirements)

        by_stage: dict[str, list[dict[str, Any]]] = {stage: [] for stage in STAGES}
        for node in self.nodes:
            rule = node.get("planner")
            if rule and evaluate(parse(rule["when"]), selected):
                by_stage[rule["stage"]].append(node)

        stages = [(stage, steps) for stage, steps in by_stage.items() if steps]
        notes = [
            (node, note["text"])
            for _, steps in stages
            for node in steps
            for note in node["planner"]["notes"]
            if evaluate(parse(note["when"]), selected)
        ]
        ordered = [r.id for r in self.requirements if r.id in selected]
        return PlanResult(requirements=ordered, stages=stages, notes=notes)


def _score(node: dict[str, Any], phrase: str, words: list[str]) -> int:
    node_id = node["id"]
    title = node["title"].lower()
    title_words = _WORD.findall(title)
    body = " ".join(
        [node["summary"], node.get("lead") or ""]
        + [f"{part['name']} {part['text']}" for part in node.get("parts", [])]
    ).lower()

    score = 0
    if phrase in (node_id, title):
        score += 100
    elif title.startswith(phrase):
        score += 50
    for word in words:
        if word == node_id or word in title_words:
            score += 30
        elif any(w.startswith(word) for w in title_words) or node_id.startswith(word):
            score += 20
        elif word in title or word in node_id:
            score += 10
        elif word in body:
            score += 3
        else:
            return 0
    return score


@lru_cache(maxsize=4)
def atlas_from_bytes(raw: bytes) -> Atlas:
    """Keyed on the cached graph bytes, so the index is built once per graph file."""
    return Atlas.from_graph(json.loads(raw))
