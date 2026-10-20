"""`brain` CLI. Thin layer: argument parsing and printing only."""

from __future__ import annotations

import json
from datetime import date
from enum import StrEnum
from pathlib import Path
from typing import Annotated, get_args

import typer

from brain.graph import build_graph, related_links, sort_nodes, write_graph
from brain.loader import (
    DOMAINS_FILE,
    NODES_DIR,
    ContentError,
    find_repo_root,
    load_domains,
    parse_node_text,
)
from brain.models import SLUG_PATTERN, NodeFrontmatter, NodeType
from brain.planner import STAGES, Route, UnknownRequirementError, match_requirements
from brain.planner import plan as build_route
from brain.validate import Issue, ValidationReport, validate_content

app = typer.Typer(help="Infra Atlas content pipeline.", no_args_is_help=True)

NodeTypeChoice = StrEnum("NodeTypeChoice", {value: value for value in get_args(NodeType)})

ContentOption = Annotated[
    Path | None,
    typer.Option("--content", help="Content directory. Default: <repo>/content."),
]


def _content_dir(content: Path | None) -> Path:
    return content if content is not None else find_repo_root() / "content"


def _display(path: Path) -> str:
    try:
        return str(path.resolve().relative_to(Path.cwd()))
    except ValueError:
        return str(path)


def _print_issues(issues: list[Issue]) -> None:
    for issue in issues:
        label = "ERROR" if issue.severity == "error" else "WARN "
        typer.echo(f"{label} {_display(issue.path)}: {issue.message}", err=True)


def _run_validation(content: Path | None) -> ValidationReport:
    report = validate_content(_content_dir(content))
    _print_issues(report.warnings)
    if not report.ok:
        _print_issues(report.errors)
        typer.echo(f"\n{len(report.errors)} error(s). Fix them and run again.", err=True)
        raise typer.Exit(code=1)
    return report


@app.command()
def validate(content: ContentOption = None) -> None:
    """Validate every node and domain. Exit 1 if any error is found."""
    report = _run_validation(content)
    links = related_links(report.nodes)
    rules = sum(node.meta.planner is not None for node in report.nodes)
    typer.echo(
        f"{len(report.nodes)} nodes, {len(report.domains)} domains, {len(links)} links, "
        f"{len(report.requirements)} requirements, {rules} planner rules, OK"
    )


@app.command()
def graph(
    out: Annotated[
        Path | None,
        typer.Option(help="Output file. Default: <repo>/apps/web/src/data/graph.json."),
    ] = None,
    include_pro: Annotated[bool, typer.Option(help="Include access: pro nodes.")] = False,
    content: ContentOption = None,
) -> None:
    """Validate, lay out and write graph.json."""
    report = _run_validation(content)
    target = out if out is not None else find_repo_root() / "apps/web/src/data/graph.json"
    data = build_graph(
        report.domains, report.nodes, requirements=report.requirements, include_pro=include_pro
    )
    write_graph(data, target)
    typer.echo(f"Wrote {_display(target)}: {len(data['nodes'])} nodes, {len(data['links'])} links")


@app.command()
def schema(
    out: Annotated[
        Path | None,
        typer.Option(help="Output file. Default: <repo>/packages/brain/schema/node.schema.json."),
    ] = None,
) -> None:
    """Write the JSON Schema of the node frontmatter."""
    target = out if out is not None else find_repo_root() / "packages/brain/schema/node.schema.json"
    target.parent.mkdir(parents=True, exist_ok=True)
    payload = NodeFrontmatter.model_json_schema()
    target.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    typer.echo(f"Wrote {_display(target)}")


@app.command("plan")
def plan_command(
    requirement_ids: Annotated[
        list[str] | None,
        typer.Argument(metavar="[REQ]...", help="Requirement ids from requirements.yaml."),
    ] = None,
    text: Annotated[
        str | None,
        typer.Option("--text", help="Free text; requirement keywords found in it are selected."),
    ] = None,
    content: ContentOption = None,
) -> None:
    """Print the deployment route for a set of requirements. Exit 2 on an unknown id."""
    report = _run_validation(content)
    selected = set(requirement_ids or [])
    if text:
        selected |= match_requirements(text, report.requirements)
    try:
        route = build_route(sort_nodes(report.nodes, report.domains), report.requirements, selected)
    except UnknownRequirementError as exc:
        known = ", ".join(r.id for r in report.requirements)
        typer.echo(f"ERROR {exc}. Known: {known}", err=True)
        raise typer.Exit(code=2) from exc

    ordered = [r.id for r in report.requirements if r.id in selected]
    typer.echo(f"Requirements: {', '.join(ordered) or '(none)'}")
    _print_route(route)


def _print_route(route: Route) -> None:
    for stage in STAGES:
        stage_nodes = [node for step_stage, node in route.steps if step_stage == stage]
        if not stage_nodes:
            continue
        typer.echo(f"\n{stage}")
        for node in stage_nodes:
            why = node.meta.planner.why if node.meta.planner else ""
            typer.echo(f"  {node.meta.title}: {why}")
    if route.notes:
        typer.echo("\nNotes")
        for note in route.notes:
            typer.echo(f"  - {note.node.meta.title}: {note.text}")


@app.command()
def new(
    node_id: Annotated[str, typer.Argument(metavar="ID", help="Slug, e.g. 'nat-gateway'.")],
    domain: Annotated[str, typer.Option(help="Domain id from domains.yaml.")],
    title: Annotated[str, typer.Option(help="Display title.")],
    node_type: Annotated[
        NodeTypeChoice, typer.Option("--type", help="Node type.")
    ] = NodeTypeChoice.concept,  # type: ignore[attr-defined]
    content: ContentOption = None,
) -> None:
    """Scaffold content/nodes/<domain>/<id>.mdx. Never overwrites."""
    content_dir = _content_dir(content)
    try:
        domain_ids = {d.id for d in load_domains(content_dir / DOMAINS_FILE)}
    except ContentError as exc:
        typer.echo(f"ERROR {exc}", err=True)
        raise typer.Exit(code=1) from exc
    if domain not in domain_ids:
        typer.echo(
            f"ERROR unknown domain '{domain}'. Known: {', '.join(sorted(domain_ids))}", err=True
        )
        raise typer.Exit(code=1)

    target = content_dir / NODES_DIR / domain / f"{node_id}.mdx"
    text = render_node_template(node_id, domain, title, node_type.value, date.today())
    try:
        parse_node_text(text, target)  # same rules as validate: never scaffold a broken file
    except ContentError as exc:
        typer.echo(f"ERROR {exc.message} (id must match {SLUG_PATTERN})", err=True)
        raise typer.Exit(code=1) from exc

    target.parent.mkdir(parents=True, exist_ok=True)
    try:
        with target.open("x", encoding="utf-8") as handle:
            handle.write(text)
    except FileExistsError as exc:
        typer.echo(f"ERROR {_display(target)} already exists", err=True)
        raise typer.Exit(code=1) from exc
    typer.echo(f"Created {_display(target)}")


def render_node_template(node_id: str, domain: str, title: str, node_type: str, today: date) -> str:
    # json.dumps yields a valid YAML double-quoted scalar, so any title is escaped safely.
    return (
        "---\n"
        f"id: {node_id}\n"
        f"title: {json.dumps(title, ensure_ascii=False)}\n"
        f"type: {node_type}\n"
        f"domain: {domain}\n"
        'summary: "TODO: one sentence, what it is and why it matters."\n'
        "level: core\n"
        "access: free\n"
        f"reviewed: {today.isoformat()}\n"
        "---\n\n"
        "TODO\n"
    )
