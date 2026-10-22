# prod: the same modules as dev, wired identically. What differs is size and retention, plus
# the two AWS Budgets, which are account-wide and so live in exactly one environment.

locals {
  # Production has no localhost caller: the pages and /api/* come from the same CloudFront
  # origin, so a cross-origin request is not expected at all. An empty list means the HTTP
  # API sends no CORS headers, which is the strictest correct answer.
  cors_origins = concat(
    [for alias in var.web_aliases : "https://${alias}"],
    var.extra_cors_origins,
  )
}

module "api" {
  source = "../../modules/api-lambda"

  project     = var.project
  environment = var.environment

  image_uri                = var.api_image_uri
  permissions_boundary_arn = var.permissions_boundary_arn
  cors_origins             = local.cors_origins

  # 1536 MB rather than dev's 1024: Lambda's CPU share scales with memory, so the extra
  # 512 MB buys a shorter cold start on the first search after an idle period. Billing is
  # GB-seconds, so a run that is proportionally faster costs the same.
  memory_mb            = 1536
  timeout_seconds      = 29
  reserved_concurrency = 5

  # No /docs and no debug logging in front of the public (docs/SEGURIDAD.md, finding S6).
  api_docs  = false
  log_level = "INFO"

  throttling_rate_limit  = 10
  throttling_burst_limit = 20
  rate_limit_per_minute  = 60

  # Two weeks: long enough to investigate a report that arrives on Monday about Friday.
  log_retention_days        = 14
  access_log_retention_days = 14

  # Five images, so a rollback can go back further than one release.
  ecr_keep_last_images     = 5
  ecr_untagged_expire_days = 7
  # Never let a destroy take the running image with it.
  ecr_force_delete = false
}

module "web" {
  source = "../../modules/web-opennext"

  project     = var.project
  environment = var.environment

  bucket_name         = var.web_bucket_name
  aliases             = var.web_aliases
  acm_certificate_arn = var.acm_certificate_arn

  api_origin_domain = replace(module.api.api_endpoint, "https://", "")

  default_cache_max_age_seconds = 300

  # One year, as decision 10 asks. Still not preloaded: the preload list is easy to join and
  # slow to leave, and there is no domain yet to join it with.
  hsts_max_age_seconds = 31536000
  hsts_preload         = false

  # Keep the previous upload around for a month: a bad deploy here is visible to readers.
  enable_bucket_versioning = true
}

module "observability" {
  source = "../../modules/observability"

  project     = var.project
  environment = var.environment

  alert_emails = var.alert_emails
  api_id       = module.api.api_id

  # Decision 10 and the cost table in docs/DECISIONES.md: 5 EUR is "this is no longer free",
  # 10 EUR is "stop and look". Two budgets is also exactly what AWS does not charge for.
  budget_thresholds = [5, 10]
  budget_currency   = "EUR"
  # Warn when the month is forecast to reach 80% of the limit, not 100%: a forecast that only
  # fires at the limit arrives with nothing left to save.
  budget_forecast_threshold_percent = 80

  api_5xx_threshold          = 5
  api_5xx_period_seconds     = 300
  api_5xx_evaluation_periods = 2
}
