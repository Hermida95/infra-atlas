"""Content schema. Single source of truth for what a node and a domain are."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from pathlib import Path
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, model_validator

SLUG_PATTERN = r"^[a-z0-9][a-z0-9-]*$"

Slug = Annotated[str, StringConstraints(pattern=SLUG_PATTERN)]
NonEmptyStr = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1)]

NodeType = Literal["concept", "service", "tool", "pattern", "howto", "comparison", "lab"]
# Shape of each part in a teardown. The web app has one 3D primitive per kind.
PartKind = Literal[
    # layered slabs (Docker)
    "os",
    "pkg",
    "code",
    "meta",
    "rw",
    # compute and orchestration
    "node",
    "pod",
    "bus",
    "orbit",
    "core",
    "machine",
    # data and files
    "cylinder",
    "discs",
    "sheet",
    "plugin",
    "modules",
    "graph",
    # pipelines
    "trigger",
    "jobs",
    "chips",
    # delivery
    "gate",
    "lanes",
    "split",
    "loop",
    # cloud and network
    "disc",
    "zones",
    "vpc",
    "services",
    "shell",
    "ring",
    # observability and AI
    "bars",
    "bell",
    "panel",
    "sphere",
    "satellites",
]
# How the parts are arranged and pulled apart: vertical stack, left-to-right pipeline,
# or a Kubernetes-style cluster (control plane above, nodes holding pods below).
Layout = Literal["stack", "row", "cluster"]
Level = Literal["core", "intermediate", "advanced"]
Access = Literal["free", "pro"]

Stage = Literal[
    "build",
    "containerize",
    "infra",
    "run",
    "data",
    "secure",
    "ship",
    "deliver",
    "observe",
]

SUMMARY_MAX_LENGTH = 200
WHY_MAX_LENGTH = 160


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


class Domain(_Strict):
    id: Slug
    name: NonEmptyStr
    order: int
    position: tuple[float, float, float]
    hue: int = Field(ge=0, le=360)


class Part(_Strict):
    name: NonEmptyStr
    kind: PartKind | None = None
    text: NonEmptyStr


class Relations(_Strict):
    related: list[Slug] = []
    requires: list[Slug] = []
    part_of: list[Slug] = []
    alternative_to: list[Slug] = []
    used_by: list[Slug] = []

    def targets(self) -> list[tuple[str, str]]:
        """Every (relation_kind, target_id) pair, in declaration order."""
        return [(kind, target) for kind in Relations.model_fields for target in getattr(self, kind)]


class Evidence(_Strict):
    """Real code in this repo that proves the concept. `lines` is 1-based and inclusive."""

    path: NonEmptyStr
    lines: tuple[Annotated[int, Field(ge=1)], Annotated[int, Field(ge=1)]]
    text: NonEmptyStr

    @model_validator(mode="after")
    def _ordered(self) -> Evidence:
        if self.lines[0] > self.lines[1]:
            raise ValueError("lines must be [from, to] with from <= to")
        return self


class Requirement(_Strict):
    """Something a user can say about their app. `planner.when` expressions use the ids."""

    id: Annotated[str, StringConstraints(pattern=r"^[a-z0-9]+$")]
    label: NonEmptyStr
    keywords: list[NonEmptyStr] = []


class PlannerNote(_Strict):
    when: NonEmptyStr
    text: NonEmptyStr


class Planner(_Strict):
    stage: Stage
    when: NonEmptyStr
    why: Annotated[str, StringConstraints(min_length=1, max_length=WHY_MAX_LENGTH)]
    notes: list[PlannerNote] = []


class NodeFrontmatter(_Strict):
    id: Slug
    title: NonEmptyStr
    type: NodeType
    domain: Slug
    hub: bool = False
    summary: Annotated[str, StringConstraints(min_length=1, max_length=SUMMARY_MAX_LENGTH)]
    # Simple Icons slug, or aws:<name> for an official AWS Architecture Icon.
    logo: Annotated[str, StringConstraints(pattern=r"^(aws:)?[a-z0-9]+$")] | None = None
    monogram: Annotated[str, StringConstraints(pattern=r"^[A-Z0-9]{1,3}$")] | None = None
    level: Level = "core"
    access: Access = "free"
    relations: Relations = Relations()
    lead: NonEmptyStr | None = None
    parts: list[Part] = []
    layout: Layout = "stack"
    lab: Slug | None = None
    # Lines of this repo that back the card. `brain validate` checks they still exist.
    evidence: list[Evidence] = []
    reviewed: date
    planner: Planner | None = None


@dataclass(frozen=True, slots=True)
class Node:
    """A parsed content file: validated frontmatter plus what is not in it."""

    meta: NodeFrontmatter
    body: str
    source: Path

    @property
    def id(self) -> str:
        return self.meta.id

    @property
    def domain(self) -> str:
        return self.meta.domain
