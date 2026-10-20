from datetime import date

import pytest
import yaml
from pydantic import ValidationError

from brain.models import NodeFrontmatter

DOCKER_FRONTMATTER = """
id: docker
title: "Docker"
type: tool
domain: containers
hub: true
summary: "Packages your app and everything it needs so it runs the same on any machine."
logo: docker
level: core
access: free
relations:
  related: [dockerfile, image, container, compose]
lead: "An image is a stack of read-only layers."
parts:
  - name: "Base image"
    kind: os
    text: "A minimal operating system plus the language runtime."
  - name: "Writable container layer"
    kind: rw
    text: "Added at docker run."
lab: docker-layers
reviewed: 2026-10-20
"""


def docker_data() -> dict:
    return yaml.safe_load(DOCKER_FRONTMATTER)


def test_accepts_docker_like_frontmatter() -> None:
    meta = NodeFrontmatter.model_validate(docker_data())

    assert meta.hub is True
    assert meta.relations.related == ["dockerfile", "image", "container", "compose"]
    assert meta.relations.requires == []
    assert [part.kind for part in meta.parts] == ["os", "rw"]
    assert meta.reviewed == date(2026, 10, 20)


def test_applies_defaults() -> None:
    data = {k: v for k, v in docker_data().items() if k not in {"hub", "level", "access"}}
    meta = NodeFrontmatter.model_validate(data)

    assert (meta.hub, meta.level, meta.access) == (False, "core", "free")


@pytest.mark.parametrize(
    "mutate",
    [
        pytest.param(lambda d: d.update(titel="typo"), id="unknown-top-level-key"),
        pytest.param(lambda d: d["relations"].update(relatd=["x"]), id="unknown-relation-key"),
        pytest.param(lambda d: d["parts"][0].update(kind="disk"), id="bad-part-kind"),
        pytest.param(lambda d: d.update(id="Docker"), id="id-not-a-slug"),
        pytest.param(lambda d: d.update(type="library"), id="bad-type"),
        pytest.param(lambda d: d.update(summary="x" * 201), id="summary-too-long"),
        pytest.param(lambda d: d.update(monogram="ecrx"), id="bad-monogram"),
        pytest.param(lambda d: d.pop("reviewed"), id="missing-reviewed"),
    ],
)
def test_rejects_invalid_frontmatter(mutate) -> None:
    data = docker_data()
    mutate(data)

    with pytest.raises(ValidationError):
        NodeFrontmatter.model_validate(data)


@pytest.mark.parametrize(
    ("logo", "ok"),
    [("docker", True), ("aws:lambda", True), ("gcp:run", False), ("aws:Lambda", False)],
)
def test_logo_accepts_simple_icons_and_aws_prefix(logo: str, ok: bool) -> None:
    data = docker_data() | {"logo": logo}
    if ok:
        assert NodeFrontmatter.model_validate(data).logo == logo
    else:
        with pytest.raises(ValidationError):
            NodeFrontmatter.model_validate(data)
