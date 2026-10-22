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
