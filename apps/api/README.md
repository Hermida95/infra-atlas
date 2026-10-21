# Infra Atlas API

FastAPI over `graph.json`, the graph `brain graph` builds from `/content`. Read-only: the file is loaded once and indexed in memory. The planner reuses `brain.planner`, so `POST /plan`, `brain plan` and the planner in the web app follow the same rules (checked against `content/planner-cases.yaml`).

```bash
make api                   # builds the index, then http://localhost:8000 (docs at /docs)
```

| Method | Path | What it returns |
| --- | --- | --- |
| GET | `/health` | `{"status": "ok"}`: liveness, the process answers. Checks nothing else |
| GET | `/ready` | 200 when graph, index and model are loaded and compatible, else 503 with which one is not (readiness probe) |
| GET | `/metrics` | Prometheus metrics: requests, latency and rejections by route template |
| GET | `/graph` | The whole `graph.json`, as stored |
| GET | `/domains` | Domains in map order, with `node_count` |
| GET | `/requirements` | What a user can ask the planner for, with the keywords it detects in free text |
| GET | `/nodes?domain=&type=&level=` | Node summaries, optionally filtered |
| GET | `/nodes/{id}` | One node: teardown parts, planner rule and related nodes. 404 if unknown |
| GET | `/search?q=&k=5` | Search by meaning: each concept's best matching chunk, closest first. 503 without an index (`make embed`) |
| GET | `/search/keyword?q=&limit=` | Nodes matching every word of `q`. Title and id rank above body text |
| POST | `/plan` | The deployment route for `{"requirements": [...], "text": "..."}`, grouped by stage, with notes. 422 on an unknown requirement |

```bash
curl -s --get localhost:8000/search --data-urlencode "q=where do I keep database passwords"
curl -s -X POST localhost:8000/plan -H 'content-type: application/json' \
  -d '{"text": "FastAPI with Postgres, user login and image uploads on a small budget"}'
```

`GRAPH_PATH` points at the graph file; without it the API looks for `apps/web/src/data/graph.json` in the repo. If the file is missing or invalid, every endpoint that needs it answers 503.

Semantic search reads the LanceDB index at `VECTORS_PATH` (default `apps/api/data/vectors.lance`, written by `brain embed`) and embeds queries with `EMBEDDINGS_PROVIDER` (`local`, the default, or `bedrock`). The index records the model that built it and the API refuses to query it with a different one. How it works and how it is evaluated: [docs/BUSQUEDA.md](../../docs/BUSQUEDA.md).

```bash
uv run python -m api.evaluation   # recall@k and MRR on content/search-eval.yaml, semantic vs keyword
```

## Configuration

Environment variables, read at startup (`api/settings.py`):

| Variable | Default | What |
| --- | --- | --- |
| `GRAPH_PATH` | repo's `apps/web/src/data/graph.json` | Graph file |
| `VECTORS_PATH` | `apps/api/data/vectors.lance` | LanceDB index written by `brain embed` |
| `EMBEDDINGS_PROVIDER` | `local` | `local` (fastembed) or `bedrock` (Titan v2) |
| `CORS_ORIGINS` | `http://localhost:3000` | Comma-separated origins allowed to call the API from a browser |
| `API_DOCS` | `true` | Serve `/docs`, `/redoc` and `/openapi.json` |
| `RATE_LIMIT_PER_MINUTE` | `60` | Per client IP on `/search` and `/plan`; `0` disables |
| `MAX_BODY_BYTES` | `16384` | Largest request body |
| `WARMUP` | `true` | Load graph, index and model at startup, before `/ready` passes |
| `LOG_FORMAT` / `LOG_LEVEL` | `json` / `INFO` | `text` for a terminal |
| `FORWARDED_ALLOW_IPS` | `127.0.0.1` | Proxies uvicorn trusts for `X-Forwarded-For` |

Responses carry `X-Request-ID` (echoed if the client sends a valid one) and security headers; every request logs one JSON line with that id. Security controls and why: [docs/SEGURIDAD.md](../../docs/SEGURIDAD.md).
