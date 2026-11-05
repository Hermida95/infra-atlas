from collections.abc import Callable
from datetime import date
from pathlib import Path
from typing import Any

import pytest
import yaml

from brain.loader import find_repo_root
from brain.validate import validate_content

TODAY = date(2026, 10, 20)


def messages(report) -> list[str]:
    return [issue.message for issue in report.errors]


def test_valid_content_passes(content_dir: Path, write_node) -> None:
    write_node("docker", relations={"related": ["image"]})
    write_node("image")

    report = validate_content(content_dir, today=TODAY)

    assert report.ok, messages(report)
    assert len(report.nodes) == 2


def test_missing_relation_target(content_dir: Path, write_node) -> None:
    write_node("docker", relations={"related": ["ghost"]})

    report = validate_content(content_dir, today=TODAY)

    assert messages(report) == ["relations.related: unknown node 'ghost'"]


def test_self_relation(content_dir: Path, write_node) -> None:
    write_node("docker", relations={"requires": ["docker"]})

    assert messages(validate_content(content_dir, today=TODAY)) == [
        "relations.requires: node relates to itself"
    ]


def test_id_filename_mismatch(content_dir: Path, write_node) -> None:
    write_node("docker", filename="dokcer")

    assert messages(validate_content(content_dir, today=TODAY)) == [
        "id 'docker' does not match filename 'dokcer'"
    ]


def test_duplicate_id(content_dir: Path, write_node) -> None:
    write_node("docker", "containers")
    write_node("docker", "local")

    errors = validate_content(content_dir, today=TODAY).errors

    assert len(errors) == 1
    assert errors[0].message.startswith("duplicate id 'docker'")


def test_unknown_domain(content_dir: Path, write_node) -> None:
    write_node("docker", "ghost")

    assert messages(validate_content(content_dir, today=TODAY)) == ["unknown domain 'ghost'"]


def test_folder_must_match_domain(content_dir: Path, write_node) -> None:
    path = write_node("docker", "containers")
    moved = content_dir / "nodes" / "local" / path.name
    moved.parent.mkdir()
    path.rename(moved)

    assert messages(validate_content(content_dir, today=TODAY)) == [
        "domain 'containers' does not match folder 'local'"
    ]


def test_lab_requires_parts(content_dir: Path, write_node) -> None:
    write_node("docker", lab="docker-layers")

    assert messages(validate_content(content_dir, today=TODAY)) == [
        "lab 'docker-layers' requires non-empty parts"
    ]


def test_collects_all_errors_including_schema(content_dir: Path, write_node) -> None:
    write_node("docker", relations={"related": ["ghost"]})
    write_node("image", kind="oops")
    (content_dir / "nodes" / "containers" / "broken.mdx").write_text("no frontmatter\n")

    report = validate_content(content_dir, today=TODAY)

    assert len(report.errors) == 3


def test_stale_review_is_a_warning(content_dir: Path, write_node) -> None:
    write_node("docker", reviewed="2025-01-01")

    report = validate_content(content_dir, today=TODAY)

    assert report.ok
    assert [w.message for w in report.warnings] == ["not reviewed since 2025-01-01"]


def test_evidence_must_point_at_lines_that_exist(content_dir: Path, write_node) -> None:
    workflow = content_dir.parent / ".github" / "release.yml"
    workflow.parent.mkdir(parents=True)
    workflow.write_text("one\ntwo\nthree\n")
    evidence = {"path": ".github/release.yml", "lines": [1, 3], "text": "How this repo signs."}
    write_node("docker", evidence=[evidence])
    write_node("image", evidence=[evidence | {"lines": [2, 9]}])
    write_node("layers", evidence=[evidence | {"path": ".github/gone.yml"}])

    assert messages(validate_content(content_dir, today=TODAY)) == [
        "evidence[0]: lines 2-9 fall outside '.github/release.yml' (3 lines)",
        "evidence[0]: no such file '.github/gone.yml'",
    ]


def test_evidence_path_cannot_escape_the_repo(content_dir: Path, write_node) -> None:
    write_node("docker", evidence=[{"path": "../keys.env", "lines": [1, 1], "text": "Nope."}])

    assert messages(validate_content(content_dir, today=TODAY)) == [
        "evidence[0]: '../keys.env' is not a repo-relative path"
    ]


def test_deliver_node_without_relations_is_an_orphan(content_dir: Path, write_node) -> None:
    rule = {"stage": "deliver", "when": "true", "why": "Go back to the previous version."}
    write_node("rollback", planner=rule)
    write_node("canary", planner=rule, relations={"part_of": ["rollback"]})

    assert messages(validate_content(content_dir, today=TODAY)) == [
        "a deliver node needs a part_of or a related, or it is an orphan"
    ]


def test_real_content_has_no_errors() -> None:
    content = find_repo_root(Path(__file__).parent) / "content"

    report = validate_content(content)

    assert report.errors == []
    assert len(report.nodes) > 0


def _case(**overrides: Any) -> dict[str, Any]:
    data: dict[str, Any] = {
        "id": "pick-one",
        "title": "Pick one",
        "scenario": "Something has to be chosen.",
        "nodes": ["docker"],
        "options": [
            {"id": "a", "name": "A", "verdict": "best", "nodes": ["docker"], "why": "It is."},
            {"id": "b", "name": "B", "verdict": "works", "nodes": ["docker"], "why": "Also."},
        ],
    }
    data.update(overrides)
    return data


@pytest.fixture
def write_cases(content_dir: Path) -> Callable[..., Path]:
    def _write(cases: list[dict[str, Any]]) -> Path:
        path = content_dir / "cases.yaml"
        path.write_text(yaml.safe_dump(cases, sort_keys=False))
        return path

    return _write


def test_connects_to_an_unknown_node_is_an_error(content_dir: Path, write_node) -> None:
    write_node("docker", connects=[{"to": "ghost", "text": "Nothing there."}])

    report = validate_content(content_dir)

    assert not report.ok
    assert "connects[0]: unknown node 'ghost'" in report.errors[0].message


def test_a_node_cannot_explain_the_same_edge_twice(content_dir: Path, write_node) -> None:
    write_node(
        "docker",
        connects=[{"to": "image", "text": "One."}, {"to": "image", "text": "Two."}],
    )
    write_node("image")

    report = validate_content(content_dir)

    assert not report.ok
    assert "connects: 'image' is explained twice" in report.errors[0].message


def test_a_case_must_commit_to_exactly_one_best_option(
    content_dir: Path, write_node, write_cases
) -> None:
    write_node("docker")
    options = [
        {"id": "a", "name": "A", "verdict": "works", "nodes": ["docker"], "why": "Maybe."},
        {"id": "b", "name": "B", "verdict": "works", "nodes": ["docker"], "why": "Maybe."},
    ]
    write_cases([_case(options=options)])

    report = validate_content(content_dir)

    assert not report.ok
    assert "exactly one option must be 'best', found 0" in report.errors[0].message


def test_a_case_needs_a_real_choice(content_dir: Path, write_node, write_cases) -> None:
    write_node("docker")
    only = [{"id": "a", "name": "A", "verdict": "best", "nodes": ["docker"], "why": "It is."}]
    write_cases([_case(options=only)])

    report = validate_content(content_dir)

    assert not report.ok
    assert "needs at least two options" in report.errors[0].message


def test_an_avoid_option_has_to_say_what_goes_wrong(
    content_dir: Path, write_node, write_cases
) -> None:
    write_node("docker")
    options = [
        {"id": "a", "name": "A", "verdict": "best", "nodes": ["docker"], "why": "It is."},
        {"id": "b", "name": "B", "verdict": "avoid", "nodes": ["docker"], "why": "It is not."},
    ]
    write_cases([_case(options=options)])

    report = validate_content(content_dir)

    assert not report.ok
    assert "an 'avoid' option must say what goes wrong" in report.errors[0].message


def test_a_case_cannot_name_a_node_that_does_not_exist(
    content_dir: Path, write_node, write_cases
) -> None:
    write_node("docker")
    write_cases([_case(nodes=["docker", "ghost"])])

    report = validate_content(content_dir)

    assert not report.ok
    assert "unknown node 'ghost'" in report.errors[0].message


def test_a_valid_case_is_loaded(content_dir: Path, write_node, write_cases) -> None:
    write_node("docker")
    write_cases([_case()])

    report = validate_content(content_dir)

    assert report.ok
    assert [c.id for c in report.cases] == ["pick-one"]


def test_an_option_cannot_light_a_service_the_case_does_not_name(
    content_dir: Path, write_node, write_cases
) -> None:
    """Picking an option narrows what is lit, so it can never add to it."""
    write_node("docker")
    write_node("image")
    options = [
        {"id": "a", "name": "A", "verdict": "best", "nodes": ["docker"], "why": "It is."},
        {"id": "b", "name": "B", "verdict": "works", "nodes": ["image"], "why": "Also."},
    ]
    write_cases([_case(nodes=["docker"], options=options)])

    report = validate_content(content_dir)

    assert not report.ok
    assert "'image' is not in the case's own nodes" in report.errors[0].message


def test_a_lead_without_parts_is_an_error(content_dir: Path, write_node) -> None:
    """`lead` introduces the teardown, so it means nothing when there is nothing to take apart."""
    write_node("docker", lead="Here is what it is made of.")

    report = validate_content(content_dir)

    assert not report.ok
    assert "lead" in report.errors[0].message
