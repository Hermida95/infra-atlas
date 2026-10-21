PNPM := COREPACK_ENABLE_DOWNLOAD_PROMPT=0 corepack pnpm

.PHONY: help install content embed dev api test lint typecheck build up down

help: ## Show available targets
	@grep -E '^[a-z0-9-]+:.*## ' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*## "}; {printf "  %-10s %s\n", $$1, $$2}'

install: ## Install Python and Node dependencies
	uv sync --all-packages
	$(PNPM) install

content: ## Validate /content and generate the graph the web app renders
	uv run brain validate
	uv run brain graph

embed: content ## Build the semantic search index (downloads the embedding model once)
	uv run brain embed

dev: content ## Run the web app on http://localhost:3000
	$(PNPM) --filter web dev

api: embed ## Run the FastAPI app on http://localhost:8000
	GRAPH_PATH=$(CURDIR)/apps/web/src/data/graph.json uv run uvicorn api.main:app --reload --port 8000

test: content ## Run Python and web tests
	uv run pytest -q
	$(PNPM) --filter web logos
	$(PNPM) --filter web test

lint: ## Lint Python and TypeScript
	uv run ruff check .
	uv run ruff format --check .
	$(PNPM) --filter web lint

typecheck: content ## Type-check the web app
	$(PNPM) --filter web logos
	$(PNPM) --filter web typecheck

build: content ## Production build of the web app
	$(PNPM) --filter web build

up: embed ## Run the API in Docker, like it runs in the cloud
	docker compose up --build

down: ## Stop Docker services
	docker compose down

# Kubernetes: the same API image on a local kind cluster, deployed with the Helm chart.
K8S_CLUSTER := infra-atlas
K8S_IMAGE := infra-atlas-api:local
K8S_RELEASE := atlas

.PHONY: k8s-up k8s-deploy k8s-down

k8s-up: ## Create the local kind cluster (1 control plane, 1 worker)
	kind get clusters | grep -qx $(K8S_CLUSTER) || kind create cluster --name $(K8S_CLUSTER) --config labs/k8s/kind-config.yaml

k8s-deploy: embed ## Build the API image, load it into kind and install the Helm chart
	docker build -f apps/api/Dockerfile -t $(K8S_IMAGE) .
	kind load docker-image $(K8S_IMAGE) --name $(K8S_CLUSTER)
	helm upgrade --install $(K8S_RELEASE) infra/helm/api \
		--kube-context kind-$(K8S_CLUSTER) \
		--set image.repository=$(firstword $(subst :, ,$(K8S_IMAGE))) \
		--set image.tag=$(lastword $(subst :, ,$(K8S_IMAGE))) \
		--wait --timeout 120s
	labs/k8s/smoke.sh $(K8S_RELEASE)-api

k8s-down: ## Delete the local kind cluster
	kind delete cluster --name $(K8S_CLUSTER)
