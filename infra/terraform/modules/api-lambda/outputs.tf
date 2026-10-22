output "api_endpoint" {
  description = "Base URL of the HTTP API, e.g. https://abc123.execute-api.eu-west-1.amazonaws.com."
  value       = aws_apigatewayv2_api.api.api_endpoint
}

output "api_id" {
  description = "HTTP API id. The 5xx alarm in modules/observability keys off it."
  value       = aws_apigatewayv2_api.api.id
}

output "function_name" {
  description = "Lambda function name."
  value       = aws_lambda_function.api.function_name
}

output "function_arn" {
  description = "Lambda function ARN."
  value       = aws_lambda_function.api.arn
}

output "ecr_repository_url" {
  description = "Registry to push the `lambda` target of apps/api/Dockerfile to."
  value       = aws_ecr_repository.api.repository_url
}

output "ecr_repository_name" {
  description = "Registry name, for `aws ecr` commands in deploy.yml."
  value       = aws_ecr_repository.api.name
}

output "log_group_name" {
  description = "Log group the function writes to."
  value       = aws_cloudwatch_log_group.api.name
}
