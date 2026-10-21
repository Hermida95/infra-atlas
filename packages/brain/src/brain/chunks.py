"""Split concepts into the passages the semantic index embeds.

One `overview` chunk per node (title, summary and body) and one `part` chunk per teardown
part. A part chunk starts with the node title so "Engine: the daemon..." still says which
technology it belongs to once it is a vector on its own.
"""

from __future__ import annotations

import hashlib
import json
import re
from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from typing import Literal

from brain.models import Node

ChunkKind = Literal["overview", "part"]

_SPACE = re.compile(r"\s+")
# MDX lines that carry no prose: imports, exports and self-closing components.
_MDX_NOISE = re.compile(r"^\s*(import |export |<[A-Z][^>]*/>\s*$)")


@dataclass(frozen=True, slots=True)
class Chunk:
    id: str
    node_id: str
    kind: ChunkKind
    title: str
    text: str


def _clean(text: str) -> str:
    lines = [line for line in text.splitlines() if not _MDX_NOISE.match(line)]
    return _SPACE.sub(" ", " ".join(lines)).strip()


def chunk_node(node: Node) -> list[Chunk]:
    meta = node.meta
    body = _clean(node.body)
    overview = [meta.title + ".", meta.summary]
    if meta.lead:
        overview.append(meta.lead)
    if body and body not in meta.summary:  # many bodies repeat the summary verbatim
        overview.append(body)

    chunks = [
        Chunk(f"{meta.id}:overview", meta.id, "overview", meta.title, _clean(" ".join(overview)))
    ]
    chunks += [
        Chunk(
            f"{meta.id}:part:{index}",
            meta.id,
            "part",
            meta.title,
            _clean(f"{meta.title}: {p.name}. {p.text}"),
        )
        for index, p in enumerate(meta.parts)
    ]
    return chunks


def chunk_nodes(nodes: Iterable[Node], *, include_pro: bool = False) -> list[Chunk]:
    """Chunks of every published node, sorted by id so the order never depends on disk."""
    published = [n for n in nodes if include_pro or n.meta.access != "pro"]
    return [chunk for node in sorted(published, key=lambda n: n.id) for chunk in chunk_node(node)]


def fingerprint(chunks: Sequence[Chunk], model: dict[str, str | int]) -> str:
    """Changes when any chunk text or the embedding model changes, and only then."""
    payload = {"model": model, "chunks": [[c.id, c.kind, c.title, c.text] for c in chunks]}
    raw = json.dumps(payload, sort_keys=True, ensure_ascii=False).encode()
    return hashlib.sha256(raw).hexdigest()
