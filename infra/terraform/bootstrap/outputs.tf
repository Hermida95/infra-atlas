output "state_bucket" {
  description = "Bucket name for `terraform init -backend-config=bucket=...` in every env."
  value       = aws_s3_bucket.state.id
}

output "state_bucket_region" {
  description = "Region of the state bucket; must match the `region` in each env backend block."
  value       = var.aws_region
}

output "oidc_provider_arn" {
  description = "ARN of the GitHub Actions OIDC provider the deploy roles trust."
  value       = local.oidc_provider_arn
}

output "plan_role_arns" {
  description = <<-EOT
    Read-only role per environment. Goes in the repository variable AWS_PLAN_ROLE_ARN_<ENV>
    (see .github/workflows/deploy.yml and the manual steps in the PR).
  EOT
  value       = { for env, mod in module.deploy_roles : env => mod.plan_role_arn }
}

output "apply_role_arns" {
  description = "Apply role per environment, for the repository variable AWS_APPLY_ROLE_ARN_<ENV>."
  value       = { for env, mod in module.deploy_roles : env => mod.apply_role_arn }
}

output "github_environments" {
  description = <<-EOT
    GitHub environment names the apply roles trust. Each one must exist in the repository
    settings with the same spelling, or STS refuses the apply.
  EOT
  value       = { for env, mod in module.deploy_roles : env => mod.github_environment }
}

output "execution_boundary_arn" {
  description = <<-EOT
    Permissions boundary every role the pipeline creates must carry. Pass it to each env as
    `permissions_boundary_arn`; the apply role's IAM policy refuses to create a role without it.
  EOT
  value       = aws_iam_policy.execution_boundary.arn
}
