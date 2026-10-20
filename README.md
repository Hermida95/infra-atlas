# Infra Atlas

A 3D, explorable map of DevOps, cloud and AI: the journey of an app from `localhost` to production on AWS.

Every technology is a node in a holographic knowledge graph. Open one and it comes apart into the pieces it is made of; some include a lab where you build, run and break things yourself. The project deploys itself along the same journey it teaches.

> Status: phase 1. The 3D map, the content-driven deployment planner, per-technology teardowns and the Docker lab run in the Next.js app. `prototypes/brain` keeps the original HTML prototype for reference.

## Layout

```
apps/web          Next.js 16 + React Three Fiber: the 3D map
apps/api          FastAPI, packaged as one Docker image for Compose, Kubernetes and Lambda
packages/brain    Python CLI: validates /content and builds the graph (3D layout included)
content/          The knowledge base: one MDX file per concept, typed frontmatter
infra/            Terraform modules and environments, Helm chart (upcoming)
prototypes/brain  Standalone HTML prototype of the full experience
docs/             Architecture decisions and design direction (Spanish)
```

## Run it

Requirements: Node 24 with corepack, [uv](https://docs.astral.sh/uv/), Docker for `make up`.

```bash
make install   # Python and Node dependencies
make dev       # validate content, build the graph, open http://localhost:3000
make api       # API on http://localhost:8000
make up        # the API in Docker
make help      # everything else
```

## Plan a deployment from the terminal

```bash
uv run brain plan --text "FastAPI with Postgres, user login and image uploads on a small budget"
```

The same rules power the planner in the browser: each concept declares in its frontmatter when it belongs in a route, as a boolean expression over requirements (`not k8s and cheap and not scale`).

## Add a concept

```bash
uv run brain new my-concept --domain containers --title "My concept"
uv run brain validate
```

CI refuses a concept with broken relations, unknown fields or a mismatched folder.

## Decisions

- [docs/DECISIONES.md](docs/DECISIONES.md): stack, hosting, costs and trade-offs
- [docs/DISENO.md](docs/DISENO.md): visual direction, tokens and interaction patterns

Logos come from [Simple Icons](https://simpleicons.org) (CC0) and the official [AWS Architecture Icons](https://aws.amazon.com/architecture/icons/) (see `apps/web/public/icons/aws/NOTICE.md`). They are used only to identify each technology. All trademarks belong to their owners.
