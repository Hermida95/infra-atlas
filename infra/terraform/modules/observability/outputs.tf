output "alerts_topic_arn" {
  description = "SNS topic both the budgets and the 5xx alarm publish to."
  value       = aws_sns_topic.alerts.arn
}

output "budget_names" {
  description = "Budget names created, keyed by threshold."
  value       = { for k, b in aws_budgets_budget.cost : k => b.name }
}

output "api_5xx_alarm_name" {
  description = "Name of the 5xx alarm, or null when no api_id was given."
  value       = try(aws_cloudwatch_metric_alarm.api_5xx[0].alarm_name, null)
}

output "pending_email_confirmations" {
  description = <<-EOT
    Addresses AWS has emailed a confirmation link to. Until each one is clicked the
    subscription stays "PendingConfirmation" and the alarms go nowhere.
  EOT
  value       = [for s in aws_sns_topic_subscription.email : s.endpoint]
}
