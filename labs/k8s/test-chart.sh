#!/usr/bin/env bash
# Render-time checks for infra/helm/api: what the chart must refuse and what it must emit.
# Needs only `helm`; no cluster. Run by .github/workflows/k8s-smoke.yml.
set -euo pipefail

chart="$(dirname "$0")/../../infra/helm/api"
fail=0

expect_fail() { # name, expected message fragment, helm args...
  local name=$1 fragment=$2; shift 2
  if out=$(helm template t "$chart" "$@" 2>&1); then
    echo "FAIL $name: the chart rendered, it should have been refused"; fail=1
  elif ! grep -q -- "$fragment" <<<"$out"; then
    echo "FAIL $name: refused, but without '$fragment':"; echo "$out"; fail=1
  else
    echo "ok   $name"
  fi
}

expect_render() { # name, regex that must match the output, helm args...
  local name=$1 pattern=$2; shift 2
  if out=$(helm template t "$chart" "$@" 2>&1) && grep -Eq -- "$pattern" <<<"$out"; then
    echo "ok   $name"
  else
    echo "FAIL $name: no match for /$pattern/"; echo "$out"; fail=1
  fi
}

expect_no_match() { # name, regex that must NOT match the output, helm args...
  local name=$1 pattern=$2; shift 2
  if out=$(helm template t "$chart" "$@" 2>&1) && ! grep -Eq -- "$pattern" <<<"$out"; then
    echo "ok   $name"
  else
    echo "FAIL $name: unexpected match for /$pattern/ (or render failed)"; fail=1
  fi
}

# A1: behind an Ingress uvicorn must trust the controller, or all users share one bucket.
expect_fail   "ingress with the default forwardedAllowIps" "forwardedAllowIps" --set ingress.enabled=true
expect_render "ingress with a trusted CIDR" 'value: "10.0.0.0/8"' \
  --set ingress.enabled=true --set config.forwardedAllowIps=10.0.0.0/8
expect_render "no ingress keeps the default" 'value: "127.0.0.1"'

exit $fail
