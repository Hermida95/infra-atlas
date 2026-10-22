from datetime import date
from pathlib import Path
from typing import Any

import pytest
import yaml

from brain.graph import sort_nodes
from brain.loader import find_repo_root, load_content
from brain.models import Requirement
from brain.planner import (
    And,
    Const,
    ExpressionError,
    Not,
    Or,
    UnknownRequirementError,
    Var,
    evaluate,
    identifiers,
    match_requirements,
    parse,
    plan,
)
from brain.validate import validate_content

TODAY = date(2026, 10, 20)
CONTENT = find_repo_root(Path(__file__).parent) / "content"


def _shape(expr: Any) -> Any:
    """AST without columns, so expected trees stay readable."""
    match expr:
        case Var(name):
            return name
        case Const(value):
            return value
        case Not(operand):
            return ("not", _shape(operand))
        case And(left, right):
            return ("and", _shape(left), _shape(right))
        case Or(left, right):
            return ("or", _shape(left), _shape(right))


# --- Parser ------------------------------------------------------------------


@pytest.mark.parametrize(
    ("source", "tree"),
    [
        ("a or b and not c", ("or", "a", ("and", "b", ("not", "c")))),
        ("(a or b) and c", ("and", ("or", "a", "b"), "c")),
        ("not not a", ("not", ("not", "a"))),
        ("a and b and c", ("and", ("and", "a", "b"), "c")),
        ("  true or false ", ("or", True, False)),
    ],
)
def test_parse_precedence_and_parentheses(source: str, tree: Any) -> None:
    assert _shape(parse(source)) == tree


@pytest.mark.parametrize(
    ("source", "column", "fragment"),
    [
        ("a and", 6, "end of expression"),
        ("(a", 3, "missing ')'"),
        ("a and or", 7, "'or'"),
        ("and", 1, "'and'"),
        ("a b", 3, "unexpected 'b'"),
        ("a )", 3, "unexpected ')'"),
        ("a & b", 3, "unexpected character '&'"),
        ("SQL", 1, "unexpected character 'S'"),
        ("", 1, "empty"),
        ("   ", 1, "empty"),
    ],
)
def test_parse_errors_report_column(source: str, column: int, fragment: str) -> None:
    with pytest.raises(ExpressionError) as info:
        parse(source)

    assert info.value.column == column
    assert fragment in str(info.value)


def test_reserved_word_is_not_an_identifier() -> None:
    with pytest.raises(ExpressionError, match="expected an operand, got 'or'"):
        parse("sql and (or)")
    assert identifiers(parse("not sql")) == {"sql"}


def test_identifiers() -> None:
    assert identifiers(parse("sql or (cheap and not sql)")) == {"sql", "cheap"}
    assert identifiers(parse("true")) == set()


@pytest.mark.parametrize(
    ("source", "selected", "expected"),
    [
        ("true", set(), True),
        ("false", {"a"}, False),
        ("a", {"a"}, True),
        ("a", set(), False),
        ("not a", set(), True),
        ("a and b", {"a"}, False),
        ("a and b", {"a", "b"}, True),
        ("a or b", {"b"}, True),
        ("a or b", set(), False),
        ("a or b and not c", {"a", "c"}, True),
        ("(a or b) and not c", {"a", "c"}, False),
    ],
)
def test_evaluate(source: str, selected: set[str], expected: bool) -> None:
    assert evaluate(parse(source), selected) is expected


# --- Keyword matching --------------------------------------------------------

REQUIREMENTS = [
    Requirement(id="auth", label="Accounts", keywords=["login", "sign up"]),
    Requirement(id="cheap", label="Budget", keywords=["budget", "side project"]),
    Requirement(id="web", label="Web", keywords=["web", "next"]),
]


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        ("User LOGIN", {"auth"}),
        ("a user", set()),
        ("let users Sign\n  Up", {"auth"}),
        ("my side   project", {"cheap"}),
        ("webhooks and nextjs", set()),
        ("a web app, next.", {"web"}),
        ("", set()),
    ],
)
def test_match_requirements_whole_words(text: str, expected: set[str]) -> None:
    assert match_requirements(text, REQUIREMENTS) == expected


# --- Validation of rules -----------------------------------------------------


def _rule(when: str, notes: list[dict[str, str]] | None = None) -> dict[str, Any]:
    return {"stage": "data", "when": when, "why": "Because.", "notes": notes or []}


def test_validate_rejects_unknown_requirement_in_when(
    content_dir: Path, write_node, write_requirements
) -> None:
    write_requirements()
    write_node("rds", planner=_rule("sql and (cheap or foo)"))

    errors = [issue.message for issue in validate_content(content_dir, today=TODAY).errors]

    assert errors == [
        "planner.when: column 19: unknown requirement 'foo' in 'sql and (cheap or foo)'"
    ]


def test_validate_rejects_bad_note_expression(
    content_dir: Path, write_node, write_requirements
) -> None:
    write_requirements()
    notes = [{"when": "sql", "text": "ok"}, {"when": "ghost and sql", "text": "x"}]
    write_node("rds", planner=_rule("sql", notes))
    write_node("s3", planner=_rule("sql and"))

    errors = [issue.message for issue in validate_content(content_dir, today=TODAY).errors]

    assert errors == [
        "planner.notes[1].when: column 1: unknown requirement 'ghost' in 'ghost and sql'",
        "planner.when: column 8: expected an operand, got end of expression in 'sql and'",
    ]


def test_validate_requirement_rules(content_dir: Path, write_node, write_requirements) -> None:
    write_requirements(
        [
            {"id": "sql", "label": "SQL"},
            {"id": "sql", "label": "Again"},
            {"id": "not", "label": "Reserved"},
            {"id": "idle", "label": "Unused"},
        ]
    )
    write_node("rds", planner=_rule("sql"))

    report = validate_content(content_dir, today=TODAY)

    assert [i.message for i in report.errors] == [
        "duplicate requirement id 'sql'",
        "requirement id 'not' is a reserved word",
    ]
    assert [i.message for i in report.warnings] == [
        "requirement 'not' is not used by any planner rule",
        "requirement 'idle' is not used by any planner rule",
    ]


def test_validate_rejects_empty_label_and_long_why(
    content_dir: Path, write_node, write_requirements
) -> None:
    write_requirements([{"id": "sql", "label": "  "}])
    write_node("rds", planner=_rule("true") | {"why": "x" * 161})

    assert len(validate_content(content_dir, today=TODAY).errors) == 2


# --- Route -------------------------------------------------------------------


def test_plan_orders_by_stage_then_input_order(
    content_dir: Path, write_node, write_requirements
) -> None:
    write_requirements()
    write_node("rds", planner=_rule("sql", [{"when": "cheap", "text": "Idle cost."}]))
    write_node("git", planner=_rule("true") | {"stage": "build"})
    write_node("app", planner=_rule("true") | {"stage": "build"})
    write_node("eks", planner=_rule("not sql"))
    write_node("plain")
    loaded = load_content(content_dir)

    route = plan(loaded.nodes, loaded.requirements, {"sql", "cheap"})

    assert [(stage, node.id) for stage, node in route.steps] == [
        ("build", "app"),
        ("build", "git"),
        ("data", "rds"),
    ]
    assert [(note.node.id, note.text) for note in route.notes] == [("rds", "Idle cost.")]


def test_plan_rejects_unknown_requirement(content_dir: Path, write_requirements) -> None:
    write_requirements()

    with pytest.raises(UnknownRequirementError, match="nope"):
        plan([], load_content(content_dir).requirements, {"sql", "nope"})


# --- Parity with the original prototype --------------------------------------

CASES = yaml.safe_load((CONTENT / "planner-cases.yaml").read_text(encoding="utf-8"))


@pytest.fixture(scope="module")
def real_content():
    loaded = load_content(CONTENT)
    assert loaded.errors == []
    return sort_nodes(loaded.nodes, loaded.domains), loaded.requirements


@pytest.mark.parametrize("case", CASES, ids=[case["id"] for case in CASES])
def test_parity_with_prototype(case: dict[str, Any], real_content) -> None:
    nodes, requirements = real_content

    route = plan(nodes, requirements, case["requirements"])

    assert sorted(route.node_ids) == case["nodes"]
    assert len(route.notes) == case["notes"]
    stages: list[dict[str, Any]] = []
    for stage, node in route.steps:
        if not stages or stages[-1]["stage"] != stage:
            stages.append({"stage": stage, "nodes": []})
        stages[-1]["nodes"].append(node.id)
    assert stages == case["stages"]


@pytest.mark.parametrize(
    "case", [c for c in CASES if "text" in c], ids=[c["id"] for c in CASES if "text" in c]
)
def test_free_text_detection_on_planner_cases(case: dict[str, Any], real_content) -> None:
    _, requirements = real_content

    assert sorted(match_requirements(case["text"], requirements)) == case["requirements"]


def test_keyword_with_irregular_spacing_still_matches_text() -> None:
    requirement = Requirement(id="scale", label="Scale", keywords=["high  traffic"])

    assert match_requirements("a HIGH \t traffic site", [requirement]) == {"scale"}
    assert match_requirements("high traffic", [requirement]) == {"scale"}
    assert match_requirements("high-traffic", [requirement]) == set()
