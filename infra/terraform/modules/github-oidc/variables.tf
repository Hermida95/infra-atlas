variable "project" {
  description = "Name prefix. Every resource the apply role may touch has to start with it."
  type        = string
}

variable "environment" {
  description = "Environment these two roles deploy (dev, prod). Part of the role names."
  type        = string
}

variable "github_repository" {
  description = "owner/repo allowed to assume these roles. Nothing else can, not even another repo of the same owner."
  type        = string

  validation {
    condition     = can(regex("^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$", var.github_repository))
    error_message = "Must be owner/repo, e.g. Hermida95/infra-atlas."
  }
}

variable "oidc_provider_arn" {
  description = "ARN of the token.actions.githubusercontent.com IAM OIDC provider."
  type        = string
}

variable "plan_subjects" {
  description = <<-EOT
    GitHub OIDC `sub` claims allowed to assume the read-only plan role, e.g.
    ["repo:Hermida95/infra-atlas:pull_request", "repo:Hermida95/infra-atlas:ref:refs/heads/main"].

    The claim is matched with StringLike, so a trailing * is allowed but discouraged:
    "repo:owner/repo:*" would trust every ref, tag and environment of the repository.
  EOT
  type        = list(string)

  validation {
    condition     = length(var.plan_subjects) > 0
    error_message = "At least one subject, or nothing could ever run a plan."
  }

  validation {
    condition     = alltrue([for s in var.plan_subjects : startswith(s, "repo:")])
    error_message = "Every subject must start with repo:, so the claim is pinned to one repository."
  }
}

variable "github_environment" {
  description = <<-EOT
    GitHub environment whose jobs may assume the apply role. The token's `sub` is then
    "repo:<owner/repo>:environment:<name>", so a job without `environment:` in the workflow
    cannot assume this role at all -- which is what makes the manual approval on prod
    unavoidable rather than a convention (decision 9).

    The environment must exist in the repository settings with this exact spelling.
  EOT
  type        = string
}

variable "apply_ref" {
  description = <<-EOT
    Git ref an apply must run from, checked as a second claim (`ref`) on top of the
    environment-scoped `sub`. A GitHub token carries both, so this closes the gap left by
    `sub`: with an environment the subject says nothing about the branch.

    Null disables the check (then only the GitHub environment protection rules decide which
    branches may deploy).
  EOT
  type        = string
  default     = "refs/heads/main"
}

variable "state_bucket_arn" {
  description = "ARN of the Terraform state bucket."
  type        = string
}

variable "state_key_prefix" {
  description = <<-EOT
    Key prefix this environment owns inside the state bucket, with a trailing slash
    (e.g. "envs/dev/"). The apply role can write only under it, so the dev pipeline cannot
    corrupt the prod state.
  EOT
  type        = string

  validation {
    condition     = endswith(var.state_key_prefix, "/")
    error_message = "Must end with a slash, or the prefix would also match sibling keys."
  }
}

variable "aws_partition" {
  description = "AWS partition (aws, aws-cn, aws-us-gov), for building ARNs."
  type        = string
  default     = "aws"
}

variable "aws_account_id" {
  description = "Account id, for building ARNs."
  type        = string
}

variable "permissions_boundary_arn" {
  description = <<-EOT
    Policy the apply role must attach as a permissions boundary to every IAM role it creates.
    It is what stops the classic privilege escalation: a role that may create roles and write
    their inline policies can otherwise mint itself an administrator and pass it to Lambda.

    Null drops both the condition and the requirement.
  EOT
  type        = string
  default     = null
}

variable "max_session_duration" {
  description = "Seconds a session lasts. One hour is plenty for a plan or an apply."
  type        = number
  default     = 3600

  validation {
    condition     = var.max_session_duration >= 900 && var.max_session_duration <= 14400
    error_message = "Between 900 and 14400 seconds; keep it short."
  }
}

variable "tags" {
  description = "Extra tags, merged on top of the provider's default_tags."
  type        = map(string)
  default     = {}
}
