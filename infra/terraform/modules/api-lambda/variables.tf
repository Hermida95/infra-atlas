variable "project" {
  description = "Name prefix for every resource."
  type        = string
}

variable "environment" {
  description = "Environment name (dev, prod). Part of every resource name."
  type        = string
}

variable "image_uri" {
  description = <<-EOT
    The image the function runs, as <account>.dkr.ecr.<region>.amazonaws.com/<repo>@sha256:<digest>.
    It is the `lambda` target of apps/api/Dockerfile: the same image Compose and kind run, plus
    the Lambda Web Adapter (decision 5).

    By digest, not by tag, for the same reason the Helm chart deploys by digest: the digest
    names the exact bytes CI scanned and signed (docs/SEGURIDAD.md).

    This is also the chicken-and-egg of the module: the repository below is what the image is
    pushed to, so the very first apply is two steps -- see README.md.
  EOT
  type        = string

  validation {
    condition     = can(regex("@sha256:[0-9a-f]{64}$", var.image_uri))
    error_message = "Must end in @sha256:<64 hex digits>. Deploying a mutable tag means not knowing what is running."
  }
}

variable "memory_mb" {
  description = <<-EOT
    Lambda CPU scales with memory, and the embedding model needs ~300 MiB of it
    (docs/SEGURIDAD.md measured it; the Helm chart requests 320Mi for the same reason).
    Below 1024 MB the cold start gets painful without saving anything: billing is
    GB-seconds, so halving the memory of a job that then takes twice as long costs the same.
  EOT
  type        = number
  default     = 1024

  validation {
    condition     = var.memory_mb >= 1024 && var.memory_mb <= 3008
    error_message = "At least 1024 MB: the ONNX model needs ~300 MiB and the CPU share scales with memory."
  }
}

variable "ephemeral_storage_mb" {
  description = "Size of /tmp. The model and the index live in the image, so the default is plenty."
  type        = number
  default     = 512
}

variable "timeout_seconds" {
  description = <<-EOT
    A request that takes longer than this is cut off. Kept well under API Gateway's own 30 s
    hard limit, so the client always sees the API's error rather than the gateway's.
  EOT
  type        = number
  default     = 29

  validation {
    condition     = var.timeout_seconds > 0 && var.timeout_seconds <= 29
    error_message = "1-29 seconds: API Gateway HTTP APIs time out at 30 s regardless."
  }
}

variable "reserved_concurrency" {
  description = <<-EOT
    Hard ceiling on simultaneous executions, and the main cost guard of this module: with the
    account default (unreserved) a loop hitting /search could run thousands of 1 GB invocations
    in a minute. -1 means no reservation, which on a 1-5 EUR/month budget is a mistake.
  EOT
  type        = number
  default     = 5

  validation {
    condition     = var.reserved_concurrency >= 1
    error_message = "Set a real ceiling. Unreserved concurrency has no upper bound on cost."
  }
}

variable "log_retention_days" {
  description = <<-EOT
    CloudWatch Logs keeps data forever by default, and storage is what that ends up costing.
    Short retention is the difference between cents and euros once the logs pile up.
  EOT
  type        = number
  default     = 7

  validation {
    condition     = contains([1, 3, 5, 7, 14, 30, 60, 90, 120, 150, 180, 365, 400, 545, 731, 1096, 1827, 2192, 2557, 2922, 3288, 3653], var.log_retention_days)
    error_message = "Must be one of the retention periods CloudWatch Logs accepts."
  }
}

variable "ecr_keep_last_images" {
  description = "How many tagged images the registry keeps. Each one is billed per GB stored."
  type        = number
  default     = 5

  validation {
    condition     = var.ecr_keep_last_images >= 2
    error_message = "Keep at least two, so a rollback target always exists."
  }
}

variable "ecr_untagged_expire_days" {
  description = "Untagged layers left behind by overwritten images are billed like any other."
  type        = number
  default     = 7
}

variable "ecr_force_delete" {
  description = <<-EOT
    Allow `terraform destroy` to delete the repository while it still holds images. True in
    dev (the environment exists to be torn down), false in prod (the registry is the only
    place the running image lives).
  EOT
  type        = bool
  default     = false
}

variable "cors_origins" {
  description = <<-EOT
    Origins the browser may call the API from, as the API's CORS_ORIGINS variable and as the
    HTTP API's own CORS configuration. CORS protects the user's browser, not the API
    (docs/SEGURIDAD.md): a curl ignores it.

    Empty means no cross-origin access, which is the correct answer when every request reaches
    the API through the CDN at /api/* and is therefore same-origin already.
  EOT
  type        = list(string)
  default     = []

  validation {
    condition     = !contains(var.cors_origins, "*")
    error_message = "No wildcard origin: list the real ones (the CloudFront domain, localhost in dev)."
  }
}

variable "api_docs" {
  description = "Publish /docs, /redoc and /openapi.json. Off in prod, like the Helm chart's config.docs."
  type        = bool
  default     = false
}

variable "log_level" {
  description = "Log level of the API (LOG_LEVEL). The format is always JSON in the cloud."
  type        = string
  default     = "INFO"

  validation {
    condition     = contains(["DEBUG", "INFO", "WARNING", "ERROR"], var.log_level)
    error_message = "One of DEBUG, INFO, WARNING, ERROR."
  }
}

variable "rate_limit_per_minute" {
  description = <<-EOT
    The API's own in-memory limit per client IP. It is a safety net per execution environment;
    the real limit is `throttling_*` below, which sees every request (docs/SEGURIDAD.md).
  EOT
  type        = number
  default     = 60
}

variable "throttling_rate_limit" {
  description = <<-EOT
    Steady-state requests per second API Gateway lets through, across every caller. This is
    the edge limit docs/SEGURIDAD.md leaves pending ("Edge: WAF and API Gateway throttling,
    when the infrastructure is built with Terraform"), and the second cost guard after
    reserved concurrency. A WAF web ACL would be the third, but it bills ~5 USD/month before
    a single request, which is the whole budget.
  EOT
  type        = number
  default     = 10
}

variable "throttling_burst_limit" {
  description = "How big a spike is allowed through before the steady rate applies."
  type        = number
  default     = 20
}

variable "access_log_retention_days" {
  description = "Retention for the HTTP API's access log group."
  type        = number
  default     = 7
}

variable "enable_xray" {
  description = <<-EOT
    Active tracing. The first 100k traces a month are free, which covers this project, but it
    is off by default: traces are only useful once there is something to trace.
  EOT
  type        = bool
  default     = false
}

variable "permissions_boundary_arn" {
  description = <<-EOT
    Boundary attached to the execution role. The pipeline's own IAM policy refuses to create
    a role without it (see modules/github-oidc), so this is effectively required in CI.
  EOT
  type        = string
  default     = null
}

variable "tags" {
  description = "Extra tags, merged on top of the provider's default_tags."
  type        = map(string)
  default     = {}
}
