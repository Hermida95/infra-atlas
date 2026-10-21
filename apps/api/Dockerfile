# syntax=docker/dockerfile:1
# Build context: repo root.  docker build -f apps/api/Dockerfile -t infra-atlas-api .
# Requires apps/web/src/data/graph.json and apps/api/data (run `make embed` first): the image
# ships the graph, the vector index and the embedding model, so it never downloads at runtime.

# Every base image is pinned by digest: a tag can be re-pointed, a digest cannot. Dependabot
# (.github/dependabot.yml) proposes the new digest when the tag moves.
ARG PYTHON_IMAGE=python:3.12-slim@sha256:2259debdc6af85626058a15a7bf44ad6a68b8c98c9ae82a02cf5cdb92f096d47
ARG UV_IMAGE=ghcr.io/astral-sh/uv:0.13.4@sha256:9f130421e930bfbdc563c00740466603f8723158e90297d07957c2294640262b
# AWS Lambda Web Adapter, only in the `lambda` target (docker build --target lambda): the
# default image, the one Kubernetes runs, carries nothing it does not use. ECR Public also
# rate-limits anonymous pulls, so CI builds never depend on it.
ARG LAMBDA_ADAPTER_IMAGE=public.ecr.aws/awsguru/aws-lambda-adapter:1.1.0@sha256:17cfd08eff1dfea3f6a9a1e9c65fdac80aa4919b6085e746615530f43f57d2f1

FROM ${UV_IMAGE} AS uv

FROM ${PYTHON_IMAGE} AS builder
COPY --from=uv /uv /uvx /bin/
ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PYTHON_DOWNLOADS=0
WORKDIR /app

# Dependencies first: this layer is reused until uv.lock or a pyproject changes.
RUN --mount=type=cache,target=/root/.cache/uv \
    --mount=type=bind,source=uv.lock,target=uv.lock \
    --mount=type=bind,source=pyproject.toml,target=pyproject.toml \
    --mount=type=bind,source=apps/api/pyproject.toml,target=apps/api/pyproject.toml \
    --mount=type=bind,source=packages/brain/pyproject.toml,target=packages/brain/pyproject.toml \
    uv sync --frozen --no-dev --package api --no-install-workspace

COPY pyproject.toml uv.lock ./
# The API reuses brain's planner, so the package ships in the image (not the content).
COPY packages/brain/pyproject.toml packages/brain/pyproject.toml
COPY packages/brain/src packages/brain/src
COPY apps/api apps/api
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --frozen --no-dev --package api --no-editable

FROM ${PYTHON_IMAGE} AS runtime
ARG REVISION=unknown
LABEL org.opencontainers.image.title="infra-atlas-api" \
      org.opencontainers.image.description="Infra Atlas API: graph, planner and semantic search" \
      org.opencontainers.image.source="https://github.com/Hermida95/infra-atlas" \
      org.opencontainers.image.revision="${REVISION}"
# Fixed numeric UID/GID: Kubernetes can only enforce runAsNonRoot on a numeric USER.
RUN groupadd --system --gid 10001 app \
    && useradd --system --uid 10001 --gid app --no-create-home app
WORKDIR /app
# Files stay owned by root and only readable by the app user: even with a writable
# filesystem, the process could not modify its own code, model or index.
COPY --from=builder /app/.venv /app/.venv
COPY apps/web/src/data/graph.json /app/graph.json
COPY apps/api/data/models /app/data/models
COPY apps/api/data/vectors.lance /app/data/vectors.lance
ENV PATH="/app/.venv/bin:$PATH" \
    GRAPH_PATH=/app/graph.json \
    VECTORS_PATH=/app/data/vectors.lance \
    EMBEDDINGS_PROVIDER=local \
    FASTEMBED_CACHE_PATH=/app/data/models \
    HF_HUB_OFFLINE=1 \
    LOG_FORMAT=json \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1
USER 10001:10001
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=3s --start-period=30s --retries=3 \
    CMD ["python", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/health', timeout=2)"]
# --proxy-headers trusts X-Forwarded-For only from FORWARDED_ALLOW_IPS (127.0.0.1 unless the
# deployment sets it to its proxy), so rate limiting and logs see the real client.
CMD ["uvicorn", "api.main:app", "--host", "0.0.0.0", "--port", "8000", \
     "--proxy-headers", "--no-server-header", "--no-access-log", "--timeout-graceful-shutdown", "20"]

# Lambda: the same image plus the adapter extension, which starts uvicorn, waits for /ready
# and translates Lambda events to HTTP.
FROM ${LAMBDA_ADAPTER_IMAGE} AS lambda-adapter
FROM runtime AS lambda
COPY --from=lambda-adapter /lambda-adapter /opt/extensions/lambda-adapter
ENV AWS_LWA_PORT=8000 \
    AWS_LWA_READINESS_CHECK_PATH=/ready

# Default target: the plain runtime (Compose, Kubernetes, CI).
FROM runtime
