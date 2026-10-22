output "site_url" {
  description = "The URL to open."
  value       = module.web.site_url
}

output "cloudfront_distribution_id" {
  description = "For `aws cloudfront create-invalidation` at the end of a deploy."
  value       = module.web.distribution_id
}

output "web_bucket_name" {
  description = "Bucket `next build`'s output is synced to."
  value       = module.web.bucket_name
}

output "api_endpoint" {
  description = "The HTTP API's own URL. Readers reach it through the CDN at /api/* instead."
  value       = module.api.api_endpoint
}

output "api_function_name" {
  description = "Lambda function name, for `aws logs tail`."
  value       = module.api.function_name
}

output "ecr_repository_url" {
  description = "Registry deploy.yml pushes the API image to."
  value       = module.api.ecr_repository_url
}

output "alerts_topic_arn" {
  description = "SNS topic the budget and 5xx alarms publish to."
  value       = module.observability.alerts_topic_arn
}

output "pending_email_confirmations" {
  description = "Alarm recipients who still have to click the confirmation link AWS emailed."
  value       = module.observability.pending_email_confirmations
}
