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
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
    PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    NEXT_TELEMETRY_DISABLED=1
RUN corepack enable
WORKDIR /app

# Manifests and the lockfile first: this layer is reused until a dependency changes.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/package.json
RUN --mount=type=cache,target=/pnpm/store \
    pnpm install --frozen-lockfile

# Runs as root, unlike the API image, and on purpose: compose bind-mounts the working tree
# over /app and the dev server writes generated files back into it (apps/web/src/data/logos.json
# from the `predev` script, and the Next.js cache). Matching the host's uid from inside a
# container is not portable, and nothing here is deployed.
EXPOSE 3000
# --hostname 0.0.0.0, or the server would only answer inside the container's own loopback.
CMD ["pnpm", "--filter", "web", "dev", "--hostname", "0.0.0.0"]
