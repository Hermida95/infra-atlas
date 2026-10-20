PNPM := COREPACK_ENABLE_DOWNLOAD_PROMPT=0 corepack pnpm

.PHONY: help install content dev api test lint typecheck build up down

help: ## Show available targets
	@grep -E '^[a-z-]+:.*## ' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*## "}; {printf "  %-10s %s\n", $$1, $$2}'

install: ## Install Python and Node dependencies
	uv sync --all-packages
	$(PNPM) install

content: ## Validate /content and generate the graph the web app renders
	uv run brain validate
	uv run brain graph

dev: content ## Run the web app on http://localhost:3000
	$(PNPM) --filter web dev

api: content ## Run the FastAPI app on http://localhost:8000
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

up: content ## Run the API in Docker, like it runs in the cloud
	docker compose up --build

down: ## Stop Docker services
	docker compose down
