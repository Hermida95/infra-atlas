from pathlib import Path

from typer.testing import CliRunner

from brain.cli import app
from brain.loader import parse_node_file

runner = CliRunner()


def test_validate_fails_with_exit_1(content_dir: Path, write_node) -> None:
    write_node("docker", relations={"related": ["ghost"]})

    result = runner.invoke(app, ["validate", "--content", str(content_dir)])

    assert result.exit_code == 1
    assert "unknown node 'ghost'" in result.output


def test_validate_summary(content_dir: Path, write_node) -> None:
    write_node("docker", relations={"related": ["image"]})
    write_node("image", relations={"related": ["docker"]})

    result = runner.invoke(app, ["validate", "--content", str(content_dir)])

    assert result.exit_code == 0
    assert "2 nodes, 2 domains, 1 links, 0 requirements, 0 planner rules, OK" in result.output


def test_new_scaffolds_valid_node_and_refuses_overwrite(content_dir: Path) -> None:
    args = [
        "new",
        "nat-gateway",
        "--domain",
        "containers",
        "--title",
        'NAT "GW"',
        "--content",
        str(content_dir),
    ]

    first = runner.invoke(app, [*args, "--type", "service"])
    second = runner.invoke(app, args)

    path = content_dir / "nodes" / "containers" / "nat-gateway.mdx"
    assert first.exit_code == 0, first.output
    node = parse_node_file(path)
    assert (node.meta.title, node.meta.type) == ('NAT "GW"', "service")
    assert second.exit_code == 1
    assert "already exists" in second.output


def test_new_rejects_bad_id_and_unknown_domain(content_dir: Path) -> None:
    bad_id = runner.invoke(
        app, ["new", "../evil", "--domain", "local", "--title", "X", "--content", str(content_dir)]
    )
    bad_domain = runner.invoke(
        app, ["new", "ok", "--domain", "nope", "--title", "X", "--content", str(content_dir)]
    )

    assert bad_id.exit_code == 1
    assert bad_domain.exit_code == 1
    assert not list((content_dir / "nodes").rglob("*.mdx"))


def test_schema_writes_json_schema(tmp_path: Path) -> None:
    out = tmp_path / "node.schema.json"

    result = runner.invoke(app, ["schema", "--out", str(out)])

    assert result.exit_code == 0
    assert '"additionalProperties": false' in out.read_text()


PLAN_EXAMPLE = "FastAPI with Postgres, user login and image uploads on a small budget"


def test_plan_selects_requirements_from_free_text() -> None:
    result = runner.invoke(app, ["plan", "--text", PLAN_EXAMPLE])

    assert result.exit_code == 0, result.output
    assert "Requirements: sql, files, auth, cheap\n" in result.stdout
    assert "RDS Postgres: Managed Postgres" in result.stdout


def test_plan_rejects_unknown_requirement_with_exit_2() -> None:
    result = runner.invoke(app, ["plan", "sql", "nope"])

    assert result.exit_code == 2
    assert "unknown requirement(s): nope" in result.output
