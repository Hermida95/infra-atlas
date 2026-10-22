output "bucket_name" {
  description = "Assets bucket. deploy.yml syncs `next build`'s output here."
  value       = aws_s3_bucket.assets.id
}

output "bucket_arn" {
  description = "Assets bucket ARN."
  value       = aws_s3_bucket.assets.arn
}

output "distribution_id" {
  description = "Distribution id, for `aws cloudfront create-invalidation` after a deploy."
  value       = aws_cloudfront_distribution.web.id
}

output "distribution_domain_name" {
  description = "The *.cloudfront.net name the site answers on until a domain is pointed at it."
  value       = aws_cloudfront_distribution.web.domain_name
}

output "distribution_hosted_zone_id" {
  description = "Zone id for the Route 53 alias record, when there is a domain."
  value       = aws_cloudfront_distribution.web.hosted_zone_id
}

output "site_url" {
  description = "The URL to open. Also the origin the API's CORS_ORIGINS has to allow."
  value       = "https://${length(var.aliases) > 0 ? var.aliases[0] : aws_cloudfront_distribution.web.domain_name}"
}

output "response_headers_policy_id" {
  description = "Security headers policy, so the SSR behaviour of phase 3 can reuse it."
  value       = aws_cloudfront_response_headers_policy.security.id
}
