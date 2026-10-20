"""Content schema. Single source of truth for what a node and a domain are."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from pathlib import Path
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, StringConstraints

SLUG_PATTERN = r"^[a-z0-9][a-z0-9-]*$"

Slug = Annotated[str, StringConstraints(pattern=SLUG_PATTERN)]
NonEmptyStr = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1)]

NodeType = Literal["concept", "service", "tool", "pattern", "howto", "comparison", "lab"]
PartKind = Literal["os", "pkg", "code", "meta", "rw"]
Level = Literal["core", "intermediate", "advanced"]
Access = Literal["free", "pro"]

Stage = Literal["build", "containerize", "infra", "run", "data", "secure", "ship", "observe"]

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
    lab: Slug | None = None
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
