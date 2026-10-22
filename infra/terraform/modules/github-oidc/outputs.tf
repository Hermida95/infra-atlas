output "plan_role_arn" {
  description = "Role the PR plan job assumes. Read-only."
  value       = aws_iam_role.plan.arn
}

output "apply_role_arn" {
  description = "Role the apply job assumes, only from the GitHub environment below."
  value       = aws_iam_role.apply.arn
}

output "github_environment" {
  description = "GitHub environment the apply role trusts. Must exist with this exact name."
  value       = var.github_environment
}

output "apply_ref" {
  description = "Git ref the apply role accepts, or null when the check is disabled."
  value       = var.apply_ref
}
