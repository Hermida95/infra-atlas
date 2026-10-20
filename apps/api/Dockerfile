# syntax=docker/dockerfile:1
# Build context: repo root.  docker build -f apps/api/Dockerfile -t infra-atlas-api .
# Requires apps/web/src/data/graph.json (run `uv run brain graph` first).

ARG PYTHON_IMAGE=python:3.12-slim

FROM ${PYTHON_IMAGE} AS builder
COPY --from=ghcr.io/astral-sh/uv:0.13 /uv /uvx /bin/
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
COPY packages/brain/pyproject.toml packages/brain/pyproject.toml
COPY apps/api apps/api
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --frozen --no-dev --package api --no-editable

FROM ${PYTHON_IMAGE}
RUN groupadd --system app && useradd --system --gid app --no-create-home app
WORKDIR /app
COPY --from=builder --chown=app:app /app/.venv /app/.venv
COPY --chown=app:app apps/web/src/data/graph.json /app/graph.json
ENV PATH="/app/.venv/bin:$PATH" \
    GRAPH_PATH=/app/graph.json \
    PYTHONUNBUFFERED=1
USER app
EXPOSE 8000
CMD ["uvicorn", "api.main:app", "--host", "0.0.0.0", "--port", "8000"]
