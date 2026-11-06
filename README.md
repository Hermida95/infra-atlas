# Infra Atlas

A 3D, explorable map of DevOps, cloud and AI: the journey of an app from `localhost` to production on AWS.

Every technology is a node in a holographic knowledge graph. Open one and it comes apart into the pieces it is made of; some include a lab where you build, run and break things yourself. The project deploys itself along the same journey it teaches.

Some nodes have a brain of their own behind them. [`/aws`](apps/web/src/app/aws/page.tsx) is the same hologram over a map of the 156 services the Solutions Architect exams cover, and from its `eks` node you descend again into [`/k8s`](apps/web/src/app/k8s/page.tsx): 133 objects read from the Pod out to the cluster, for CKAD, CKA and CKS. Each world explains every connection in a sentence and carries real cases that light up the objects which could solve them.

> Status: phase 1. The 3D map, the content-driven deployment planner, per-technology teardowns, the AWS and Kubernetes atlases and the Docker lab run in the Next.js app. `prototypes/brain` keeps the original HTML prototype for reference.

## Layout

```
apps/web          Next.js 16 + React Three Fiber: the 3D map
apps/api          FastAPI, packaged as one Docker image for Compose, Kubernetes and Lambda
packages/brain    Python CLI: validates /content and builds the graph (3D layout included)
content/          The knowledge base: one MDX file per concept, typed frontmatter
content/aws/      The AWS atlas: a world of its own, with its categories, exams and real cases
content/k8s/      The Kubernetes atlas: the third world, from the Pod out to the cluster
infra/            Terraform modules and environments, Helm chart (upcoming)
prototypes/brain  Standalone HTML prototype of the full experience
docs/             Architecture decisions and design direction (Spanish)
```

## Run it

Requirements: Node 24 with corepack, [uv](https://docs.astral.sh/uv/), Docker for `make up`.

```bash
make install   # Python and Node dependencies
make dev       # validate content, build the graph, open http://localhost:3000
make api       # API on http://localhost:8000 (semantic search for ⌘K: cp apps/web/.env.example apps/web/.env.local)
make up        # the API in Docker
make help      # everything else
```

## The worlds inside

```bash
uv run brain validate --content content/aws
uv run brain graph --content content/aws --out apps/web/src/data/aws.json
uv run brain validate --content content/k8s
uv run brain graph --content content/k8s --out apps/web/src/data/k8s.json
```

`make content` builds all three. A world is one content directory through the same pipeline, and
it describes itself in its own `world.yaml`: an id (which is also its route, so `content/k8s`
becomes `/k8s`), a name, and the certification vocabulary its nodes may be tagged with --
`saa` and `sap` inside AWS, `ckad`, `cka` and `cks` inside Kubernetes. `brain validate` rejects
an `exam` tag the world does not declare, and the web builds its filter chips from that list, so
no exam name is hard-coded in the renderer (decision 14).

On the web side, a world is a descriptor in [`apps/web/src/lib/atlas.ts`](apps/web/src/lib/atlas.ts):
route, graph, cases, exams and the words that differ. `/aws` and `/k8s` are nine-line route files
over the same components, so a fourth world is a content directory and a descriptor rather than a
copy of the renderer.

A world too dense to read whole opens on an overview instead: a few nodes per area and the
links between them, with each node showing how many connections it is not drawing (`EC2 +8`).
Open one and the map becomes that node and everything it touches -- its own brain -- and "Take
it apart" still opens its internals. Nothing is removed: every link stays in `graph.json`,
everything is one click from the first screen, and "Show everything" turns the filter off
(decision 15). The journey map is under the density threshold, so it is drawn whole.

A case is a real situation with two to four ways to solve it. Picking the case lights every
object it touches; picking an option narrows that to its own, painted by its verdict, so
comparing two approaches is a diff you can see. `brain validate` refuses a case that does not
commit to exactly one best option, an `avoid` that does not say what goes wrong, and an option
that lights an object the case never named.

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
