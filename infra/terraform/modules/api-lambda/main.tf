# The FastAPI app of apps/api, as a container image on Lambda behind an HTTP API (decision 5).
#
#   client -> API Gateway (HTTP API, throttled) -> Lambda (image from ECR) -> CloudWatch Logs
#
# Nothing here is billed while idle: that is the whole reason the API is not on Fargate.

locals {
  name = "${var.project}-${var.environment}-api"

  tags = merge(var.tags, {
    Environment = var.environment
    Component   = "api"
  })
}

# --------------------------------------------------------------------------------------------
# Registry
# --------------------------------------------------------------------------------------------

# AWS-0033 is checkov's CKV_AWS_136: AES256 instead of a customer-managed KMS key.
#trivy:ignore:AVD-AWS-0033
resource "aws_ecr_repository" "api" {
  # checkov:skip=CKV_AWS_136:AES256 with the S3-managed key, not KMS. A customer-managed key
  # costs 1 USD/month -- a fifth of the whole budget -- to encrypt layers whose contents are
  # this repository's own open-source code plus public base images.
  name = "${var.project}/api"

  # IMMUTABLE: a tag, once pushed, cannot be moved to different bytes. The function deploys by
  # digest anyway, but an immutable tag makes "which commit is in prod" answerable.
  image_tag_mutability = "IMMUTABLE"
  force_delete         = var.ecr_force_delete

  # Trivy already scans the image in CI before it is pushed (docs/SEGURIDAD.md). This scan
  # runs again inside AWS, on the bytes that actually arrived, and keeps finding new CVEs in
  # an image that has not changed -- which is the case that matters for something deployed.
  image_scanning_configuration {
    scan_on_push = true
  }

  # AES256 with the S3-managed key: KMS encryption of a registry would add a key charge for
  # layers that are already public code.
  encryption_configuration {
    encryption_type = "AES256"
  }

  tags = local.tags
}

# Every image is ~800 MB (docs/SEGURIDAD.md, finding D6), so "keep everything" is real money:
# ten releases would be 8 GB, about 0.80 USD/month.
resource "aws_ecr_lifecycle_policy" "api" {
  repository = aws_ecr_repository.api.name

  policy = jsonencode({
    rules = [
      {
        rulePriority = 1
        description  = "Expire untagged layers left behind by a new push"
        selection = {
          tagStatus   = "untagged"
          countType   = "sinceImagePushed"
          countUnit   = "days"
          countNumber = var.ecr_untagged_expire_days
        }
        action = { type = "expire" }
      },
      {
        rulePriority = 2
        description  = "Keep only the last ${var.ecr_keep_last_images} images"
        selection = {
          tagStatus   = "any"
          countType   = "imageCountMoreThan"
          countNumber = var.ecr_keep_last_images
        }
        action = { type = "expire" }
      },
    ]
  })
}

# --------------------------------------------------------------------------------------------
# Execution role
# --------------------------------------------------------------------------------------------

data "aws_iam_policy_document" "assume" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "api" {
  name                 = "${local.name}-exec"
  description          = "Execution role for ${local.name}. Logs only."
  assume_role_policy   = data.aws_iam_policy_document.assume.json
  permissions_boundary = var.permissions_boundary_arn
  tags                 = local.tags
}

# "El rol de ejecución solo necesita permisos de logs" (docs/SEGURIDAD.md). The model and the
# vector index ship inside the image, so the function needs no S3, no Bedrock and no network:
# the AWS-side equivalent of the chart's default-deny NetworkPolicy.
#
# Inline, not a managed policy (not even AWSLambdaBasicExecutionRole): the pipeline's IAM
# policy has no iam:AttachRolePolicy at all, which is what stops it attaching something
# powerful to a role it just created.
data "aws_iam_policy_document" "api" {
  # checkov:skip=CKV_AWS_111:The only unscoped statement is the X-Ray one, and
  # xray:PutTraceSegments has no resource form: a trace segment has no ARN.
  # checkov:skip=CKV_AWS_356:Same statement, same reason.
  statement {
    sid    = "WriteOwnLogs"
    effect = "Allow"

    actions = [
      "logs:CreateLogStream",
      "logs:PutLogEvents",
    ]

    resources = ["${aws_cloudwatch_log_group.api.arn}:*"]
  }

  dynamic "statement" {
    for_each = var.enable_xray ? [1] : []

    content {
      sid    = "Tracing"
      effect = "Allow"

      actions = [
        "xray:PutTelemetryRecords",
        "xray:PutTraceSegments",
      ]

      # X-Ray's write API has no resource-level permissions: a trace segment has no ARN.
      resources = ["*"]
    }
  }
}

resource "aws_iam_role_policy" "api" {
  name   = "${local.name}-exec"
  role   = aws_iam_role.api.id
  policy = data.aws_iam_policy_document.api.json
}

# --------------------------------------------------------------------------------------------
# Function
# --------------------------------------------------------------------------------------------

# Created by Terraform rather than left to Lambda: a group Lambda creates on first invocation
# has no retention and no tags, so it keeps logs forever.
# AWS-0017 is checkov's CKV_AWS_158: no customer-managed key on the log group.
#trivy:ignore:AVD-AWS-0017
resource "aws_cloudwatch_log_group" "api" {
  # checkov:skip=CKV_AWS_338:A year of retention is the opposite of what this project needs:
  # log storage is the one CloudWatch charge that grows on its own, and the budget is
  # 1-5 EUR/month (docs/DECISIONES.md). log_retention_days is 3 in dev and 14 in prod.
  # checkov:skip=CKV_AWS_158:KMS encryption of a log group costs a customer-managed key
  # (1 USD/month, a fifth of the whole budget). The logs are JSON request lines with no
  # personal data, and they are already encrypted at rest with an AWS-owned key.
  name              = "/aws/lambda/${local.name}"
  retention_in_days = var.log_retention_days
  tags              = local.tags
}

# AWS-0066 wants X-Ray always on. It is opt-in here (enable_xray, default false): traces are
# only worth their ingestion once there is traffic to trace, and the execution role grows two
# permissions when it is turned on.
#trivy:ignore:AVD-AWS-0066
resource "aws_lambda_function" "api" {
  # checkov:skip=CKV_AWS_173:The environment variables below are configuration, not secrets:
  # CORS origins, a log level, a rate limit. Encrypting them needs a customer-managed KMS key
  # (1 USD/month). Anything genuinely secret goes to SSM Parameter Store instead (decision 10).
  # checkov:skip=CKV_AWS_117:No VPC on purpose. The function talks to nothing private, and a
  # VPC-attached Lambda that needs the internet needs a NAT gateway: ~32 EUR/month, six times
  # the entire budget (decision 8 and the budget in docs/DECISIONES.md).
  # checkov:skip=CKV_AWS_116:No dead-letter queue: every invocation is a synchronous HTTP
  # request through API Gateway, so there is no asynchronous event to retry or park. The
  # caller sees the error and the 5xx alarm in modules/observability fires.
  # checkov:skip=CKV_AWS_272:Lambda code signing only works for zip packages, not container
  # images. The image is signed with cosign in release.yml and deployed by digest instead.
  function_name = local.name
  description   = "Infra Atlas API (graph, planner, semantic search) on the Lambda Web Adapter"
  role          = aws_iam_role.api.arn

  package_type = "Image"
  image_uri    = var.image_uri
  # The image is built for amd64 in CI. arm64 would be ~20% cheaper but needs a second build.
  architectures = ["x86_64"]

  memory_size = var.memory_mb
  timeout     = var.timeout_seconds

  ephemeral_storage {
    size = var.ephemeral_storage_mb
  }

  reserved_concurrent_executions = var.reserved_concurrency

  environment {
    variables = {
      # The adapter waits for /ready before it forwards anything, so the function is never
      # invoked while the model is still loading (docs/SEGURIDAD.md, finding D2).
      AWS_LWA_PORT                 = "8000"
      AWS_LWA_READINESS_CHECK_PATH = "/ready"
      AWS_LWA_INVOKE_MODE          = "BUFFERED"
      CORS_ORIGINS                 = join(",", var.cors_origins)
      API_DOCS                     = var.api_docs ? "1" : "0"
      LOG_FORMAT                   = "json"
      LOG_LEVEL                    = var.log_level
      RATE_LIMIT_PER_MINUTE        = tostring(var.rate_limit_per_minute)
      # Every request arrives through the adapter on loopback, so uvicorn should trust
      # X-Forwarded-For from there and nowhere else.
      FORWARDED_ALLOW_IPS = "127.0.0.1"
      # /metrics on its own listener, as in the Helm chart. 0 would serve it on the main
      # port, and the main port is what API Gateway publishes. Nothing scrapes 9000 in
      # Lambda and nothing can reach it, which is the point.
      METRICS_PORT = "9000"
    }
  }

  tracing_config {
    mode = var.enable_xray ? "Active" : "PassThrough"
  }

  logging_config {
    log_group = aws_cloudwatch_log_group.api.name
    # Text: the application already emits one JSON object per line. Letting Lambda wrap it in
    # its own JSON envelope would nest the structure the logs are parsed by.
    log_format = "Text"
  }

  tags = local.tags

  depends_on = [aws_iam_role_policy.api]
}

# --------------------------------------------------------------------------------------------
# HTTP API
# --------------------------------------------------------------------------------------------

# HTTP API, not REST API: ~70% cheaper per million requests and it has everything needed here.
resource "aws_apigatewayv2_api" "api" {
  name          = local.name
  description   = "Public entry point for the Infra Atlas API"
  protocol_type = "HTTP"

  # The browser preflight is answered by the gateway, so an OPTIONS never wakes the function.
  # No block at all when there are no origins: the CDN serves /api/* from the same origin as
  # the pages, so a browser making a cross-origin request to this API is the exception, not
  # the rule. CORS protects the user's browser, not the API -- a curl ignores it entirely.
  dynamic "cors_configuration" {
    for_each = length(var.cors_origins) > 0 ? [1] : []

    content {
      allow_origins = var.cors_origins
      allow_methods = ["GET", "POST"]
      allow_headers = ["content-type", "x-request-id"]
      # No allow_credentials: the API has no sessions and no cookies (docs/SEGURIDAD.md).
      max_age = 3600
    }
  }

  tags = local.tags
}

resource "aws_apigatewayv2_integration" "api" {
  api_id = aws_apigatewayv2_api.api.id

  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.api.invoke_arn
  payload_format_version = "2.0"
  timeout_milliseconds   = var.timeout_seconds * 1000
}

# One catch-all route: FastAPI already owns the routing table, and duplicating it here would
# mean a new route for every endpoint added to the app.
resource "aws_apigatewayv2_route" "proxy" {
  # checkov:skip=CKV_AWS_309:The atlas is a public read-only API, by design. Authorization
  # arrives in phase 3 with Cognito (decision 7); until then the protections are throttling
  # below, reserved concurrency, and the app's own validation and rate limit.
  api_id    = aws_apigatewayv2_api.api.id
  route_key = "ANY /{proxy+}"
  target    = "integrations/${aws_apigatewayv2_integration.api.id}"
}

resource "aws_apigatewayv2_route" "root" {
  # checkov:skip=CKV_AWS_309:Same: public read-only API until phase 3.
  api_id    = aws_apigatewayv2_api.api.id
  route_key = "ANY /"
  target    = "integrations/${aws_apigatewayv2_integration.api.id}"
}

# AWS-0017, same as the function's log group above.
#trivy:ignore:AVD-AWS-0017
resource "aws_cloudwatch_log_group" "access" {
  # checkov:skip=CKV_AWS_338:Same as the function's log group: short retention is a budget
  # decision, not an oversight.
  # checkov:skip=CKV_AWS_158:Same as the function's log group: a customer-managed KMS key
  # costs more per month than everything else in this module put together.
  name              = "/aws/apigateway/${local.name}"
  retention_in_days = var.access_log_retention_days
  tags              = local.tags
}

resource "aws_apigatewayv2_stage" "default" {
  api_id      = aws_apigatewayv2_api.api.id
  name        = "$default"
  auto_deploy = true

  # The edge rate limit. Unlike the API's own counter, this one sees every request from every
  # execution environment, and it rejects with 429 before Lambda is invoked -- so a flood
  # costs gateway requests, not GB-seconds.
  default_route_settings {
    throttling_rate_limit  = var.throttling_rate_limit
    throttling_burst_limit = var.throttling_burst_limit
    # Off: per-route metrics are billed as CloudWatch custom metrics, 0.30 USD each per
    # month, which on this budget buys nothing. The API-level 4xx/5xx/Count/Latency metrics
    # the 5xx alarm reads are published for free either way.
    detailed_metrics_enabled = false
  }

  access_log_settings {
    destination_arn = aws_cloudwatch_log_group.access.arn

    # x-request-id is the id the API itself puts on every log line and response header, so a
    # gateway line and an application line can be joined on it.
    format = jsonencode({
      requestId        = "$context.requestId"
      requestTime      = "$context.requestTime"
      sourceIp         = "$context.identity.sourceIp"
      httpMethod       = "$context.httpMethod"
      path             = "$context.path"
      status           = "$context.status"
      responseLength   = "$context.responseLength"
      responseLatency  = "$context.responseLatency"
      integrationError = "$context.integrationErrorMessage"
    })
  }

  tags = local.tags
}

# API Gateway is a service principal, not a caller with a role, so the permission to invoke
# lives on the function. source_arn pins it to this API: without it, any API in any account
# could invoke the function.
resource "aws_lambda_permission" "api_gateway" {
  statement_id  = "AllowInvokeFromHttpApi"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.api.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.api.execution_arn}/*/*"
}
