# api-lambda

`apps/api` (FastAPI) as a container image on Lambda, behind an HTTP API. Decision 5: the
**same image** runs in Docker Compose, in the `kind` cluster of `k8s-smoke.yml` and here —
the `lambda` target of `apps/api/Dockerfile` only adds the
[Lambda Web Adapter](https://github.com/awslabs/aws-lambda-web-adapter), which waits for
`/ready` and proxies Lambda events to the uvicorn the image already starts.

```
client -> API Gateway (HTTP API, $default stage, throttled) -> Lambda (image) -> CloudWatch Logs
                                                                  ^
                                                                  ECR (scan on push, lifecycle)
```

## Decisions worth knowing

- **Deployed by digest, not by tag.** `image_uri` must end in `@sha256:…`, validated by the
  variable. Same reason the Helm chart uses `image.digest`: the digest names the exact bytes
  CI scanned and signed ([docs/SEGURIDAD.md](../../../../docs/SEGURIDAD.md)). `release.yml`
  is the only place that image is built; `deploy.yml` promotes that one digest into each
  environment's registry and never rebuilds, so `prod` runs the bytes `dev` ran.
- **The registry name carries the environment** (`<project>-<env>/api`). `dev` and `prod` share
  one account and one region, so a shared name would fail the second environment's first apply
  with `RepositoryAlreadyExists` — and would let one environment's pipeline overwrite the
  other's images. It is also what the apply role's ECR ARN scope matches on.
- **≥ 1024 MB of memory**, enforced by a validation. Lambda's CPU share scales with memory and
  the ONNX embedding model needs ~300 MiB; the chart requests 320Mi for the same measurement.
  Halving the memory does not halve the bill, because billing is GB-seconds and the work takes
  proportionally longer.
- **Reserved concurrency is required** (`>= 1`). It is the hard ceiling on cost: without it, a
  loop against `/search` can run thousands of 1 GB invocations a minute.
- **Throttling on the stage** is the edge rate limit `docs/SEGURIDAD.md` left pending. It
  rejects with 429 *before* Lambda is invoked, so a flood costs gateway requests rather than
  GB-seconds. The API's own in-memory limit stays as a per-execution-environment safety net.
- **Execution role: logs only.** The model, the vector index and the graph all ship inside the
  image, so the function needs no S3, no Bedrock and no network — the AWS-side equivalent of
  the chart's default-deny NetworkPolicy. Inline policy, never a managed one.
- **The log group is Terraform's.** A group Lambda creates on first invocation has no retention
  and keeps logs forever, which is the CloudWatch charge that grows on its own.
- **HTTP API, not REST API**: roughly 70% cheaper per million requests, and nothing here needs
  what REST adds.
- **`$default` stage with one catch-all route.** FastAPI already owns the routing table;
  mirroring it here would mean a Terraform change for every new endpoint.

## Deliberately absent

No VPC (a private Lambda that needs the internet needs a NAT gateway, ~32 €/month — six times
the budget), no dead-letter queue (every invocation is a synchronous HTTP request), no WAF
(~5 USD/month before the first visitor), no KMS key for the log group or the environment
variables (1 USD/month each, and none of it is secret — real secrets go to SSM Parameter Store,
decision 10). Each of those is a `checkov:skip` in `main.tf` with the reason on the line.

## Cost

Zero while idle, which is the point. Billed: Lambda GB-seconds and requests (1 M requests and
400,000 GB-s free every month), HTTP API requests (~1 USD per million), CloudWatch Logs
ingestion and storage, and ECR storage (~0.10 USD/GB-month — the image is ~800 MB, so the
`ecr_keep_last_images` limit is real money, not tidiness).
