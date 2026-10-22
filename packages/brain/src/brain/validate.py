"""Cross-file rules. A node can be schema-valid alone and still break the graph."""

from __future__ import annotations

from collections.abc import Collection, Sequence
from dataclasses import dataclass, field
from datetime import date, timedelta
from pathlib import Path
from typing import Literal

from brain.loader import DOMAINS_FILE, REQUIREMENTS_FILE, load_content
from brain.models import Domain, Node, Requirement
from brain.planner import KEYWORDS, ExpressionError, parse, variables

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
    requirements: list[Requirement] = field(default_factory=list)
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


def validate_content(
    content_dir: Path, today: date | None = None, repo_root: Path | None = None
) -> ValidationReport:
    loaded = load_content(content_dir)
    issues = [Issue(error.path, error.message) for error in loaded.errors]
    issues += check_domains(loaded.domains, content_dir / DOMAINS_FILE)
    issues += check_nodes(loaded.nodes, loaded.domains, today or date.today())
    issues += check_evidence(loaded.nodes, repo_root or content_dir.parent)
    requirements_path = content_dir / REQUIREMENTS_FILE
    issues += check_requirements(loaded.requirements, requirements_path)
    issues += check_planner_rules(loaded.nodes, loaded.requirements, requirements_path)
    return ValidationReport(
        domains=loaded.domains,
        requirements=loaded.requirements,
        nodes=loaded.nodes,
        issues=issues,
    )


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

    rule = meta.planner
    if (
        rule is not None
        and rule.stage == "deliver"
        and not (meta.relations.part_of or meta.relations.related)
    ):
        issues.append(
            Issue(path, "a deliver node needs a part_of or a related, or it is an orphan")
        )

    if today - meta.reviewed > STALE_AFTER:
        issues.append(
            Issue(path, f"not reviewed since {meta.reviewed.isoformat()}", severity="warning")
        )
    return issues


def check_evidence(nodes: Sequence[Node], repo_root: Path) -> list[Issue]:
    """Every `evidence` entry points at a file in the repo and at lines that still exist."""
    issues: list[Issue] = []
    for node in nodes:
        for index, evidence in enumerate(node.meta.evidence):
            location = f"evidence[{index}]"
            target = Path(evidence.path)
            if target.is_absolute() or ".." in target.parts:
                issues.append(
                    Issue(node.source, f"{location}: '{evidence.path}' is not a repo-relative path")
                )
                continue
            resolved = repo_root / target
            if not resolved.is_file():
                issues.append(Issue(node.source, f"{location}: no such file '{evidence.path}'"))
                continue
            length = len(resolved.read_text(encoding="utf-8", errors="replace").splitlines())
            first, last = evidence.lines
            if last > length:
                issues.append(
                    Issue(
                        node.source,
                        f"{location}: lines {first}-{last} fall outside "
                        f"'{evidence.path}' ({length} lines)",
                    )
                )
    return issues


def check_requirements(requirements: Sequence[Requirement], source: Path) -> list[Issue]:
    seen: set[str] = set()
    issues = []
    for requirement in requirements:
        if requirement.id in seen:
            issues.append(Issue(source, f"duplicate requirement id '{requirement.id}'"))
        if requirement.id in KEYWORDS:
            issues.append(Issue(source, f"requirement id '{requirement.id}' is a reserved word"))
        seen.add(requirement.id)
    return issues


def check_planner_rules(
    nodes: Sequence[Node], requirements: Sequence[Requirement], requirements_path: Path
) -> list[Issue]:
    """Every `when` parses and only names known requirements; warn on unused requirements."""
    known = {requirement.id for requirement in requirements}
    referenced: set[str] = set()
    issues: list[Issue] = []

    for node in nodes:
        rule = node.meta.planner
        if rule is None:
            continue
        expressions = [("planner.when", rule.when)] + [
            (f"planner.notes[{index}].when", note.when) for index, note in enumerate(rule.notes)
        ]
        for location, source in expressions:
            try:
                names = variables(parse(source))
            except ExpressionError as exc:
                issues.append(Issue(node.source, f"{location}: {exc} in {source!r}"))
                continue
            for var in names:
                referenced.add(var.name)
                if var.name not in known:
                    issues.append(
                        Issue(
                            node.source,
                            f"{location}: column {var.column}: unknown requirement "
                            f"'{var.name}' in {source!r}",
                        )
                    )

    issues += [
        Issue(requirements_path, f"requirement '{rid}' is not used by any planner rule", "warning")
        for rid in (requirement.id for requirement in requirements)
        if rid not in referenced
    ]
    return issues
