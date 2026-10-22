variable "aws_region" {
  description = "Region the state bucket lives in. Every environment reads its state from here."
  type        = string
  default     = "eu-west-1"
}

variable "project" {
  description = "Name prefix and Project tag for everything this repo creates."
  type        = string
  default     = "infra-atlas"
}

variable "state_bucket_name" {
  description = <<-EOT
    Name of the Terraform state bucket. S3 bucket names are globally unique, so this cannot
    have a sensible default: pick something nobody else will take, e.g.
    "infra-atlas-tfstate-<account-id>". It is the value every env passes to
    `terraform init -backend-config=bucket=...`.
  EOT
  type        = string

  validation {
    condition     = can(regex("^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$", var.state_bucket_name))
    error_message = "Must be a valid S3 bucket name: 3-63 lowercase letters, digits, dots or hyphens."
  }
}

variable "state_noncurrent_version_retention_days" {
  description = <<-EOT
    How long an overwritten state version is kept. Versioning is what lets you roll back a bad
    apply; without an expiry, every apply ever made would be billed forever.
  EOT
  type        = number
  default     = 90

  validation {
    condition     = var.state_noncurrent_version_retention_days >= 30
    error_message = "Keep at least 30 days: that is the window to notice and undo a bad apply."
  }
}

variable "github_owner" {
  description = "GitHub owner allowed to assume the deploy roles."
  type        = string
  default     = "Hermida95"
}

variable "github_repo" {
  description = "GitHub repository allowed to assume the deploy roles."
  type        = string
  default     = "infra-atlas"
}

variable "create_oidc_provider" {
  description = <<-EOT
    Create the token.actions.githubusercontent.com IAM OIDC provider. An AWS account can only
    have one per URL, so set this to false (and pass `existing_oidc_provider_arn`) if the
    account already has it, or import it -- see README.md.
  EOT
  type        = bool
  default     = true
}

variable "existing_oidc_provider_arn" {
  description = "ARN of the GitHub OIDC provider to reuse when create_oidc_provider is false."
  type        = string
  default     = null
}

variable "environments" {
  description = <<-EOT
    One entry per environment that CI deploys to. The key is the Terraform env directory under
    envs/ and the name of the GitHub environment the apply role trusts.

    - plan_subjects: which GitHub OIDC `sub` claims may assume the read-only plan role.
      "repo:O/R:pull_request" covers `terraform plan` on every PR; the ref form restricts it
      to one branch.
    - apply_ref: the branch an apply must come from, checked as a second claim on top of the
      environment-scoped `sub`. Null disables the check.
  EOT
  type = map(object({
    plan_subjects = optional(list(string))
    apply_ref     = optional(string, "refs/heads/main")
  }))

  default = {
    dev  = {}
    prod = {}
  }
}
