PNPM := COREPACK_ENABLE_DOWNLOAD_PROMPT=0 corepack pnpm

.PHONY: help install content embed dev api test lint typecheck build up down audit

help: ## Show available targets
	@grep -E '^[a-z0-9-]+:.*## ' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*## "}; {printf "  %-12s %s\n", $$1, $$2}'

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

audit: ## Supply-chain checks CI runs: Python CVEs (pip-audit), web CVEs, workflow security (zizmor)
	uv export --frozen --all-packages --no-dev --no-emit-workspace --no-hashes -o .requirements-audit.txt
	uvx pip-audit==2.10.1 --strict --disable-pip --no-deps -r .requirements-audit.txt; status=$$?; rm -f .requirements-audit.txt; exit $$status
	$(PNPM) audit --prod
	uvx zizmor==1.31.1 --offline --min-severity medium .github/workflows

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

# Terraform. Same tools and versions as the `terraform` job of .github/workflows/ci.yml, so a
# green `make tf-check` means a green CI. tfvars and backend.hcl are never needed: validate
# runs with -backend=false, so none of this touches AWS or the state bucket.
TF_DIRS := infra/terraform/bootstrap $(wildcard infra/terraform/modules/*) $(wildcard infra/terraform/envs/*)
TFLINT_CONFIG := $(CURDIR)/infra/terraform/.tflint.hcl
CHECKOV_VERSION := 3.2.489
# One shared plugin cache for all seven `terraform init` runs. Without it each directory
# downloads the AWS provider again: about 180 MB, seven times.
export TF_PLUGIN_CACHE_DIR := $(CURDIR)/.terraform-plugin-cache

.PHONY: tf-fmt tf-validate tf-test tf-lint tf-sec tf-check

tf-fmt: ## Check Terraform formatting (terraform fmt -check -recursive)
	terraform fmt -check -recursive infra/terraform

tf-validate: ## Type-check every Terraform module and environment, without credentials
	@mkdir -p $(TF_PLUGIN_CACHE_DIR)
	@for dir in $(TF_DIRS); do \
		echo "==> $$dir"; \
		terraform -chdir=$$dir init -backend=false -input=false >/dev/null || exit 1; \
		terraform -chdir=$$dir validate || exit 1; \
	done

# The only check here that builds a plan. validate type-checks the configuration without one,
# so it cannot see a count or a dynamic block whose value is unknown until apply -- the error
# that passes fmt, validate, tflint and checkov and then fails the first real plan.
# mock_provider means no credentials, no account and no network.
tf-test: ## Run terraform test (mock_provider, command = plan) in every directory that has tests
	@mkdir -p $(TF_PLUGIN_CACHE_DIR)
	@for dir in $(TF_DIRS); do \
		[ -d "$$dir/tests" ] || continue; \
		echo "==> $$dir"; \
		terraform -chdir=$$dir init -backend=false -input=false >/dev/null || exit 1; \
		terraform -chdir=$$dir test || exit 1; \
	done

tf-lint: ## Lint the Terraform with tflint and its AWS ruleset
	tflint --chdir=infra/terraform --init
	@for dir in $(TF_DIRS); do \
		echo "==> $$dir"; \
		tflint --chdir=$$dir --config=$(TFLINT_CONFIG) || exit 1; \
	done

tf-sec: ## Scan the Terraform for insecure and costly misconfiguration (checkov)
	uvx checkov==$(CHECKOV_VERSION) --directory infra/terraform --framework terraform --compact --quiet

tf-check: tf-fmt tf-validate tf-test tf-lint tf-sec ## All five Terraform checks, the same as CI
