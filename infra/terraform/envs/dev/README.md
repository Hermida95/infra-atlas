# envs/dev

The environment that exists to be broken and rebuilt. Same modules as `prod`, wired the same
way; what differs is size and retention, and that is meant to stay the only difference.

| | dev | prod |
| --- | --- | --- |
| Lambda memory | 1024 MB (the floor the embedding model needs) | 1536 MB (shorter cold start) |
| Reserved concurrency | 2 | 5 |
| API Gateway throttling | 5 req/s, burst 10 | 10 req/s, burst 20 |
| Log retention | 3 days | 14 days |
| Images kept in ECR | 2 | 5 |
| `terraform destroy` empties ECR | yes | no |
| `/docs` published | yes | no |
| Log level | DEBUG | INFO |
| Page cache at the edge | 60 s | 300 s |
| HSTS max-age | 300 s | 1 year |
| Asset bucket versioning | off | on |
| AWS Budgets | none (prod's are account-wide) | 5 € and 10 € |
| 5xx alarm | 10 in 5 min, twice | 5 in 5 min, twice |

See [../../README.md](../../README.md) for the two-step first apply, and
[terraform.tfvars.example](terraform.tfvars.example) for what you have to fill in.

```bash
cp backend.hcl.example backend.hcl           && $EDITOR backend.hcl
cp terraform.tfvars.example terraform.tfvars && $EDITOR terraform.tfvars
terraform init -backend-config=backend.hcl
terraform plan
```

## Before the very first apply: check one Service Quota

`reserved_concurrency` is written literally in `main.tf` (2 here, 5 in `prod`) because it
is this project's main cost guard — without it a loop hitting `/search` has no upper bound. It
is also the one number in this directory that a brand-new AWS account can refuse.

Lambda will only accept a reservation while **at least 100 of the account's concurrency stays
unreserved**. A fresh account often has the *Concurrent executions* quota lowered to 10 or 50
rather than the documented 1000, and then `reserved_concurrent_executions` fails the apply
with:

> InvalidParameterValueException: Specified ReservedConcurrentExecutions for function
> decreases account's UnreservedConcurrentExecution below its minimum value of [100].

Check it before the first apply, and remember `dev` and `prod` reserve from the same pool
(2 + 5 = 7, so the account needs at least 107):

```bash
# Current quota (L-B99A9384 = Lambda concurrent executions)
aws service-quotas get-service-quota --service-code lambda --quota-code L-B99A9384 \
  --query 'Quota.Value' --output text

# What is already reserved and what is left
aws lambda get-account-settings --query 'AccountLimit.ConcurrentExecutions'
```

If it comes back below 107, raise it (`aws service-quotas request-service-quota-increase
--service-code lambda --quota-code L-B99A9384 --desired-value 1000`, approved automatically
in most regions) rather than lowering the number in `main.tf`. Dropping the reservation is
what removes the ceiling on the bill, which is the opposite of what this project wants; if the
increase is genuinely unavailable, note the lower value and why in the pull request that
changes it.

Nothing else here is quota-sensitive at this size: one CloudFront distribution (limit 200),
two S3 buckets (limit 100), one HTTP API, one ECR repository, and two budgets — which is
exactly the number AWS does not charge for.
