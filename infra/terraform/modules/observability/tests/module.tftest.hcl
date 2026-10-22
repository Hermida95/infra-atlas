# Two assertions about the alert path, both of which fail silently in a real account.
#
# 1. The topic must carry no KMS key. CloudWatch Alarms cannot publish to a topic encrypted
#    with alias/aws/sns -- the AWS-managed key's policy cannot be edited to allow
#    cloudwatch.amazonaws.com -- and a failed alarm action is not retried and raises nothing.
#    The alarm would sit in ALARM with no mail ever sent.
#
# 2. The namespace must be AWS/ApiGateway. HTTP APIs publish `5xx` there; "AWS/ApiGatewayV2"
#    looks right next to the aws_apigatewayv2_* resources and does not exist, and an alarm
#    pointed at a namespace with no data simply never fires.
mock_provider "aws" {
  mock_data "aws_iam_policy_document" {
    defaults = {
      json = "{\"Version\":\"2012-10-17\",\"Statement\":[]}"
    }
  }

  mock_data "aws_caller_identity" {
    defaults = {
      account_id = "000000000000"
    }
  }
}

variables {
  project      = "infra-atlas"
  environment  = "dev"
  alert_emails = ["alerts@example.invalid"]
}

run "topic_is_publishable_by_cloudwatch" {
  command = plan

  assert {
    condition     = aws_sns_topic.alerts.kms_master_key_id == null
    error_message = "The alerts topic must not be encrypted: CloudWatch Alarms cannot publish to a topic using alias/aws/sns, and the failure is silent."
  }
}

run "alarm_reads_a_namespace_that_exists" {
  command = plan

  variables {
    enable_api_5xx_alarm = true
    api_id               = "abc123"
  }

  assert {
    condition     = aws_cloudwatch_metric_alarm.api_5xx[0].namespace == "AWS/ApiGateway"
    error_message = "HTTP API 5xx metrics live in AWS/ApiGateway. AWS/ApiGatewayV2 does not exist and the alarm would never fire."
  }

  assert {
    condition     = aws_cloudwatch_metric_alarm.api_5xx[0].metric_name == "5xx"
    error_message = "The HTTP API metric is `5xx`; `5XXError` is the REST API one."
  }

  assert {
    condition     = aws_cloudwatch_metric_alarm.api_5xx[0].statistic == "Sum"
    error_message = "Average over a window with one failure in two requests is 0.5 and never crosses a threshold counted in responses."
  }
}

# The alarm's count must come from the literal flag, never from api_id -- the caller passes
# module.api.api_id, which is unknown until apply.
run "no_alarm_without_the_flag" {
  command = plan

  variables {
    api_id = "abc123"
  }

  assert {
    condition     = length(aws_cloudwatch_metric_alarm.api_5xx) == 0
    error_message = "enable_api_5xx_alarm is what creates the alarm; api_id alone must not."
  }
}
