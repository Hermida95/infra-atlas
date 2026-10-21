import json
import logging
from collections.abc import Iterator
from pathlib import Path

import pytest
from api_fakes import HashEmbedder
from fastapi.testclient import TestClient

from api import main, semantic
from api.main import _load_graph_bytes, create_app, embedder
from api.middleware import RateLimitMiddleware
from api.observability import JsonFormatter, request_id
from api.settings import Settings
from brain.chunks import chunk_nodes
from brain.loader import find_repo_root, load_content
from brain.vectors import build_index

CONTENT = find_repo_root(Path(__file__)) / "content"
GRAPH = {"version": 1, "domains": [], "requirements": [], "nodes": [], "links": []}


@pytest.fixture(autouse=True)
def clean_caches() -> Iterator[None]:
    _load_graph_bytes.cache_clear()
    semantic.clear_caches()
    yield
    _load_graph_bytes.cache_clear()
    semantic.clear_caches()


@pytest.fixture
def graph_file(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    path = tmp_path / "graph.json"
    path.write_text(json.dumps(GRAPH))
    monkeypatch.setenv("GRAPH_PATH", str(path))
    return path


@pytest.fixture(scope="module")
def index_path(tmp_path_factory: pytest.TempPathFactory) -> Path:
    path = tmp_path_factory.mktemp("index") / "vectors.lance"
    build_index(chunk_nodes(load_content(CONTENT).nodes), HashEmbedder(), path)
    return path


def client(**settings) -> TestClient:
    defaults = {"warmup": False, "rate_limit_per_minute": 0, "log_format": "text"}
    app = create_app(Settings(**{**defaults, **settings}))
    app.dependency_overrides[embedder] = HashEmbedder
    return TestClient(app)


# --- Security headers and request id ----------------------------------------------------


def test_security_headers_on_api_responses(graph_file: Path) -> None:
    response = client().get("/graph")

    assert response.headers["x-content-type-options"] == "nosniff"
    assert response.headers["x-frame-options"] == "DENY"
    assert response.headers["referrer-policy"] == "no-referrer"
    assert (
        response.headers["content-security-policy"] == "default-src 'none'; frame-ancestors 'none'"
    )


def test_docs_keep_headers_but_not_the_strict_csp() -> None:
    response = client().get("/docs")

    assert response.status_code == 200
    assert response.headers["x-content-type-options"] == "nosniff"
    assert "content-security-policy" not in response.headers


def test_docs_can_be_disabled() -> None:
    api = client(docs_enabled=False)

    assert api.get("/docs").status_code == 404
    assert api.get("/openapi.json").status_code == 404


def test_request_id_is_echoed_or_generated() -> None:
    api = client()

    assert (
        api.get("/health", headers={"x-request-id": "abc-123"}).headers["x-request-id"] == "abc-123"
    )
    generated = api.get("/health").headers["x-request-id"]
    assert len(generated) == 32
    # Header injection or absurd values are replaced, not echoed.
    assert (
        api.get("/health", headers={"x-request-id": "a" * 200}).headers["x-request-id"] != "a" * 200
    )


def test_json_log_line_carries_request_id() -> None:
    record = logging.makeLogRecord({"name": "api.access", "msg": "request", "levelname": "INFO"})
    record.status = 200
    token = request_id.set("rid-1")
    try:
        line = json.loads(JsonFormatter().format(record))
    finally:
        request_id.reset(token)

    assert line["request_id"] == "rid-1"
    assert line["message"] == "request" and line["status"] == 200


# --- CORS ----------------------------------------------------------------------------


def test_cors_origins_come_from_settings() -> None:
    api = client(cors_origins=["https://atlas.example"])
    preflight = {"Access-Control-Request-Method": "POST"}

    allowed = api.options("/plan", headers={"Origin": "https://atlas.example", **preflight})
    denied = api.options("/plan", headers={"Origin": "https://evil.example", **preflight})

    assert allowed.headers["access-control-allow-origin"] == "https://atlas.example"
    assert "access-control-allow-credentials" not in allowed.headers
    assert "access-control-allow-origin" not in denied.headers


def test_settings_from_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("CORS_ORIGINS", "https://a.example, https://b.example")
    monkeypatch.setenv("API_DOCS", "false")
    monkeypatch.setenv("RATE_LIMIT_PER_MINUTE", "5")

    settings = Settings.from_env()

    assert settings.cors_origins == ["https://a.example", "https://b.example"]
    assert settings.docs_enabled is False
    assert settings.rate_limit_per_minute == 5


# --- Input limits ------------------------------------------------------------------------


def test_body_over_limit_is_413(graph_file: Path) -> None:
    api = client(max_body_bytes=100)

    response = api.post(
        "/plan",
        content=json.dumps({"text": "x" * 200}),
        headers={"content-type": "application/json"},
    )

    assert response.status_code == 413


def test_body_without_content_length_is_still_limited(graph_file: Path) -> None:
    api = client(max_body_bytes=100)

    def chunks():
        yield b'{"text": "'
        yield b"x" * 200
        yield b'"}'

    response = api.post("/plan", content=chunks(), headers={"content-type": "application/json"})

    assert response.status_code == 413


def test_body_under_limit_reaches_the_route(graph_file: Path) -> None:
    response = client(max_body_bytes=1024).post("/plan", json={"requirements": []})

    assert response.status_code == 200


def test_plan_caps_requirements(graph_file: Path) -> None:
    api = client()

    assert api.post("/plan", json={"requirements": ["x"] * 21}).status_code == 422
    assert api.post("/plan", json={"requirements": ["x" * 33]}).status_code == 422


# --- Rate limit --------------------------------------------------------------------------


def test_rate_limit_returns_429_with_retry_after(graph_file: Path) -> None:
    api = client(rate_limit_per_minute=2)

    codes = [api.post("/plan", json={}).status_code for _ in range(3)]

    assert codes == [200, 200, 429]
    assert api.get("/health").status_code == 200  # cheap endpoints are not limited


def test_rate_limit_window_resets() -> None:
    now = [0.0]

    async def ok(scope, receive, send) -> None:
        await send({"type": "http.response.start", "status": 200, "headers": []})
        await send({"type": "http.response.body", "body": b""})

    limiter = RateLimitMiddleware(ok, per_minute=1, clock=lambda: now[0])
    sent = []

    async def send(message) -> None:
        sent.append(message)

    async def run() -> int:
        scope = {"type": "http", "method": "GET", "path": "/search", "client": ("1.2.3.4", 1)}
        await limiter(scope, None, send)
        return [m for m in sent if m["type"] == "http.response.start"][-1]["status"]

    import anyio

    assert anyio.run(run) == 200
    assert anyio.run(run) == 429
    now[0] = 61.0
    assert anyio.run(run) == 200


async def _ok(scope, receive, send) -> None:
    await send({"type": "http.response.start", "status": 200, "headers": []})
    await send({"type": "http.response.body", "body": b""})


def _status_of(app, client_ip: str, headers=()) -> int:
    sent = []

    async def send(message) -> None:
        sent.append(message)

    async def run() -> None:
        scope = {
            "type": "http",
            "method": "GET",
            "path": "/search",
            "client": (client_ip, 1),
            "headers": list(headers),
        }
        await app(scope, None, send)

    import anyio

    anyio.run(run)
    return [m for m in sent if m["type"] == "http.response.start"][-1]["status"]


def test_rate_limit_keeps_a_bucket_per_client_ip() -> None:
    limiter = RateLimitMiddleware(_ok, per_minute=1, clock=lambda: 0.0)

    assert _status_of(limiter, "1.1.1.1") == 200
    assert _status_of(limiter, "1.1.1.1") == 429
    assert _status_of(limiter, "2.2.2.2") == 200  # another IP is not affected


def test_rate_limit_sees_the_real_client_behind_a_trusted_proxy() -> None:
    from uvicorn.middleware.proxy_headers import ProxyHeadersMiddleware

    limiter = RateLimitMiddleware(_ok, per_minute=1, clock=lambda: 0.0)
    app = ProxyHeadersMiddleware(limiter, trusted_hosts="10.0.0.0/8")
    ingress = "10.1.2.3"

    def via_ingress(user_ip: str) -> int:
        return _status_of(app, ingress, [(b"x-forwarded-for", user_ip.encode())])

    assert via_ingress("203.0.113.1") == 200
    assert via_ingress("203.0.113.1") == 429
    assert via_ingress("203.0.113.2") == 200  # a different user behind the same proxy


def test_rate_limit_shares_one_bucket_when_the_proxy_is_not_trusted() -> None:
    """The failure the chart refuses to render: default trust of 127.0.0.1 only."""
    from uvicorn.middleware.proxy_headers import ProxyHeadersMiddleware

    limiter = RateLimitMiddleware(_ok, per_minute=1, clock=lambda: 0.0)
    app = ProxyHeadersMiddleware(limiter, trusted_hosts="127.0.0.1")

    first = _status_of(app, "10.1.2.3", [(b"x-forwarded-for", b"203.0.113.1")])
    second = _status_of(app, "10.1.2.3", [(b"x-forwarded-for", b"203.0.113.2")])

    assert (first, second) == (200, 429)


# --- Readiness, warm-up and metrics ------------------------------------------------------


def test_ready_reports_each_dependency(
    graph_file: Path, index_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("VECTORS_PATH", str(index_path))

    response = client().get("/ready")

    assert response.status_code == 200
    assert response.json() == {
        "status": "ready",
        "checks": {"graph": "ok", "index": "ok", "model": "ok"},
    }


def test_not_ready_without_index_and_no_paths_leak(
    graph_file: Path, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("VECTORS_PATH", str(tmp_path / "missing.lance"))

    response = client().get("/ready")

    assert response.status_code == 503
    assert response.json()["checks"] == {
        "graph": "ok",
        "index": "unavailable",
        "model": "unavailable",
    }
    assert str(tmp_path) not in response.text


def test_not_ready_with_another_model(graph_file: Path, index_path: Path, monkeypatch) -> None:
    class Other(HashEmbedder):
        model = "other"

    monkeypatch.setenv("VECTORS_PATH", str(index_path))
    api = client()
    api.app.dependency_overrides[embedder] = Other

    assert api.get("/ready").json()["checks"]["model"] == "mismatch"


def test_warm_up_loads_everything_at_startup(
    graph_file: Path, index_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("VECTORS_PATH", str(index_path))
    loaded = []

    def fake_embedder() -> HashEmbedder:
        loaded.append(True)
        return HashEmbedder()

    monkeypatch.setattr(main, "get_embedder", fake_embedder)
    app = create_app(Settings(warmup=True, rate_limit_per_minute=0, log_format="text"))

    with TestClient(app):  # runs the lifespan
        assert loaded == [True]
    assert semantic._open_index.cache_info().currsize == 1


def test_warm_up_failure_does_not_crash(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("GRAPH_PATH", str(tmp_path / "missing.json"))
    monkeypatch.setenv("VECTORS_PATH", str(tmp_path / "missing.lance"))
    app = create_app(Settings(warmup=True, rate_limit_per_minute=0, log_format="text"))

    with TestClient(app) as api:
        assert api.get("/health").status_code == 200
        assert api.get("/ready").status_code == 503


def test_metrics_use_route_templates(graph_file: Path) -> None:
    api = client()
    api.get("/nodes/whatever")

    body = api.get("/metrics").text

    assert 'route="/nodes/{node_id}"' in body
    assert "/nodes/whatever" not in body
    assert "http_request_duration_seconds_bucket" in body
