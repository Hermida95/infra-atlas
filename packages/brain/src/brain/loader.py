"""Read content/ from disk into models. Parsing errors are collected, never raised in bulk."""

from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import yaml
from pydantic import ValidationError

from brain.models import Domain, Node, NodeFrontmatter

DOMAINS_FILE = "domains.yaml"
NODES_DIR = "nodes"
NODE_GLOB = "*.mdx"
REPO_MARKER = "pnpm-workspace.yaml"


class ContentError(Exception):
    """A problem tied to one content file."""

    def __init__(self, path: Path, message: str) -> None:
        super().__init__(f"{path}: {message}")
        self.path = path
        self.message = message


class RepoRootNotFoundError(RuntimeError):
    pass


@dataclass
class LoadResult:
    domains: list[Domain] = field(default_factory=list)
    nodes: list[Node] = field(default_factory=list)
    errors: list[ContentError] = field(default_factory=list)


def find_repo_root(start: Path | None = None) -> Path:
    """Walk up from `start` (cwd by default), then from this file, to the monorepo root."""
    candidates = [(start or Path.cwd()).resolve(), Path(__file__).resolve()]
    for candidate in candidates:
        for directory in (candidate, *candidate.parents):
            if (directory / REPO_MARKER).is_file():
                return directory
    raise RepoRootNotFoundError(f"No {REPO_MARKER} found above {candidates[0]}")


def format_validation_error(error: ValidationError) -> list[str]:
    messages = []
    for item in error.errors():
        location = ".".join(str(part) for part in item["loc"]) or "<root>"
        messages.append(f"{location}: {item['msg']}")
    return messages


def split_frontmatter(text: str) -> tuple[str, str]:
    """Return (yaml_text, body). Frontmatter must open on the first line with `---`."""
    lines = text.splitlines(keepends=True)
    if not lines or lines[0].strip() != "---":
        raise ValueError("file must start with a '---' frontmatter line")
    for index, line in enumerate(lines[1:], start=1):
        if line.strip() == "---":
            return "".join(lines[1:index]), "".join(lines[index + 1 :])
    raise ValueError("frontmatter is not closed with a '---' line")


def parse_node_text(text: str, source: Path) -> Node:
    try:
        yaml_text, body = split_frontmatter(text)
        data: Any = yaml.safe_load(yaml_text)
    except ValueError as exc:
        raise ContentError(source, str(exc)) from exc
    except yaml.YAMLError as exc:
        raise ContentError(source, f"invalid YAML: {exc}") from exc

    if not isinstance(data, dict):
        raise ContentError(source, "frontmatter must be a YAML mapping")
    try:
        meta = NodeFrontmatter.model_validate(data)
    except ValidationError as exc:
        raise ContentError(source, "; ".join(format_validation_error(exc))) from exc
    return Node(meta=meta, body=body.strip("\n"), source=source)


def parse_node_file(path: Path) -> Node:
    try:
        text = path.read_text(encoding="utf-8-sig")
    except (OSError, UnicodeDecodeError) as exc:
        raise ContentError(path, f"cannot read file: {exc}") from exc
    return parse_node_text(text, path)


def load_domains(path: Path) -> list[Domain]:
    try:
        data: Any = yaml.safe_load(path.read_text(encoding="utf-8-sig"))
    except OSError as exc:
        raise ContentError(path, f"cannot read file: {exc}") from exc
    except yaml.YAMLError as exc:
        raise ContentError(path, f"invalid YAML: {exc}") from exc

    if not isinstance(data, list):
        raise ContentError(path, "must be a YAML list of domains")
    domains: list[Domain] = []
    problems: list[str] = []
    for index, item in enumerate(data):
        try:
            domains.append(Domain.model_validate(item))
        except ValidationError as exc:
            problems.extend(f"[{index}].{msg}" for msg in format_validation_error(exc))
    if problems:
        raise ContentError(path, "; ".join(problems))
    return domains


def node_files(content_dir: Path) -> Iterable[Path]:
    return sorted((content_dir / NODES_DIR).rglob(NODE_GLOB))


def load_content(content_dir: Path) -> LoadResult:
    result = LoadResult()
    try:
        result.domains = load_domains(content_dir / DOMAINS_FILE)
    except ContentError as exc:
        result.errors.append(exc)

    for path in node_files(content_dir):
        try:
            result.nodes.append(parse_node_file(path))
        except ContentError as exc:
            result.errors.append(exc)
    return result
