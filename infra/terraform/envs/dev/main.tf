# dev: the environment that exists to be broken and rebuilt. Same modules as prod, same
# wiring, smaller numbers and shorter retention -- that is the whole difference, and it is
# meant to stay that way: a dev that is structurally different stops being a rehearsal.

locals {
  # The CDN serves /api/* from the same origin as the pages, so the browser never makes a
  # cross-origin request to the API. The only genuine cross-origin caller is `make dev`
  # running the web app on localhost against this deployed API.
  cors_origins = concat(
    ["http://localhost:3000"],
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

  # 1024 MB is the floor the embedding model needs (docs/SEGURIDAD.md); there is nothing to
  # gain from more in an environment with one user.
  memory_mb            = 1024
  timeout_seconds      = 29
  reserved_concurrency = 2

  # /docs on, so the API is explorable here. Off in prod, like the Helm chart's config.docs.
  api_docs  = true
  log_level = "DEBUG"

  # A tighter edge limit than prod: nothing legitimate here is more than one person clicking.
  throttling_rate_limit  = 5
  throttling_burst_limit = 10
  rate_limit_per_minute  = 60

  # Three days of logs: long enough to debug yesterday, short enough to cost nothing.
  log_retention_days        = 3
  access_log_retention_days = 3

  # Two images: the one deployed and one to roll back to.
  ecr_keep_last_images     = 2
  ecr_untagged_expire_days = 1
  # `terraform destroy` has to work in dev without emptying the registry by hand first.
  ecr_force_delete = true
}

module "web" {
  source = "../../modules/web-opennext"

  project     = var.project
  environment = var.environment

  bucket_name         = var.web_bucket_name
  aliases             = var.web_aliases
  acm_certificate_arn = var.acm_certificate_arn

  # Same origin for the pages and the API.
  api_origin_domain = replace(module.api.api_endpoint, "https://", "")

  # Pages expire in a minute here, so a deploy is visible without an invalidation.
  default_cache_max_age_seconds = 60

  # No HSTS preload from a throwaway environment, and a short max-age: a browser that has
  # been told "always HTTPS for a year" keeps obeying long after the environment is gone.
  hsts_max_age_seconds = 300
  hsts_preload         = false
}

module "observability" {
  source = "../../modules/observability"

  project     = var.project
  environment = var.environment

  alert_emails = var.alert_emails
  api_id       = module.api.api_id

  # No budget here: a budget with no cost filter measures the whole account, so prod's two
  # already cover this environment's spend, and AWS bills 0.02 USD/day from the third budget
  # on. See modules/observability/variables.tf.
  budget_thresholds = []

  # Noisier than prod on purpose: in dev a 5xx is usually something being deployed.
  api_5xx_threshold          = 10
  api_5xx_period_seconds     = 300
  api_5xx_evaluation_periods = 2
}
