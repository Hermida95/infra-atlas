import hashlib
import io
import json
import math
import re
from collections.abc import Sequence
from pathlib import Path

import pytest
from typer.testing import CliRunner

from brain import embeddings
from brain.chunks import chunk_nodes, fingerprint
from brain.cli import app
from brain.embeddings import BedrockEmbedder, embedder_from_env, identity
from brain.loader import load_content
from brain.vectors import IndexUnavailableError, VectorIndex, build_index, read_metadata

runner = CliRunner()


class HashEmbedder:
    """Deterministic bag-of-words vectors: enough to test plumbing, says nothing about quality."""

    provider = "test"
    model = "hash"
    model_version = "1"
    dimensions = 64

    def __init__(self) -> None:
        self.calls = 0

    def _vector(self, text: str) -> list[float]:
        vector = [0.0] * self.dimensions
        for word in re.findall(r"[a-z0-9]+", text.lower()):
            vector[int(hashlib.md5(word.encode()).hexdigest(), 16) % self.dimensions] += 1.0
        norm = math.sqrt(sum(x * x for x in vector)) or 1.0
        return [x / norm for x in vector]

    def embed_documents(self, texts: Sequence[str]) -> list[list[float]]:
        self.calls += 1
        return [self._vector(text) for text in texts]

    def embed_query(self, text: str) -> list[float]:
        return self._vector(text)


PARTS = [
    {"name": "Engine", "kind": "core", "text": "The daemon that builds and runs images."},
    {"name": "Registry", "text": "Where images are pushed and pulled."},
]


@pytest.fixture
def nodes(content_dir: Path, write_node):
    write_node("docker", summary="Packages your app.", parts=PARTS, lead="Ship one image.")
    write_node("compose", summary="Runs several containers together.")
    write_node("secret", summary="Only for subscribers.", access="pro")
    loaded = load_content(content_dir)
    assert loaded.errors == []
    return loaded.nodes


def test_chunks_overview_and_one_per_part(nodes) -> None:
    chunks = chunk_nodes(nodes)

    assert [(c.id, c.kind) for c in chunks] == [
        ("compose:overview", "overview"),
        ("docker:overview", "overview"),
        ("docker:part:0", "part"),
        ("docker:part:1", "part"),
    ]
    overview = chunks[1].text
    assert overview.startswith("Docker. Packages your app. Ship one image.")
    assert "Body of docker." in overview
    assert chunks[2].text == "Docker: Engine. The daemon that builds and runs images."
    assert {c.node_id for c in chunks} == {"compose", "docker"}  # pro excluded


def test_chunks_include_pro_on_request(nodes) -> None:
    assert "secret" in {c.node_id for c in chunk_nodes(nodes, include_pro=True)}


def test_fingerprint_tracks_text_and_model(nodes) -> None:
    chunks = chunk_nodes(nodes)
    model = identity(HashEmbedder())

    assert fingerprint(chunks, model) == fingerprint(list(chunks), dict(model))
    assert fingerprint(chunks[:-1], model) != fingerprint(chunks, model)
    assert fingerprint(chunks, {**model, "model_version": "2"}) != fingerprint(chunks, model)


def test_build_is_idempotent_and_records_the_model(nodes, tmp_path: Path) -> None:
    chunks = chunk_nodes(nodes)
    embedder = HashEmbedder()
    path = tmp_path / "vectors.lance"

    first = build_index(chunks, embedder, path)
    second = build_index(chunks, embedder, path)

    assert first.written and not second.written
    assert embedder.calls == 1
    assert first.fingerprint == second.fingerprint
    metadata = read_metadata(path)
    assert metadata["model"] == "hash" and metadata["dimensions"] == 64
    assert metadata["chunks"] == 4
    assert not (tmp_path / ".vectors.lance.tmp").exists()

    assert build_index(chunks, embedder, path, force=True).written
    assert build_index(chunks[:2], embedder, path).written  # content changed


def test_index_search_returns_cosine_scores(nodes, tmp_path: Path) -> None:
    embedder = HashEmbedder()
    path = tmp_path / "vectors.lance"
    build_index(chunk_nodes(nodes), embedder, path)
    index = VectorIndex(path)

    hits = index.search(embedder.embed_query("pushed and pulled images registry"), limit=2)

    assert len(index) == 4
    assert hits[0].id == "docker:part:1"
    assert 0 < hits[1].score < hits[0].score <= 1


def test_index_refuses_another_model(nodes, tmp_path: Path) -> None:
    path = tmp_path / "vectors.lance"
    build_index(chunk_nodes(nodes), HashEmbedder(), path)
    other = HashEmbedder()
    other.model = "other"

    with pytest.raises(IndexUnavailableError, match="built with"):
        VectorIndex(path).check(other)


def test_missing_index(tmp_path: Path) -> None:
    assert read_metadata(tmp_path / "nope") is None
    with pytest.raises(IndexUnavailableError, match="brain embed"):
        VectorIndex(tmp_path / "nope")


def test_cli_embed(content_dir: Path, nodes, tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setattr(embeddings, "embedder_from_env", HashEmbedder)
    out = tmp_path / "vectors.lance"
    args = ["embed", "--content", str(content_dir), "--out", str(out)]

    first = runner.invoke(app, args)
    second = runner.invoke(app, args)

    assert first.exit_code == 0, first.output
    assert "Wrote" in first.output and "4 chunks" in first.output
    assert "Up to date" in second.output


def test_cli_embed_unknown_provider(content_dir: Path, nodes, monkeypatch) -> None:
    monkeypatch.setenv("EMBEDDINGS_PROVIDER", "openai")

    result = runner.invoke(app, ["embed", "--content", str(content_dir)])

    assert result.exit_code == 1
    assert "expected one of local, bedrock" in result.output


class FakeBedrock:
    def __init__(self, dimensions: int = 512) -> None:
        self.requests: list[dict] = []
        self.dimensions = dimensions

    def invoke_model(self, **request):
        self.requests.append(request)
        body = json.dumps({"embedding": [0.1] * self.dimensions, "inputTextTokenCount": 3})
        return {"body": io.BytesIO(body.encode())}


def test_bedrock_titan_request_and_parsing() -> None:
    client = FakeBedrock()
    embedder = BedrockEmbedder(client=client)

    vectors = embedder.embed_documents(["first", "second"])
    query = embedder.embed_query("where are passwords")

    assert len(vectors) == 2 and len(vectors[0]) == 512 and len(query) == 512
    request = client.requests[0]
    assert request["modelId"] == "amazon.titan-embed-text-v2:0"
    assert json.loads(request["body"]) == {
        "inputText": "first",
        "dimensions": 512,
        "normalize": True,
    }
    assert identity(embedder)["provider"] == "bedrock"


def test_bedrock_rejects_wrong_dimensions() -> None:
    with pytest.raises(ValueError, match="dimensions"):
        BedrockEmbedder(client=FakeBedrock(dimensions=256)).embed_query("x")


def test_embedder_from_env_selects_bedrock(monkeypatch) -> None:
    monkeypatch.setenv("EMBEDDINGS_PROVIDER", "Bedrock")
    monkeypatch.setattr(embeddings, "BedrockEmbedder", lambda: "bedrock-embedder")

    assert embedder_from_env() == "bedrock-embedder"


def test_onnx_digest_and_pin(tmp_path: Path) -> None:
    from types import SimpleNamespace

    from brain.embeddings import ModelIntegrityError, onnx_digest, verify_onnx

    (tmp_path / "model.onnx").write_bytes(b"onnx bytes")
    engine = SimpleNamespace(
        model=SimpleNamespace(
            _model_dir=tmp_path, model_description=SimpleNamespace(model_file="model.onnx")
        )
    )

    digest = onnx_digest(engine)

    assert digest == hashlib.sha256(b"onnx bytes").hexdigest()
    verify_onnx("m", digest, {"m": digest})
    verify_onnx("unpinned", "anything", {})
    with pytest.raises(ModelIntegrityError, match="does not match"):
        verify_onnx("m", "0" * 64, {"m": digest})
    with pytest.raises(RuntimeError, match="cannot locate"):
        onnx_digest(SimpleNamespace())
