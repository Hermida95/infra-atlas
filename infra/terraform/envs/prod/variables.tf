# Only values that cannot live in git: account-specific names, the address alarms go to, and
# the image digest of the moment. Everything that describes *how big* this environment is --
# memory, concurrency, retention, budget -- is written literally in main.tf, so a change to it
# shows up in a diff and gets reviewed.

variable "aws_region" {
  description = "Region for everything but the CloudFront certificate. Must match the backend block."
  type        = string
  default     = "eu-west-1"
}

variable "project" {
  description = "Name prefix. Changing it orphans every resource; it is also what the pipeline's IAM policies match on."
  type        = string
  default     = "infra-atlas"
}

variable "environment" {
  description = "This directory's environment name. Part of every resource name and of the state key."
  type        = string
  default     = "prod"

  validation {
    condition     = var.environment == "prod"
    error_message = "This is envs/prod. A different name here would write prod's state key with another environment's resources."
  }
}

variable "web_bucket_name" {
  description = <<-EOT
    Globally unique name for the web assets bucket. Must start with
    "<project>-<environment>-" (infra-atlas-prod-) or the pipeline's apply
    role cannot manage it.
  EOT
  type        = string
}

variable "alert_emails" {
  description = "Where budget and 5xx alarms are sent. Each address has to confirm by email."
  type        = list(string)
}

variable "api_image_uri" {
  description = <<-EOT
    Image the API Lambda runs, by digest:
    <account>.dkr.ecr.<region>.amazonaws.com/infra-atlas/api@sha256:<digest>

    deploy.yml passes it with -var after pushing the image it just built. On the very first
    apply the registry does not exist yet, so see README.md for the two-step bootstrap.
  EOT
  type        = string
}

variable "permissions_boundary_arn" {
  description = <<-EOT
    From the bootstrap stack's execution_boundary_arn output. The pipeline's apply role cannot
    create an IAM role without it, so leaving it null only works with your own credentials.
  EOT
  type        = string
  default     = null
}

variable "web_aliases" {
  description = "Custom domains for the CDN. Empty until a domain is bought (docs/DECISIONES.md)."
  type        = list(string)
  default     = []
}

variable "acm_certificate_arn" {
  description = "Certificate in us-east-1 for web_aliases. Null serves the default CloudFront certificate."
  type        = string
  default     = null
}

variable "extra_cors_origins" {
  description = <<-EOT
    Origins allowed to call the API on top of the CDN's own URL. The CDN's URL is not known
    until the distribution exists, so it is computed, not configured.
  EOT
  type        = list(string)
  default     = []
}
