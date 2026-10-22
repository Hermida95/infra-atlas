"""ASGI middleware: request context, security headers, body size and rate limits.

Pure ASGI classes (no BaseHTTPMiddleware): they wrap `receive`/`send` directly, which is
cheaper and keeps streaming intact. Order, outermost first, is set in `api.main.create_app`:

    RequestContext -> CORS -> RateLimit -> BodySizeLimit -> routes
"""

from __future__ import annotations

import json
import logging
import re
import time
import uuid
from collections import OrderedDict
from collections.abc import Awaitable, Callable, Iterable
from typing import Any

from api.observability import LATENCY, REJECTED, REQUESTS, request_id

Scope = dict[str, Any]
Message = dict[str, Any]
Receive = Callable[[], Awaitable[Message]]
Send = Callable[[Message], Awaitable[None]]
ASGIApp = Callable[[Scope, Receive, Send], Awaitable[None]]

access_log = logging.getLogger("api.access")
log = logging.getLogger("api")

_REQUEST_ID = re.compile(r"^[A-Za-z0-9._-]{1,64}$")
DOCS_PATHS = ("/docs", "/redoc", "/openapi.json")

SECURITY_HEADERS = [
    (b"x-content-type-options", b"nosniff"),
    (b"x-frame-options", b"DENY"),
    (b"referrer-policy", b"no-referrer"),
    (b"permissions-policy", b"camera=(), microphone=(), geolocation=()"),
    (b"cross-origin-opener-policy", b"same-origin"),
]
# A JSON API never renders HTML, so nothing may load. /docs serves Swagger UI from a CDN and
# is left without this header; it can be switched off entirely with API_DOCS=0.
API_CSP = (b"content-security-policy", b"default-src 'none'; frame-ancestors 'none'")


async def send_json(send: Send, status: int, body: dict[str, Any], headers: Iterable = ()) -> None:
    payload = json.dumps(body).encode()
    await send(
        {
            "type": "http.response.start",
            "status": status,
            "headers": [
                (b"content-type", b"application/json"),
                (b"content-length", str(len(payload)).encode()),
                *headers,
            ],
        }
    )
    await send({"type": "http.response.body", "body": payload})


class RequestContextMiddleware:
    """Request id, security headers, one structured access log line and metrics per request.

    The query string is not logged: search queries are user input and may be personal.
    """

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        incoming = dict(scope["headers"]).get(b"x-request-id", b"").decode("latin-1")
        rid = incoming if _REQUEST_ID.match(incoming) else uuid.uuid4().hex
        token = request_id.set(rid)
        status = 500
        started = time.perf_counter()
        is_docs = scope["path"].startswith(DOCS_PATHS)

        started = False

        async def send_with_headers(message: Message) -> None:
            nonlocal status, started
            if message["type"] == "http.response.start":
                started = True
                status = message["status"]
                headers = [*message.get("headers", []), (b"x-request-id", rid.encode())]
                headers += SECURITY_HEADERS if is_docs else [*SECURITY_HEADERS, API_CSP]
                message = {**message, "headers": headers}
            await send(message)

        try:
            try:
                await self.app(scope, receive, send_with_headers)
            except Exception:
                # Answered here, inside the headers wrapper, so the 500 carries x-request-id
                # and the security headers; the body says nothing about the cause (it is logged).
                log.exception("unhandled error")
                if not started:
                    await send_json(send_with_headers, 500, {"detail": "internal error"})
                else:
                    raise
        finally:
            elapsed = time.perf_counter() - started
            route = getattr(scope.get("route"), "path", "unmatched")
            REQUESTS.labels(scope["method"], route, str(status)).inc()
            LATENCY.labels(scope["method"], route).observe(elapsed)
            access_log.info(
                "request",
                extra={
                    "method": scope["method"],
                    "path": scope["path"],
                    "route": route,
                    "status": status,
                    "duration_ms": round(elapsed * 1000, 1),
                    "client": (scope.get("client") or ("-",))[0],
                },
            )
            request_id.reset(token)


class BodySizeLimitMiddleware:
    """Refuse bodies over `max_bytes` with 413, whether or not Content-Length is sent.

    The limit is small (16 KiB by default), so the body is read up front and replayed.
    """

    def __init__(self, app: ASGIApp, max_bytes: int) -> None:
        self.app = app
        self.max_bytes = max_bytes

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http" or scope["method"] not in {"POST", "PUT", "PATCH"}:
            await self.app(scope, receive, send)
            return

        declared = dict(scope["headers"]).get(b"content-length")
        if declared is not None and declared.isdigit() and int(declared) > self.max_bytes:
            await self._reject(send)
            return

        chunks, size, more = [], 0, True
        while more:
            message = await receive()
            if message["type"] == "http.disconnect":
                return
            chunk = message.get("body", b"")
            size += len(chunk)
            if size > self.max_bytes:
                await self._reject(send)
                return
            chunks.append(chunk)
            more = message.get("more_body", False)

        replayed = False

        async def replay() -> Message:
            nonlocal replayed
            if replayed:
                return await receive()
            replayed = True
            return {"type": "http.request", "body": b"".join(chunks), "more_body": False}

        await self.app(scope, replay, send)

    async def _reject(self, send: Send) -> None:
        REJECTED.labels("body_too_large").inc()
        await send_json(send, 413, {"detail": f"request body over {self.max_bytes} bytes"})


class RateLimitMiddleware:
    """Fixed one-minute window per client IP on the costly paths.

    Per process, in memory: with N replicas a client gets up to N times the limit. That is
    a backstop for the app; the real limit belongs at the edge (API Gateway throttling,
    Ingress annotations, WAF rate-based rules), which sees every replica's traffic.
    Behind a proxy, uvicorn's --proxy-headers makes scope["client"] the real client IP.
    """

    MAX_TRACKED = 10_000

    def __init__(
        self,
        app: ASGIApp,
        per_minute: int,
        paths: Iterable[str] = ("/search", "/plan"),
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self.app = app
        self.per_minute = per_minute
        self.paths = tuple(paths)
        self.clock = clock
        # client -> (window, count), least recently seen first
        self.windows: OrderedDict[str, tuple[int, int]] = OrderedDict()

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        limited = (
            self.per_minute > 0
            and scope["type"] == "http"
            and scope["method"] in {"GET", "POST"}
            and scope["path"].startswith(self.paths)
        )
        if not limited:
            await self.app(scope, receive, send)
            return

        now = self.clock()
        window = int(now // 60)
        client = (scope.get("client") or ("unknown",))[0]
        start, count = self.windows.get(client, (window, 0))
        count = count + 1 if start == window else 1
        self.windows[client] = (window, count)
        self.windows.move_to_end(client)
        while len(self.windows) > self.MAX_TRACKED:
            self.windows.popitem(last=False)

        if count > self.per_minute:
            REJECTED.labels("rate_limited").inc()
            retry_after = str(max(1, int(60 - now % 60))).encode()
            await send_json(
                send, 429, {"detail": "rate limit exceeded"}, [(b"retry-after", retry_after)]
            )
            return
        await self.app(scope, receive, send)
