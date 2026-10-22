# Phase 1 of decision 2: the statically generated pages of apps/web on S3, served by
# CloudFront. The bucket is private -- the only thing that can read it is this distribution,
# through an Origin Access Control -- so there is no website endpoint and no public bucket.
#
#   browser --HTTPS--> CloudFront --OAC--> S3 (private)
#                          \--/api/*--> API Gateway (optional, same origin as the pages)
#
# The SSR Lambda of phase 3 is sketched in ssr.tf and deliberately not built.

locals {
  name = "${var.project}-${var.environment}-web"

  tags = merge(var.tags, {
    Environment = var.environment
    Component   = "web"
  })

  has_custom_domain = var.acm_certificate_arn != null && length(var.aliases) > 0
  has_api_origin    = var.api_origin_domain != null

  s3_origin_id  = "s3-assets"
  api_origin_id = "api-gateway"
}

# --------------------------------------------------------------------------------------------
# Assets bucket
# --------------------------------------------------------------------------------------------

resource "aws_s3_bucket" "assets" {
  # checkov:skip=CKV_AWS_18:Access logging needs a second bucket billed forever. The access
  # log that matters for a CDN is CloudFront's own, and that is also off for cost (see the
  # distribution below).
  # checkov:skip=CKV_AWS_144:Cross-region replication for files CI regenerates from the repo
  # on every deploy would double the storage bill to protect nothing.
  # checkov:skip=CKV2_AWS_62:Nothing consumes S3 events here.
  # checkov:skip=CKV_AWS_21:Versioning is opt-in (enable_bucket_versioning). The content is
  # built from git, so a previous version is a rebuild away.
  bucket = var.bucket_name
  tags   = local.tags
}

resource "aws_s3_bucket_public_access_block" "assets" {
  bucket = aws_s3_bucket.assets.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_ownership_controls" "assets" {
  bucket = aws_s3_bucket.assets.id

  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "assets" {
  bucket = aws_s3_bucket.assets.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "aws:kms"
    }
    bucket_key_enabled = true
  }
}

resource "aws_s3_bucket_versioning" "assets" {
  count = var.enable_bucket_versioning ? 1 : 0

  bucket = aws_s3_bucket.assets.id

  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "assets" {
  bucket = aws_s3_bucket.assets.id

  rule {
    id     = "abort-incomplete-uploads"
    status = "Enabled"

    filter {}

    abort_incomplete_multipart_upload {
      days_after_initiation = 7
    }
  }

  # Unconditional, although versioning is opt-in: a rule about noncurrent versions does
  # nothing on a bucket that has none, and leaving it out would mean that switching
  # enable_bucket_versioning on starts keeping every old asset forever.
  rule {
    id     = "expire-noncurrent-assets"
    status = "Enabled"

    filter {}

    noncurrent_version_expiration {
      noncurrent_days = 30
    }
  }
}

# --------------------------------------------------------------------------------------------
# Security headers (decision 10)
# --------------------------------------------------------------------------------------------

# A policy attached to the behaviour, not headers written by the app: the pages are static
# files on S3, so there is no server left to add them. CloudFront is the only place they can
# come from.
resource "aws_cloudfront_response_headers_policy" "security" {
  # checkov:skip=CKV_AWS_259:The check demands preload = true. HSTS preload is a one-way door
  # -- getting a domain onto the browsers' built-in list takes days and getting it off takes
  # months -- and there is no custom domain yet to put on it (docs/DECISIONES.md still lists
  # the domain as unverified). hsts_preload is the variable that turns it on when there is.
  name    = "${local.name}-security-headers"
  comment = "CSP, HSTS and the usual hardening headers for ${local.name}"

  security_headers_config {
    content_security_policy {
      content_security_policy = var.content_security_policy
      override                = true
    }

    strict_transport_security {
      access_control_max_age_sec = var.hsts_max_age_seconds
      include_subdomains         = true
      preload                    = var.hsts_preload
      override                   = true
    }

    # Stops a browser from guessing that a .json is HTML and running it as a page.
    content_type_options {
      override = true
    }

    # Redundant with frame-ancestors in the CSP above, and kept for browsers that ignore it.
    frame_options {
      frame_option = "DENY"
      override     = true
    }

    referrer_policy {
      referrer_policy = "strict-origin-when-cross-origin"
      override        = true
    }

    # X-XSS-Protection is deliberately absent: the header is deprecated, and its filter has
    # introduced vulnerabilities of its own. The CSP is the control.
  }

  custom_headers_config {
    # Not part of security_headers_config, but the same job: switch off APIs the atlas does
    # not use, so a future compromised script cannot reach them either.
    items {
      header   = "Permissions-Policy"
      value    = "accelerometer=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=()"
      override = true
    }

    items {
      header   = "Cross-Origin-Opener-Policy"
      value    = "same-origin"
      override = true
    }
  }
}

# --------------------------------------------------------------------------------------------
# Distribution
# --------------------------------------------------------------------------------------------

# OAC (SigV4), not the older Origin Access Identity: it is the only one that works with
# KMS-encrypted objects, and it is what AWS still develops.
resource "aws_cloudfront_origin_access_control" "assets" {
  name                              = "${local.name}-oac"
  description                       = "Only ${local.name} may read the assets bucket"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

# Managed policy, looked up by name rather than copied in as an opaque id.
data "aws_cloudfront_cache_policy" "caching_disabled" {
  name = "Managed-CachingDisabled"
}

# Two own cache policies instead of Managed-CachingOptimized, because the TTL is the one
# setting worth differing per environment: a minute in dev makes a deploy visible immediately,
# five minutes in prod keeps the origin quiet without making a fix wait.
#
# The cache key is the path and nothing else -- no cookies, no query strings, no headers. Every
# extra element multiplies the number of objects the edge has to store and miss on, and a
# static site has no reason to vary on any of them.
resource "aws_cloudfront_cache_policy" "pages" {
  name    = "${local.name}-pages"
  comment = "Pages of ${local.name}: short TTL, path-only cache key"

  min_ttl     = 0
  default_ttl = var.default_cache_max_age_seconds
  max_ttl     = var.default_cache_max_age_seconds

  parameters_in_cache_key_and_forwarded_to_origin {
    # Both on: the edge stores one compressed copy per encoding and serves it without asking
    # the origin, which is most of the bandwidth bill on a text-heavy site.
    enable_accept_encoding_gzip   = true
    enable_accept_encoding_brotli = true

    cookies_config {
      cookie_behavior = "none"
    }

    headers_config {
      header_behavior = "none"
    }

    query_strings_config {
      query_string_behavior = "none"
    }
  }
}

resource "aws_cloudfront_cache_policy" "static" {
  name    = "${local.name}-static"
  comment = "Hashed assets of ${local.name}: immutable, cached for a year"

  # The filenames under /_next/static carry a content hash, so a changed file is a different
  # URL and can never be stale. min_ttl as well as default: nothing should shorten this.
  min_ttl     = var.static_cache_max_age_seconds
  default_ttl = var.static_cache_max_age_seconds
  max_ttl     = var.static_cache_max_age_seconds

  parameters_in_cache_key_and_forwarded_to_origin {
    enable_accept_encoding_gzip   = true
    enable_accept_encoding_brotli = true

    cookies_config {
      cookie_behavior = "none"
    }

    headers_config {
      header_behavior = "none"
    }

    query_strings_config {
      query_string_behavior = "none"
    }
  }
}

data "aws_cloudfront_origin_request_policy" "all_viewer_except_host" {
  name = "Managed-AllViewerExceptHostHeader"
}

# Strips the /api prefix before the request reaches API Gateway: FastAPI routes /search, not
# /api/search. See functions/strip-api-prefix.js for why this lives at the edge rather than in
# the application.
resource "aws_cloudfront_function" "strip_api_prefix" {
  count = local.has_api_origin ? 1 : 0

  name    = "${local.name}-strip-api-prefix"
  runtime = "cloudfront-js-2.0"
  comment = "Rewrite /api/* to /* for the ${local.name} API origin"
  publish = true
  code    = file("${path.module}/functions/strip-api-prefix.js")
}

resource "aws_cloudfront_distribution" "web" {
  # checkov:skip=CKV_AWS_374:No geo restriction. The atlas is public technical writing in
  # English for a European job market; blocking countries would hide it from its readers.
  # checkov:skip=CKV_AWS_310:No origin failover. A failover group needs a second origin
  # holding a second copy of the site, which is a second bucket to pay for and keep in sync.
  # S3's own durability and availability are the answer at this size.
  # checkov:skip=CKV_AWS_68:No WAF. A web ACL bills about 5 USD/month plus per-rule and
  # per-request charges before a single visitor arrives, which is the entire 1-5 EUR/month
  # budget (docs/DECISIONES.md). The exposure is a read-only static site; the API behind it
  # is throttled and concurrency-capped in modules/api-lambda.
  # checkov:skip=CKV_AWS_86:Access logging writes every request into S3, billed per GB stored
  # and per request. CloudFront's free standard metrics are enough to see traffic here.
  # checkov:skip=CKV_AWS_174:The TLS floor is TLSv1.2_2021 as soon as there is a certificate.
  # Without a custom domain AWS serves the shared *.cloudfront.net certificate and pins the
  # policy itself, so the setting below is the only legal value.
  # checkov:skip=CKV2_AWS_32:The response headers policy above is attached to every behaviour.
  # checkov:skip=CKV2_AWS_47:Log4Shell WAF rules need a WAF; see CKV_AWS_68.
  enabled             = true
  is_ipv6_enabled     = true
  comment             = "${local.name} (${var.environment})"
  default_root_object = "index.html"
  price_class         = var.price_class
  aliases             = var.aliases

  origin {
    origin_id                = local.s3_origin_id
    domain_name              = aws_s3_bucket.assets.bucket_regional_domain_name
    origin_access_control_id = aws_cloudfront_origin_access_control.assets.id
  }

  dynamic "origin" {
    for_each = local.has_api_origin ? [var.api_origin_domain] : []

    content {
      origin_id   = local.api_origin_id
      domain_name = origin.value

      custom_origin_config {
        http_port              = 80
        https_port             = 443
        origin_protocol_policy = "https-only"
        origin_ssl_protocols   = ["TLSv1.2"]
      }
    }
  }

  # Pages. Short TTL so a deploy shows up without paying for an invalidation on every push
  # (the first 1000 invalidation paths a month are free, and OpenNext deploys can burn them).
  default_cache_behavior {
    target_origin_id       = local.s3_origin_id
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["GET", "HEAD", "OPTIONS"]
    cached_methods         = ["GET", "HEAD"]
    compress               = true

    cache_policy_id            = aws_cloudfront_cache_policy.pages.id
    response_headers_policy_id = aws_cloudfront_response_headers_policy.security.id
  }

  # /_next/static/* carries a content hash in the filename, so it is immutable: cache it for
  # a year at the edge and in the browser.
  ordered_cache_behavior {
    path_pattern           = "/_next/static/*"
    target_origin_id       = local.s3_origin_id
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["GET", "HEAD"]
    cached_methods         = ["GET", "HEAD"]
    compress               = true

    cache_policy_id            = aws_cloudfront_cache_policy.static.id
    response_headers_policy_id = aws_cloudfront_response_headers_policy.security.id
  }

  # /api/* straight through to API Gateway, uncached: same origin as the pages, so the
  # browser's CORS preflight never happens and the CSP stays at connect-src 'self'.
  dynamic "ordered_cache_behavior" {
    for_each = local.has_api_origin ? [1] : []

    content {
      path_pattern           = "/api/*"
      target_origin_id       = local.api_origin_id
      viewer_protocol_policy = "redirect-to-https"
      allowed_methods        = ["GET", "HEAD", "OPTIONS", "PUT", "POST", "PATCH", "DELETE"]
      cached_methods         = ["GET", "HEAD"]
      compress               = true

      cache_policy_id = data.aws_cloudfront_cache_policy.caching_disabled.id
      # AllViewerExceptHostHeader: API Gateway rejects a Host header that is not its own.
      origin_request_policy_id = data.aws_cloudfront_origin_request_policy.all_viewer_except_host.id

      function_association {
        event_type   = "viewer-request"
        function_arn = aws_cloudfront_function.strip_api_prefix[0].arn
      }
    }
  }

  # A private bucket returns 403, not 404, for a key that does not exist, so both map to the
  # app's own 404 page. 404.html is what `next build` emits for App Router not-found.
  custom_error_response {
    error_code            = 403
    response_code         = 404
    response_page_path    = "/404.html"
    error_caching_min_ttl = 60
  }

  custom_error_response {
    error_code            = 404
    response_code         = 404
    response_page_path    = "/404.html"
    error_caching_min_ttl = 60
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  # A custom domain needs a certificate: with the default *.cloudfront.net certificate, AWS
  # rejects any alias. Caught here rather than halfway through an apply, because the
  # distribution is the slowest resource in the stack to create and to roll back.
  lifecycle {
    precondition {
      condition     = length(var.aliases) == 0 || var.acm_certificate_arn != null
      error_message = "aliases needs acm_certificate_arn: CloudFront cannot serve a custom domain with its default certificate."
    }
  }

  viewer_certificate {
    cloudfront_default_certificate = local.has_custom_domain ? null : true
    acm_certificate_arn            = local.has_custom_domain ? var.acm_certificate_arn : null
    ssl_support_method             = local.has_custom_domain ? "sni-only" : null
    minimum_protocol_version       = local.has_custom_domain ? "TLSv1.2_2021" : "TLSv1"
  }

  tags = local.tags
}

# The only way into the bucket. AWS:SourceArn means a *different* distribution, even in this
# account, cannot read it by presenting the CloudFront service principal.
data "aws_iam_policy_document" "assets" {
  statement {
    sid     = "AllowCloudFrontRead"
    effect  = "Allow"
    actions = ["s3:GetObject"]

    principals {
      type        = "Service"
      identifiers = ["cloudfront.amazonaws.com"]
    }

    resources = ["${aws_s3_bucket.assets.arn}/*"]

    condition {
      test     = "StringEquals"
      variable = "AWS:SourceArn"
      values   = [aws_cloudfront_distribution.web.arn]
    }
  }

  statement {
    sid    = "DenyUnencryptedTransport"
    effect = "Deny"

    principals {
      type        = "*"
      identifiers = ["*"]
    }

    actions = ["s3:*"]

    resources = [
      aws_s3_bucket.assets.arn,
      "${aws_s3_bucket.assets.arn}/*",
    ]

    condition {
      test     = "Bool"
      variable = "aws:SecureTransport"
      values   = ["false"]
    }
  }
}

resource "aws_s3_bucket_policy" "assets" {
  bucket = aws_s3_bucket.assets.id
  policy = data.aws_iam_policy_document.assets.json

  depends_on = [aws_s3_bucket_public_access_block.assets]
}
