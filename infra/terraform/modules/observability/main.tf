# Two things worth being woken up for on a 1-5 EUR/month project:
#
#   - the bill is growing (AWS Budgets, decision 10);
#   - the API is returning 5xx (CloudWatch alarm).
#
# Both land on one SNS topic, so there is one place to add a second channel later.

locals {
  name = "${var.project}-${var.environment}"

  tags = merge(var.tags, {
    Environment = var.environment
    Component   = "observability"
  })
}

data "aws_caller_identity" "current" {}

# --------------------------------------------------------------------------------------------
# Alert channel
# --------------------------------------------------------------------------------------------

# alias/aws/sns is the AWS-managed key: encryption at rest with no monthly key charge. A
# customer-managed key would cost 1 USD/month, a fifth of the budget, to protect "your bill
# went over 5 euros".
resource "aws_sns_topic" "alerts" {
  name              = "${local.name}-alerts"
  display_name      = "Infra Atlas ${var.environment}"
  kms_master_key_id = "alias/aws/sns"
  tags              = local.tags
}

# Without this, Budgets and CloudWatch cannot publish: an SNS topic's default policy only
# allows its owner. SourceAccount keeps another account's alarm from publishing here.
data "aws_iam_policy_document" "alerts" {
  statement {
    sid     = "AllowCloudWatchAlarms"
    effect  = "Allow"
    actions = ["SNS:Publish"]

    principals {
      type        = "Service"
      identifiers = ["cloudwatch.amazonaws.com"]
    }

    resources = [aws_sns_topic.alerts.arn]

    condition {
      test     = "StringEquals"
      variable = "AWS:SourceAccount"
      values   = [data.aws_caller_identity.current.account_id]
    }
  }

  statement {
    sid     = "AllowBudgets"
    effect  = "Allow"
    actions = ["SNS:Publish"]

    principals {
      type        = "Service"
      identifiers = ["budgets.amazonaws.com"]
    }

    resources = [aws_sns_topic.alerts.arn]

    condition {
      test     = "StringEquals"
      variable = "AWS:SourceAccount"
      values   = [data.aws_caller_identity.current.account_id]
    }
  }
}

resource "aws_sns_topic_policy" "alerts" {
  arn    = aws_sns_topic.alerts.arn
  policy = data.aws_iam_policy_document.alerts.json
}

resource "aws_sns_topic_subscription" "email" {
  for_each = toset(var.alert_emails)

  topic_arn = aws_sns_topic.alerts.arn
  protocol  = "email"
  endpoint  = each.value

  # AWS cannot confirm an email subscription from an API call, so Terraform would wait
  # forever. The subscription is created as "pending confirmation" and the recipient clicks
  # the link; `terraform apply` finishing is not the same as the alarm being deliverable.
  lifecycle {
    ignore_changes = [confirmation_timeout_in_minutes]
  }
}

# --------------------------------------------------------------------------------------------
# Cost
# --------------------------------------------------------------------------------------------

# Budgets are account-wide and evaluated a few times a day, not in real time: the forecast
# notification is the one that arrives in time to do something about it.
resource "aws_budgets_budget" "cost" {
  for_each = { for t in var.budget_thresholds : tostring(t) => t }

  name         = "${local.name}-${replace(tostring(each.value), ".", "-")}-${lower(var.budget_currency)}"
  budget_type  = "COST"
  limit_amount = tostring(each.value)
  limit_unit   = var.budget_currency
  time_unit    = "MONTHLY"

  # Credits and refunds are excluded so free-tier credits cannot hide real spend; a budget
  # that only warns once the credits run out warns too late.
  cost_types {
    include_credit = false
    include_refund = false
    include_tax    = true
    use_blended    = false
  }

  # The spend has already happened.
  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 100
    threshold_type             = "PERCENTAGE"
    notification_type          = "ACTUAL"
    subscriber_sns_topic_arns  = [aws_sns_topic.alerts.arn]
    subscriber_email_addresses = var.alert_emails
  }

  # The spend is on course to happen. This is the useful one.
  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = var.budget_forecast_threshold_percent
    threshold_type             = "PERCENTAGE"
    notification_type          = "FORECASTED"
    subscriber_sns_topic_arns  = [aws_sns_topic.alerts.arn]
    subscriber_email_addresses = var.alert_emails
  }

  depends_on = [aws_sns_topic_policy.alerts]
}

# --------------------------------------------------------------------------------------------
# API health
# --------------------------------------------------------------------------------------------

# AWS/ApiGatewayV2 publishes `5xx` for HTTP APIs (the REST API metric is `5XXError`, a
# different namespace and a different name -- an easy way to build an alarm that never fires).
#
# Sum, not Average: Average over a period with two requests, one of them failing, is 0.5 and
# would never cross a threshold expressed in responses.
resource "aws_cloudwatch_metric_alarm" "api_5xx" {
  count = var.api_id == null ? 0 : 1

  alarm_name        = "${local.name}-api-5xx"
  alarm_description = "The ${var.environment} API returned ${var.api_5xx_threshold} or more 5xx in ${var.api_5xx_period_seconds / 60} minutes."

  namespace   = "AWS/ApiGateway"
  metric_name = "5xx"

  # ApiId alone, not ApiId + Stage: the per-stage dimension only carries data once detailed
  # metrics are enabled, and those are billed per route as custom metrics. There is one stage
  # ($default), so this is the same number for free.
  dimensions = {
    ApiId = var.api_id
  }

  statistic           = "Sum"
  period              = var.api_5xx_period_seconds
  evaluation_periods  = var.api_5xx_evaluation_periods
  threshold           = var.api_5xx_threshold
  comparison_operator = "GreaterThanOrEqualToThreshold"

  # notBreaching: an API nobody called publishes no datapoints, and "no traffic" must not look
  # like "broken". The counterpart is that this alarm cannot detect an outage that stops
  # traffic reaching the gateway at all -- that needs a synthetic check, which costs money.
  treat_missing_data = "notBreaching"

  alarm_actions = [aws_sns_topic.alerts.arn]
  ok_actions    = [aws_sns_topic.alerts.arn]

  tags = local.tags
}
