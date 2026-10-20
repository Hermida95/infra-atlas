# Infra Atlas API

FastAPI over `graph.json`, the graph `brain graph` builds from `/content`. Read-only: the file is loaded once and indexed in memory. The planner reuses `brain.planner`, so `POST /plan`, `brain plan` and the planner in the web app follow the same rules (checked against `content/planner-cases.yaml`).

```bash
make api                   # http://localhost:8000, interactive docs at /docs
```

| Method | Path | What it returns |
| --- | --- | --- |
| GET | `/health` | `{"status": "ok"}` (liveness and readiness probes) |
| GET | `/graph` | The whole `graph.json`, as stored |
| GET | `/domains` | Domains in map order, with `node_count` |
| GET | `/requirements` | What a user can ask the planner for, with the keywords it detects in free text |
| GET | `/nodes?domain=&type=&level=` | Node summaries, optionally filtered |
| GET | `/nodes/{id}` | One node: teardown parts, planner rule and related nodes. 404 if unknown |
| GET | `/search?q=&limit=` | Nodes matching every word of `q`. Title and id rank above body text |
| POST | `/plan` | The deployment route for `{"requirements": [...], "text": "..."}`, grouped by stage, with notes. 422 on an unknown requirement |

```bash
curl -s localhost:8000/search?q=kube
curl -s -X POST localhost:8000/plan -H 'content-type: application/json' \
  -d '{"text": "FastAPI with Postgres, user login and image uploads on a small budget"}'
```

`GRAPH_PATH` points at the graph file; without it the API looks for `apps/web/src/data/graph.json` in the repo. If the file is missing or invalid, every endpoint that needs it answers 503.
