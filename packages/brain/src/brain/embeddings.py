"""Embedding providers. The index and the API only see the `Embedder` protocol.

    EMBEDDINGS_PROVIDER=local    fastembed + BAAI/bge-small-en-v1.5 (ONNX, CPU). Default.
    EMBEDDINGS_PROVIDER=bedrock  Amazon Titan Text Embeddings v2 through bedrock-runtime.

Vectors from different models live in different spaces, so an index records which model
built it (`Embedder.identity`) and the API refuses to query it with another one.
"""

from __future__ import annotations

import hashlib
import json
import os
from collections.abc import Sequence
from pathlib import Path
from typing import Any, Protocol

from brain.loader import RepoRootNotFoundError, find_repo_root

LOCAL_MODEL = "BAAI/bge-small-en-v1.5"
# BGE retrieval models expect this instruction in front of short queries (not passages).
BGE_QUERY_PREFIX = "Represent this sentence for searching relevant passages: "

# SHA-256 of the ONNX file each local model must load. A model repository on Hugging Face
# can change under the same name; pinning the bytes turns that into a loud failure instead
# of a silent change in every vector. `brain embed` prints the digest it loaded.
PINNED_ONNX_SHA256: dict[str, str] = {}

TITAN_MODEL = "amazon.titan-embed-text-v2:0"
TITAN_DIMENSIONS = 512

PROVIDERS = ("local", "bedrock")


class Embedder(Protocol):
    provider: str
    model: str
    model_version: str
    dimensions: int

    def embed_documents(self, texts: Sequence[str]) -> list[list[float]]: ...

    def embed_query(self, text: str) -> list[float]: ...


def identity(embedder: Embedder) -> dict[str, str | int]:
    return {
        "provider": embedder.provider,
        "model": embedder.model,
        "model_version": embedder.model_version,
        "dimensions": embedder.dimensions,
    }


def default_model_cache() -> Path:
    """FASTEMBED_CACHE_PATH, else <repo>/apps/api/data/models (git-ignored, in the image)."""
    if configured := os.environ.get("FASTEMBED_CACHE_PATH"):
        return Path(configured)
    try:
        return find_repo_root() / "apps/api/data/models"
    except RepoRootNotFoundError:
        return Path("data/models")


class LocalEmbedder:
    """fastembed runs the ONNX export of bge-small on CPU: no torch, no GPU, ~67 MB of model."""

    provider = "local"
    dimensions = 384

    def __init__(
        self,
        model: str = LOCAL_MODEL,
        cache_dir: Path | None = None,
        query_prefix: str = BGE_QUERY_PREFIX,
    ) -> None:
        import fastembed  # optional dependency: brain[search]

        self.model = model
        self.query_prefix = query_prefix
        self._engine = fastembed.TextEmbedding(
            model, cache_dir=str(cache_dir or default_model_cache())
        )
        self.onnx_sha256 = onnx_digest(self._engine)
        verify_onnx(model, self.onnx_sha256)
        # The digest is part of the version: an index built from other bytes is a mismatch.
        self.model_version = f"fastembed-{fastembed.__version__}+onnx-{self.onnx_sha256[:16]}"

    def embed_documents(self, texts: Sequence[str]) -> list[list[float]]:
        return [vector.tolist() for vector in self._engine.passage_embed(list(texts))]

    def embed_query(self, text: str) -> list[float]:
        return next(iter(self._engine.query_embed(self.query_prefix + text))).tolist()


def onnx_digest(engine: object) -> str:
    """SHA-256 of the ONNX file fastembed loaded."""
    inner = getattr(engine, "model", None)
    model_dir = getattr(inner, "_model_dir", None)
    description = getattr(inner, "model_description", None)
    model_file = getattr(description, "model_file", None)
    if model_dir is None or model_file is None:
        raise RuntimeError("cannot locate the ONNX file fastembed loaded")
    digest = hashlib.sha256()
    with (Path(model_dir) / model_file).open("rb") as handle:
        for block in iter(lambda: handle.read(1 << 20), b""):
            digest.update(block)
    return digest.hexdigest()


class ModelIntegrityError(RuntimeError):
    pass


def verify_onnx(model: str, digest: str, pinned: dict[str, str] | None = None) -> None:
    expected = (PINNED_ONNX_SHA256 if pinned is None else pinned).get(model)
    if expected is not None and digest != expected:
        raise ModelIntegrityError(f"{model}: ONNX sha256 {digest} does not match pinned {expected}")


class BedrockEmbedder:
    """Titan v2: one InvokeModel call per text, vectors normalised so cosine works as with bge.

    Needs bedrock:InvokeModel on the model ARN. The client is injectable for tests.
    """

    provider = "bedrock"
    model = TITAN_MODEL
    model_version = TITAN_MODEL

    def __init__(self, client: Any = None, dimensions: int = TITAN_DIMENSIONS) -> None:
        if client is None:
            import boto3  # optional dependency: brain[bedrock]

            client = boto3.client("bedrock-runtime")
        self._client = client
        self.dimensions = dimensions

    def _embed(self, text: str) -> list[float]:
        response = self._client.invoke_model(
            modelId=self.model,
            contentType="application/json",
            accept="application/json",
            body=json.dumps({"inputText": text, "dimensions": self.dimensions, "normalize": True}),
        )
        vector = json.loads(response["body"].read())["embedding"]
        if len(vector) != self.dimensions:
            raise ValueError(f"Titan returned {len(vector)} dimensions, expected {self.dimensions}")
        return vector

    def embed_documents(self, texts: Sequence[str]) -> list[list[float]]:
        return [self._embed(text) for text in texts]

    def embed_query(self, text: str) -> list[float]:
        return self._embed(text)


def embedder_from_env() -> Embedder:
    provider = os.environ.get("EMBEDDINGS_PROVIDER", "local").strip().lower()
    if provider == "local":
        return LocalEmbedder()
    if provider == "bedrock":
        return BedrockEmbedder()
    raise ValueError(f"EMBEDDINGS_PROVIDER={provider!r}; expected one of {', '.join(PROVIDERS)}")
