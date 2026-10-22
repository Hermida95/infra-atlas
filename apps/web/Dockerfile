# syntax=docker/dockerfile:1
# Build context: repo root.  docker build -f apps/web/Dockerfile --target dev -t infra-atlas-web .
#
# This image exists for `compose.yaml` only. The web app is *not* shipped as a container in
# production: decision 2 deploys it with OpenNext as a Lambda plus S3 and CloudFront, so this
# is the local half of "the journey really starts at localhost", not a deployment artifact.
# That is also why there is no runtime target here, only `dev`.

# Pinned by digest, like apps/api/Dockerfile: a tag can be re-pointed, a digest cannot.
# Dependabot (.github/dependabot.yml) proposes the new digest when the tag moves.
ARG NODE_IMAGE=node:24.11-slim@sha256:48abc13a19400ca3985071e287bd405a1d99306770eb81d61202fb6b65cf0b57

FROM ${NODE_IMAGE} AS dev
# PNPM_HOME under the home directory, not /pnpm: the install below runs as a non-root user and
# has to be able to write it.
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
    PNPM_HOME=/home/node/.pnpm \
    PATH=/home/node/.pnpm:$PATH \
    NEXT_TELEMETRY_DISABLED=1
RUN corepack enable
WORKDIR /app

# Created and owned here so that the named volumes compose mounts on top of them are seeded
# with this ownership: a volume Docker has to create itself is owned by root, and then the
# dev server cannot write its own cache.
RUN mkdir -p /app/node_modules /app/apps/web/node_modules /app/apps/web/.next \
    && chown -R node:node /app

# `node` is uid 1000, the image's own unprivileged user. Everything after this runs as it,
# including the dev server: a container that writes into a bind mount of your working tree
# has no business being root.
USER node

# Manifests and the lockfile first: this layer is reused until a dependency changes.
COPY --chown=node:node package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY --chown=node:node apps/web/package.json apps/web/package.json
RUN pnpm install --frozen-lockfile

EXPOSE 3000
# --hostname 0.0.0.0, or the server would only answer inside the container's own loopback.
CMD ["pnpm", "--filter", "web", "dev", "--hostname", "0.0.0.0"]
