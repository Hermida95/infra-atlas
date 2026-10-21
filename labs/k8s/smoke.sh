#!/usr/bin/env bash
# Smoke test for the API release: port-forward to the Service and check /health, /ready,
# /graph and a semantic search (the endpoint that needs the model, the index and the memory).
#   labs/k8s/smoke.sh [service] [namespace]
set -euo pipefail

SERVICE="${1:-atlas-api}"
NAMESPACE="${2:-default}"
LOCAL_PORT="${LOCAL_PORT:-18000}"
BASE="http://127.0.0.1:${LOCAL_PORT}"

kubectl --namespace "$NAMESPACE" port-forward "svc/$SERVICE" "$LOCAL_PORT:8000" >/tmp/port-forward.log 2>&1 &
PF_PID=$!
trap 'kill "$PF_PID" 2>/dev/null || true' EXIT

for _ in $(seq 1 30); do
  curl -fsS "$BASE/health" >/dev/null 2>&1 && break
  sleep 1
done

health="$(curl -fsS "$BASE/health")"
echo "/health -> $health"
grep -q '"ok"' <<<"$health" || { echo "FAIL: /health did not report ok"; exit 1; }

graph="$(curl -fsS "$BASE/graph")"
echo "/graph -> ${graph:0:120}..."
python3 -c 'import json, sys; g = json.load(sys.stdin); assert g["nodes"], "no nodes"; print(len(g["nodes"]), "nodes")' <<<"$graph" \
  || { echo "FAIL: /graph is not JSON with nodes"; exit 1; }

ready="$(curl -fsS "$BASE/ready")"
echo "/ready -> $ready"

search="$(curl -fsS --get "$BASE/search" --data-urlencode "q=where do I keep database passwords" --data-urlencode k=3)"
echo "/search -> ${search:0:160}..."
python3 -c 'import json, sys; r = json.load(sys.stdin); top = r["hits"][0]["id"]; print("top hit:", top); assert top == "ssm", top' <<<"$search" \
  || { echo "FAIL: /search did not return ssm first"; exit 1; }

echo "Smoke test passed"
