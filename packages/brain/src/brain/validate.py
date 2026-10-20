"""Cross-file rules. A node can be schema-valid alone and still break the graph."""

from __future__ import annotations

from collections.abc import Collection, Sequence
from dataclasses import dataclass, field
from datetime import date, timedelta
from pathlib import Path
from typing import Literal

from brain.loader import load_content
from brain.models import Domain, Node

STALE_AFTER = timedelta(days=365)

Severity = Literal["error", "warning"]


@dataclass(frozen=True, slots=True)
class Issue:
    path: Path
    message: str
    severity: Severity = "error"


@dataclass
class ValidationReport:
    domains: list[Domain] = field(default_factory=list)
    nodes: list[Node] = field(default_factory=list)
    issues: list[Issue] = field(default_factory=list)

    @property
    def errors(self) -> list[Issue]:
        return [issue for issue in self.issues if issue.severity == "error"]

    @property
    def warnings(self) -> list[Issue]:
        return [issue for issue in self.issues if issue.severity == "warning"]

    @property
    def ok(self) -> bool:
        return not self.errors


def validate_content(content_dir: Path, today: date | None = None) -> ValidationReport:
    loaded = load_content(content_dir)
    issues = [Issue(error.path, error.message) for error in loaded.errors]
    issues += check_domains(loaded.domains, content_dir / "domains.yaml")
    issues += check_nodes(loaded.nodes, loaded.domains, today or date.today())
    return ValidationReport(domains=loaded.domains, nodes=loaded.nodes, issues=issues)


def check_domains(domains: Sequence[Domain], source: Path) -> list[Issue]:
    seen: set[str] = set()
    issues = []
    for domain in domains:
        if domain.id in seen:
            issues.append(Issue(source, f"duplicate domain id '{domain.id}'"))
        seen.add(domain.id)
    return issues


def check_nodes(nodes: Sequence[Node], domains: Sequence[Domain], today: date) -> list[Issue]:
    domain_ids = {domain.id for domain in domains}
    first_seen: dict[str, Path] = {}
    issues: list[Issue] = []

    for node in nodes:
        if node.id in first_seen:
            issues.append(
                Issue(node.source, f"duplicate id '{node.id}' (first in {first_seen[node.id]})")
            )
        else:
            first_seen[node.id] = node.source

    for node in nodes:
        issues += _check_node(node, domain_ids, first_seen.keys(), today)
    return issues


def _check_node(
    node: Node, domain_ids: Collection[str], node_ids: Collection[str], today: date
) -> list[Issue]:
    meta, path = node.meta, node.source
    issues: list[Issue] = []

    if meta.id != path.stem:
        issues.append(Issue(path, f"id '{meta.id}' does not match filename '{path.stem}'"))
    if meta.domain != path.parent.name:
        issues.append(
            Issue(path, f"domain '{meta.domain}' does not match folder '{path.parent.name}'")
        )
    if meta.domain not in domain_ids:
        issues.append(Issue(path, f"unknown domain '{meta.domain}'"))

    for kind, target in meta.relations.targets():
        if target == meta.id:
            issues.append(Issue(path, f"relations.{kind}: node relates to itself"))
        elif target not in node_ids:
            issues.append(Issue(path, f"relations.{kind}: unknown node '{target}'"))

    if meta.lab and not meta.parts:
        issues.append(Issue(path, f"lab '{meta.lab}' requires non-empty parts"))

    if today - meta.reviewed > STALE_AFTER:
        issues.append(
            Issue(path, f"not reviewed since {meta.reviewed.isoformat()}", severity="warning")
        )
    return issues
