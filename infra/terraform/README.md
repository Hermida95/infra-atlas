# infra/terraform

The infrastructure the atlas runs on, and the last empty directory of the repo
([docs/DECISIONES.md](../../docs/DECISIONES.md), decision 9). The guiding principle of the
project is that *it deploys by following the journey it teaches*, so this is content as much
as it is plumbing: the `terraform`, `tfstate`, `oidc` and `tfplan` cards link straight into
these files.

```
bootstrap/              state bucket + GitHub OIDC provider + deploy roles. Applied once, by hand.
modules/
  github-oidc/          one read-only plan role and one apply role per environment
  api-lambda/           ECR + Lambda (container image) + HTTP API + logs + IAM
  web-opennext/         private S3 + CloudFront with OAC, CSP and HSTS
  observability/        AWS Budgets at 5 and 10 EUR + a 5xx alarm on the API
envs/
  dev/                  same modules, smaller numbers, shorter retention
  prod/                 same modules, and the two account-wide budgets
```

Nothing in here has been applied. There is no AWS account behind this repository yet, so
every account-specific value is a variable with a `terraform.tfvars.example` beside it, and
what is verified is `terraform fmt`, `terraform validate`, `tflint` and `checkov` — see
[What is not verified](#what-is-not-verified).

## Shape of the design

```
                         ┌──────────────── AWS ───────────────────────────────┐
 reader ──HTTPS──▶ CloudFront (OAC, CSP, HSTS, PriceClass_100)                │
                     ├── /_next/static/* ─▶ S3 (private, 1 year at the edge)  │
                     ├── pages ──────────▶ S3 (private, 60 s dev / 300 s prod)│
                     └── /api/* ─────────▶ API Gateway (HTTP API, throttled)  │
                                              └─▶ Lambda (image from ECR)     │
                                                     └─▶ CloudWatch Logs      │
                         └────────────────────────────────────────────────────┘

 git push ─▶ GitHub Actions ─(OIDC, no stored keys)─▶ plan role (PR) / apply role (main)
```

Three properties the design is built around, all of them consequences of a 1–5 €/month budget:

- **Nothing is billed while idle.** No NAT gateway, no load balancer, no cluster, no DynamoDB
  table for state locking (`use_lockfile` instead), no WAF, no customer-managed KMS key.
- **Spend has a ceiling, not just an alarm.** Reserved concurrency on the function and
  throttling on the stage put an upper bound on what a loop hitting `/search` can cost. The
  budgets tell you afterwards; these two stop it.
- **The pipeline cannot become an administrator.** Read-only on pull requests, ARN-scoped
  writes on apply, no `iam:AttachRolePolicy` at all, and a permissions boundary every role the
  pipeline creates has to carry.

## Running it locally

```bash
make tf-fmt      # terraform fmt -check -recursive
make tf-validate # init -backend=false + validate in every module and env
make tf-lint     # tflint (needs tflint --init once, which make does)
make tf-sec      # checkov
make tf-check    # all four, the same as CI
```

`make tf-validate` runs `terraform init -backend=false`, so it needs no credentials and never
touches the state bucket.

## First deployment, in order

1. **`bootstrap/`** — see [bootstrap/README.md](bootstrap/README.md). Creates the state
   bucket, the OIDC provider and the deploy roles.
2. **GitHub settings** — environments `dev` and `prod`, required reviewers on `prod`, and the
   repository variables. Terraform cannot do this and does not try; the list is in
   [bootstrap/README.md](bootstrap/README.md).
3. **`envs/dev`, the two-step first apply.** `modules/api-lambda` creates the registry *and*
   the function that runs an image from it, so on the very first apply there is no image to
   deploy yet:

   ```bash
   cd infra/terraform/envs/dev
   cp backend.hcl.example backend.hcl && $EDITOR backend.hcl
   cp terraform.tfvars.example terraform.tfvars && $EDITOR terraform.tfvars

   terraform init -backend-config=backend.hcl

   # step 1: the registry on its own
   terraform apply -target=module.api.aws_ecr_repository.api

   # push the lambda target of apps/api/Dockerfile into it
   make embed
   docker build -f apps/api/Dockerfile --target lambda -t "$(terraform output -raw ecr_repository_url):bootstrap" .
   aws ecr get-login-password | docker login --username AWS --password-stdin "$(terraform output -raw ecr_repository_url)"
   docker push "$(terraform output -raw ecr_repository_url):bootstrap"

   # step 2: everything, with api_image_uri set to the digest that push printed
   terraform apply
   ```

   Every later apply is one step: `deploy.yml` builds, pushes and passes the new digest.
4. **`envs/prod`** — the same, and then confirm the SNS subscription emails. An unconfirmed
   subscription is the usual reason an alarm "did not fire".

## Why the state looks like this

- **S3 with `use_lockfile = true`.** The lock is an object next to the state, written with a
  conditional PUT, so two applies cannot both win. It replaces the DynamoDB table every older
  guide tells you to create — one less resource, and one less thing billed.
- **One key per environment** (`envs/dev/terraform.tfstate`, `envs/prod/...`), and the apply
  role of each environment can only write under its own prefix. A dev pipeline cannot corrupt
  prod's state even if it wanted to.
- **Partial backend configuration.** The bucket name is globally unique, so it cannot be
  committed as a default; it comes from `backend.hcl` locally and from a repository variable
  in CI. Everything else (key, region, encryption, locking) is in the committed
  `backend "s3"` block, where a reviewer can see it.

## What is not verified

| Checked | How |
| --- | --- |
| Formatting | `terraform fmt -check -recursive` |
| Syntax, types, module wiring | `terraform init -backend=false` + `terraform validate` in all 7 directories |
| Terraform and AWS lint | `tflint` with the AWS ruleset |
| Security and cost misconfiguration | `checkov`, 0 failures, every skip carrying a reason |
| The same, by a second scanner | `trivy --scanners misconfig`, which `security.yml` already runs over the whole repo |
| **Nothing else** | There is no AWS account. Nothing here has ever been applied. |

`validate` type-checks a plan; it does not call AWS. It cannot tell you that an IAM condition
key is spelled right, that a metric name exists, or that a quota allows what you asked for.
The open questions are listed in the pull request that added this directory.

## Two scanners, two ignore files

`checkov` and `trivy` both read this Terraform, and they disagree about what counts as a
finding -- which is the point of running both. They also accept an exception in different
places, so an accepted trade-off is written twice:

| Scanner | Where the exception goes | Scope |
| --- | --- | --- |
| checkov | `# checkov:skip=CKV_AWS_68:reason`, **inside** the resource block | that resource |
| trivy | `#trivy:ignore:AVD-AWS-0011`, on the line **above** `resource` | that resource |

Both are per-resource on purpose. Trivy would also accept an id in the repo's `.trivyignore`,
and that is where accepted **image CVEs** go ([docs/SEGURIDAD.md](../../docs/SEGURIDAD.md)),
but an id there silences the rule for every future resource as well -- including the one
somebody adds next year without the same reason to be sure.

The exceptions that exist today, and all of them are the same decision seen from four angles:
no customer-managed KMS key (1 USD/month per key, on buckets and a topic that hold no
secrets), and no WAF (~5 USD/month before the first visitor). The reason is on the line in
every case.

## Provider lock files

`.terraform.lock.hcl` is gitignored, which is **not** where this should end up: a lock file is
how a provider version gets pinned to exact bytes, the same argument as SHA-pinned actions and
digest-pinned images ([docs/SEGURIDAD.md](../../docs/SEGURIDAD.md)). The files are missing
because they were written in an environment with no access to `registry.terraform.io`, and a
lock recorded without it holds one platform and no registry checksums — which fails
`terraform init` on any other platform instead of pinning anything.

Generate them once, from a machine that can reach the registry, and drop the `.terraform.lock.hcl`
line from `.gitignore`:

```bash
for d in infra/terraform/bootstrap infra/terraform/modules/* infra/terraform/envs/*; do
  terraform -chdir="$d" init -backend=false
  terraform -chdir="$d" providers lock \
    -platform=linux_amd64 -platform=darwin_arm64 -platform=darwin_amd64
done
```

`linux_amd64` is what CI runs; add whatever you develop on.
