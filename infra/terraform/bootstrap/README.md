# bootstrap

The two things that have to exist before CI can run Terraform at all, and which CI therefore
cannot create:

1. **The S3 bucket every environment keeps its state in.** Versioned, encrypted, public access
   blocked, TLS-only, with an expiry on old versions so it does not grow forever.
2. **The GitHub OIDC provider and the deploy roles.** One read-only `*-gha-plan` role and one
   `*-gha-apply` role per environment (`modules/github-oidc`), plus the permissions boundary
   every role the pipeline creates has to carry.

It is **applied once, by hand, with your own credentials**. Its own state is local and
gitignored: there is no bucket to put it in until this directory has run.

> This is the chicken-and-egg of remote state, and it has no clever solution. Somebody has to
> create the first bucket with credentials that did not come from the pipeline.

## Apply it

Requires Terraform ≥ 1.10 (for `use_lockfile`) and an AWS identity that can create S3 buckets
and IAM roles — your own `AdministratorAccess` user or SSO session, not a pipeline role.

```bash
cd infra/terraform/bootstrap

cp terraform.tfvars.example terraform.tfvars
$EDITOR terraform.tfvars          # pick a globally unique state_bucket_name

aws sts get-caller-identity        # make sure these are the credentials you think they are

terraform init
terraform plan -out=bootstrap.tfplan
terraform apply bootstrap.tfplan
```

Then read off what the rest of the setup needs:

```bash
terraform output                           # everything at once
terraform output -raw state_bucket         # -> envs/*/backend.hcl
terraform output -raw execution_boundary_arn
terraform output -json plan_role_arns      # -> repository variables AWS_PLAN_ROLE_ARN_DEV/PROD
terraform output -json apply_role_arns     # -> repository variables AWS_APPLY_ROLE_ARN_DEV/PROD
```

Keep `terraform.tfstate` somewhere you will still have it in six months (it is gitignored on
purpose). If you lose it, nothing is broken — every resource here is importable:

```bash
terraform import 'aws_s3_bucket.state' infra-atlas-tfstate-000000000000
terraform import 'aws_iam_openid_connect_provider.github[0]' \
  arn:aws:iam::000000000000:oidc-provider/token.actions.githubusercontent.com
terraform import 'aws_iam_policy.execution_boundary' \
  arn:aws:iam::000000000000:policy/infra-atlas-execution-boundary
terraform import 'module.deploy_roles["dev"].aws_iam_role.plan'  infra-atlas-dev-gha-plan
terraform import 'module.deploy_roles["dev"].aws_iam_role.apply' infra-atlas-dev-gha-apply
```

## The account already has a GitHub OIDC provider

An AWS account can only hold one provider per issuer URL, and creating a second one fails. If
another project got there first, either import it (above) or point at it:

```hcl
create_oidc_provider       = false
existing_oidc_provider_arn = "arn:aws:iam::000000000000:oidc-provider/token.actions.githubusercontent.com"
```

## Move this state into the bucket it just created (optional)

Uncomment the `backend "s3"` block in `versions.tf` and run:

```bash
terraform init -backend-config="bucket=$(terraform output -raw state_bucket)" -migrate-state
```

Tidier, but it means a destroyed bucket takes its own state with it. Local state is the safer
default for a stack that is applied once a year.

## Destroying it

`aws_s3_bucket.state` carries `prevent_destroy`, so `terraform destroy` refuses until that
line is removed. That is deliberate: deleting this bucket orphans every resource in every
environment, and Terraform would no longer know they exist.

## What the owner still has to do by hand

Terraform cannot create GitHub environments, repository variables or secrets, and this
repository does not try. After applying:

- create the GitHub environments `dev` and `prod` (**exactly** those names — the apply roles
  trust `repo:<owner>/<repo>:environment:<name>` and nothing else);
- put at least one required reviewer on `prod` (decision 9: no unattended apply in production);
- restrict both environments' deployment branches to `main`;
- set the repository variables `AWS_REGION`, `AWS_PLAN_ROLE_ARN_DEV`, `AWS_APPLY_ROLE_ARN_DEV`,
  `AWS_PLAN_ROLE_ARN_PROD`, `AWS_APPLY_ROLE_ARN_PROD`, `TF_STATE_BUCKET`.

`.github/workflows/deploy.yml` lists the same steps where it reads them.
