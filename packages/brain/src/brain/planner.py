"""Deployment planner: the `when` expression language and the route builder.

Grammar (keywords are reserved and cannot be requirement ids):

    expr := or
    or   := and ("or" and)*
    and  := not ("and" not)*
    not  := "not" not | atom
    atom := "true" | "false" | IDENT | "(" expr ")"
    IDENT := [a-z0-9]+
"""

from __future__ import annotations

import re
from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from functools import lru_cache
from typing import get_args

from brain.models import Node, Requirement, Stage

STAGES: tuple[Stage, ...] = get_args(Stage)
KEYWORDS = frozenset({"and", "or", "not", "true", "false"})

_TOKEN = re.compile(r"(?P<space>\s+)|(?P<word>[a-z0-9]+)|(?P<punct>[()])|(?P<bad>.)")


# --- AST ---------------------------------------------------------------------


@dataclass(frozen=True, slots=True)
class Const:
    value: bool


@dataclass(frozen=True, slots=True)
class Var:
    name: str
    column: int


@dataclass(frozen=True, slots=True)
class Not:
    operand: Expr


@dataclass(frozen=True, slots=True)
class And:
    left: Expr
    right: Expr


@dataclass(frozen=True, slots=True)
class Or:
    left: Expr
    right: Expr


type Expr = Const | Var | Not | And | Or


class ExpressionError(ValueError):
    """A `when` expression that does not parse. `column` is 1-based."""

    def __init__(self, message: str, column: int) -> None:
        super().__init__(f"column {column}: {message}")
        self.message = message
        self.column = column


# --- Tokenizer and parser ----------------------------------------------------


@dataclass(frozen=True, slots=True)
class _Token:
    text: str
    column: int  # 1-based

    @property
    def is_ident(self) -> bool:
        return self.text not in KEYWORDS and self.text not in ("(", ")")


def tokenize(source: str) -> list[_Token]:
    tokens: list[_Token] = []
    for match in _TOKEN.finditer(source):
        kind = match.lastgroup
        if kind == "space":
            continue
        if kind == "bad":
            raise ExpressionError(f"unexpected character {match.group()!r}", match.start() + 1)
        tokens.append(_Token(match.group(), match.start() + 1))
    return tokens


class _Parser:
    def __init__(self, source: str) -> None:
        self._tokens = tokenize(source)
        self._index = 0
        self._end_column = len(source.rstrip()) + 1

    def parse(self) -> Expr:
        if not self._tokens:
            raise ExpressionError("empty expression", 1)
        expr = self._or()
        if (token := self._peek()) is not None:
            raise ExpressionError(f"unexpected {token.text!r}", token.column)
        return expr

    def _peek(self) -> _Token | None:
        return self._tokens[self._index] if self._index < len(self._tokens) else None

    def _accept(self, text: str) -> bool:
        token = self._peek()
        if token is not None and token.text == text:
            self._index += 1
            return True
        return False

    def _or(self) -> Expr:
        expr = self._and()
        while self._accept("or"):
            expr = Or(expr, self._and())
        return expr

    def _and(self) -> Expr:
        expr = self._not()
        while self._accept("and"):
            expr = And(expr, self._not())
        return expr

    def _not(self) -> Expr:
        if self._accept("not"):
            return Not(self._not())
        return self._atom()

    def _atom(self) -> Expr:
        token = self._peek()
        if token is None:
            raise ExpressionError("expected an operand, got end of expression", self._end_column)
        self._index += 1
        if token.text in ("true", "false"):
            return Const(token.text == "true")
        if token.text == "(":
            expr = self._or()
            if not self._accept(")"):
                closing = self._peek()
                column = closing.column if closing else self._end_column
                raise ExpressionError(f"missing ')' for '(' at column {token.column}", column)
            return expr
        if token.is_ident:
            return Var(token.text, token.column)
        raise ExpressionError(f"expected an operand, got {token.text!r}", token.column)


@lru_cache(maxsize=512)
def parse(source: str) -> Expr:
    """Parse a `when` expression. Raises ExpressionError. Cached: ASTs are immutable."""
    return _Parser(source).parse()


def evaluate(expr: Expr, selected: set[str] | frozenset[str]) -> bool:
    match expr:
        case Const(value):
            return value
        case Var(name):
            return name in selected
        case Not(operand):
            return not evaluate(operand, selected)
        case And(left, right):
            return evaluate(left, selected) and evaluate(right, selected)
        case Or(left, right):
            return evaluate(left, selected) or evaluate(right, selected)
    raise TypeError(f"not an expression: {expr!r}")


def variables(expr: Expr) -> list[Var]:
    """Every identifier occurrence, in source order (keeps the column for error messages)."""
    match expr:
        case Var():
            return [expr]
        case Not(operand):
            return variables(operand)
        case And(left, right) | Or(left, right):
            return variables(left) + variables(right)
    return []


def identifiers(expr: Expr) -> set[str]:
    return {var.name for var in variables(expr)}


# --- Free-text matching ------------------------------------------------------


def _keyword_pattern(keyword: str) -> re.Pattern[str]:
    """Whole-word pattern for a keyword, to run against lower-cased text.

    Lower-casing the text (not re.IGNORECASE) keeps this identical to the web planner:
    IGNORECASE folds characters like the long s ("ſ") into "s", `toLowerCase` does not.
    """
    words = r"\s+".join(re.escape(word) for word in keyword.lower().split())
    return re.compile(rf"(?<![a-z0-9]){words}(?![a-z0-9])")


def match_requirements(text: str, requirements: Iterable[Requirement]) -> set[str]:
    """Requirement ids whose keywords appear in `text` as whole words, case-insensitive."""
    lowered = text.lower()
    return {
        requirement.id
        for requirement in requirements
        if any(_keyword_pattern(keyword).search(lowered) for keyword in requirement.keywords)
    }


# --- Route -------------------------------------------------------------------


class UnknownRequirementError(ValueError):
    def __init__(self, unknown: Iterable[str]) -> None:
        self.unknown = sorted(unknown)
        super().__init__(f"unknown requirement(s): {', '.join(self.unknown)}")


@dataclass(frozen=True, slots=True)
class RouteNote:
    node: Node
    text: str


@dataclass(frozen=True, slots=True)
class Route:
    steps: tuple[tuple[Stage, Node], ...]
    notes: tuple[RouteNote, ...]

    @property
    def node_ids(self) -> list[str]:
        return [node.id for _, node in self.steps]


def plan(
    nodes: Sequence[Node], requirements: Sequence[Requirement], selected: Iterable[str]
) -> Route:
    """Nodes whose `planner.when` holds for `selected`, ordered by stage, then input order.

    Notes follow route order, then declaration order. Expressions must already be valid
    (run validation first); an invalid one raises ExpressionError.
    """
    chosen = frozenset(selected)
    if unknown := chosen - {requirement.id for requirement in requirements}:
        raise UnknownRequirementError(unknown)

    rank = {stage: index for index, stage in enumerate(STAGES)}
    matched = [
        (node, rule)
        for node in nodes
        if (rule := node.meta.planner) is not None and evaluate(parse(rule.when), chosen)
    ]
    matched.sort(key=lambda pair: rank[pair[1].stage])  # stable: keeps input order per stage

    return Route(
        steps=tuple((rule.stage, node) for node, rule in matched),
        notes=tuple(
            RouteNote(node, note.text)
            for node, rule in matched
            for note in rule.notes
            if evaluate(parse(note.when), chosen)
        ),
    )
