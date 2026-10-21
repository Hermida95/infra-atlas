"""The semantic index: one LanceDB table of chunk vectors in a local directory.

LanceDB is an embedded database (like SQLite): the table is a folder of Lance files that
the process reads directly, so there is no server to run. The same folder can later live
in S3 (`lancedb.connect("s3://...")`) without code changes.
"""

from __future__ import annotations

import json
import shutil
from collections.abc import Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from brain.chunks import Chunk, fingerprint
from brain.embeddings import Embedder, identity
from brain.loader import RepoRootNotFoundError, find_repo_root

TABLE = "chunks"
METADATA_KEY = b"infra_atlas"
INDEX_FORMAT = 1


class IndexUnavailableError(Exception):
    pass


class IndexModelMismatchError(IndexUnavailableError):
    """The index was embedded with a different model than the one configured for queries."""


@dataclass(frozen=True, slots=True)
class IndexInfo:
    path: Path
    model: dict[str, str | int]
    fingerprint: str
    chunks: int
    written: bool


@dataclass(frozen=True, slots=True)
class ChunkHit:
    id: str
    node_id: str
    kind: str
    title: str
    text: str
    score: float  # cosine similarity, 1 is identical


def default_index_path() -> Path:
    try:
        return find_repo_root() / "apps/api/data/vectors.lance"
    except RepoRootNotFoundError:
        return Path("data/vectors.lance")


def _schema(dimensions: int, metadata: dict[str, Any]) -> Any:
    import pyarrow as pa

    return pa.schema(
        [
            pa.field("id", pa.string(), nullable=False),
            pa.field("node_id", pa.string(), nullable=False),
            pa.field("kind", pa.string(), nullable=False),
            pa.field("title", pa.string(), nullable=False),
            pa.field("text", pa.string(), nullable=False),
            pa.field("vector", pa.list_(pa.float32(), dimensions), nullable=False),
        ],
        metadata={METADATA_KEY: json.dumps(metadata, sort_keys=True).encode()},
    )


def read_metadata(path: Path) -> dict[str, Any] | None:
    """The index metadata, or None when there is no readable index at `path`."""
    import lancedb

    if not path.is_dir():
        return None
    try:
        table = lancedb.connect(path).open_table(TABLE)
    except (FileNotFoundError, ValueError):
        return None
    raw = (table.schema.metadata or {}).get(METADATA_KEY)
    return json.loads(raw) if raw else None


def build_index(
    chunks: Sequence[Chunk], embedder: Embedder, path: Path, *, force: bool = False
) -> IndexInfo:
    """Embed `chunks` into a fresh table at `path`. Skips all work when nothing changed.

    Written to a sibling directory first and swapped in, so a crash never leaves half an index.
    """
    import lancedb
    import pyarrow as pa

    model = identity(embedder)
    digest = fingerprint(chunks, model)
    current = read_metadata(path)
    if not force and current and current.get("fingerprint") == digest:
        return IndexInfo(path, model, digest, len(chunks), written=False)

    vectors = embedder.embed_documents([chunk.text for chunk in chunks])
    metadata = {"format": INDEX_FORMAT, **model, "fingerprint": digest, "chunks": len(chunks)}
    schema = _schema(embedder.dimensions, metadata)
    data = pa.Table.from_pylist(
        [
            {
                "id": c.id,
                "node_id": c.node_id,
                "kind": c.kind,
                "title": c.title,
                "text": c.text,
                "vector": v,
            }
            for c, v in zip(chunks, vectors, strict=True)
        ],
        schema=schema,
    )

    staging = path.with_name(f".{path.name}.tmp")
    shutil.rmtree(staging, ignore_errors=True)
    try:
        lancedb.connect(staging).create_table(TABLE, data=data, schema=schema)
        shutil.rmtree(path, ignore_errors=True)
        path.parent.mkdir(parents=True, exist_ok=True)
        staging.rename(path)
    finally:
        shutil.rmtree(staging, ignore_errors=True)
    return IndexInfo(path, model, digest, len(chunks), written=True)


class VectorIndex:
    """Read side, used by the API. Open once, query many times."""

    def __init__(self, path: Path) -> None:
        import lancedb

        metadata = read_metadata(path)
        if metadata is None:
            raise IndexUnavailableError(f"vector index not found at {path}; run `brain embed`")
        self.path = path
        self.metadata = metadata
        self._table = lancedb.connect(path).open_table(TABLE)

    @property
    def model(self) -> dict[str, Any]:
        return {
            key: self.metadata.get(key)
            for key in ("provider", "model", "model_version", "dimensions")
        }

    def check(self, embedder: Embedder) -> None:
        """Vectors from another model are not comparable: refuse instead of returning noise."""
        if self.model != identity(embedder):
            raise IndexModelMismatchError(
                f"vector index at {self.path} was built with {self.model}, but the API embeds "
                f"queries with {identity(embedder)}; run `brain embed` with the same provider"
            )

    def search(self, vector: Sequence[float], limit: int) -> list[ChunkHit]:
        rows = (
            self._table.search(list(vector), vector_column_name="vector")
            .distance_type("cosine")
            .limit(limit)
            .select(["id", "node_id", "kind", "title", "text", "_distance"])
            .to_list()
        )
        return [
            ChunkHit(
                r["id"],
                r["node_id"],
                r["kind"],
                r["title"],
                r["text"],
                round(1.0 - r["_distance"], 4),
            )
            for r in rows
        ]

    def __len__(self) -> int:
        return self._table.count_rows()
