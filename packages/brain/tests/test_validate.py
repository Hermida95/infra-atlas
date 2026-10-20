from datetime import date
from pathlib import Path

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


def test_real_content_has_no_errors() -> None:
    content = find_repo_root(Path(__file__).parent) / "content"

    report = validate_content(content)

    assert report.errors == []
    assert len(report.nodes) > 0
