"""Response and request models. They document the API in /docs; graph.json stays the source."""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field


class DomainOut(BaseModel):
    id: str
    name: str
    order: int
    hue: int
    node_count: int


class RequirementOut(BaseModel):
    id: str
    label: str
    keywords: list[str]


class NodeSummary(BaseModel):
    id: str
    title: str
    type: str
    domain: str
    level: str
    summary: str

    @classmethod
    def of(cls, node: dict[str, Any]) -> NodeSummary:
        return cls(**{name: node[name] for name in cls.model_fields})


class PartOut(BaseModel):
    name: str
    kind: str | None
    text: str


class PlannerNoteOut(BaseModel):
    when: str
    text: str


class PlannerOut(BaseModel):
    stage: str
    when: str
    why: str
    notes: list[PlannerNoteOut]


class NodeDetail(NodeSummary):
    hub: bool
    logo: str | None
    monogram: str | None
    access: str
    lead: str | None
    parts: list[PartOut]
    layout: str
    lab: str | None
    planner: PlannerOut | None
    related: list[NodeSummary]


class SearchHitOut(NodeSummary):
    score: int


class SearchOut(BaseModel):
    query: str
    hits: list[SearchHitOut]


class PlanIn(BaseModel):
    requirements: list[str] = Field(default=[], description="Requirement ids, see /requirements.")
    text: str | None = Field(
        default=None,
        max_length=1000,
        description="Free text; requirement keywords found in it are selected too.",
        examples=["FastAPI with Postgres, user login and image uploads on a small budget"],
    )


class PlanStepOut(BaseModel):
    id: str
    title: str
    domain: str
    why: str


class PlanStageOut(BaseModel):
    stage: str
    steps: list[PlanStepOut]


class PlanNoteOut(BaseModel):
    node: str
    text: str


class PlanOut(BaseModel):
    requirements: list[str]
    stages: list[PlanStageOut]
    notes: list[PlanNoteOut]
