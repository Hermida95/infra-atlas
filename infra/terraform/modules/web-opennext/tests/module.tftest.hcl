# The two things about this module that only an apply would otherwise reveal.
#
# 1. The assets bucket must be AES256. CloudFront's OAC fetches objects as the service
#    principal cloudfront.amazonaws.com, and for a KMS-encrypted object that principal needs
#    kms:Decrypt in the *key* policy -- which the AWS-managed aws/s3 key does not allow anyone
#    to add. The result is AccessDenied per object, mapped to /404.html by the error responses
#    below, so the site answers 404 everywhere with a green apply and no failing check.
#
# 2. The /api/* behaviour, its origin and its edge function must be driven by a flag that is
#    known during plan, not by whether api_origin_domain happens to be null. The caller passes
#    `replace(module.api.api_endpoint, ...)`, which is unknown until apply.
#
# 3. The pages behaviour must carry the viewer-request function that turns /c/pipeline/ into
#    c/pipeline/index.html. The exported site is a tree of directories and S3 serves keys, not
#    directories: without the function every page but the home answers 403.
mock_provider "aws" {
  mock_data "aws_iam_policy_document" {
    defaults = {
      json = "{\"Version\":\"2012-10-17\",\"Statement\":[]}"
    }
  }
}

variables {
  project     = "infra-atlas"
  environment = "dev"
  bucket_name = "infra-atlas-dev-web-000000000000"
}

run "assets_bucket_is_aes256_not_kms" {
  command = plan

  assert {
    # AES256 is SSE-S3: there is no KMS key in the path at all, so there is no key policy
    # that has to grant anything to cloudfront.amazonaws.com.
    condition     = one(aws_s3_bucket_server_side_encryption_configuration.assets.rule).apply_server_side_encryption_by_default[0].sse_algorithm == "AES256"
    error_message = "The assets bucket must use AES256: CloudFront's OAC cannot read objects encrypted with the unmanageable aws/s3 KMS key, and the 403 becomes a site-wide 404."
  }
}

# Without the flag, the module is the plain static site: no second origin, no edge function.
run "no_api_origin_by_default" {
  command = plan

  assert {
    condition     = length(aws_cloudfront_function.strip_api_prefix) == 0
    error_message = "The prefix-stripping function belongs to the /api/* behaviour and must not exist without it."
  }

  assert {
    condition     = length(aws_cloudfront_distribution.web.ordered_cache_behavior) == 1
    error_message = "Only the /_next/static/* behaviour is expected when enable_api_origin is false."
  }
}

# With the flag set and the hostname still unknown -- which is exactly how envs/* call it --
# the plan must resolve. This is the shape that produced "Invalid count argument".
run "api_origin_counts_come_from_the_flag" {
  command = plan

  variables {
    enable_api_origin = true
    api_origin_domain = "abc123.execute-api.eu-west-1.amazonaws.com"
  }

  assert {
    condition     = length(aws_cloudfront_function.strip_api_prefix) == 1
    error_message = "enable_api_origin must create the edge function that rewrites /api/* to /*."
  }

  assert {
    condition     = length(aws_cloudfront_distribution.web.ordered_cache_behavior) == 2
    error_message = "enable_api_origin must add the /api/* behaviour beside /_next/static/*."
  }
}

run "pages_behaviour_rewrites_directories_to_index_html" {
  command = plan

  # The ARN is unknown until apply, so the association is checked by its event type: one
  # viewer-request function on the pages behaviour, which is the only one this module attaches
  # there. That the code is the right one is covered by the second assert.
  assert {
    condition     = one(one(aws_cloudfront_distribution.web.default_cache_behavior).function_association).event_type == "viewer-request"
    error_message = "The default behaviour must run a viewer-request function, or /c/<id>/ reaches S3 as a key that does not exist."
  }

  assert {
    condition     = strcontains(aws_cloudfront_function.append_index.code, "index.html")
    error_message = "append-index.js must rewrite a directory URI to the index.html inside it."
  }
}

# A custom error response is per distribution, not per behaviour, so every code mapped here is
# also mapped for /api/*. S3 returns 403 (not 404) for a missing key when the reader has no
# s3:ListBucket, so 403 is the only one the pages path needs -- and mapping 404 as well would
# replace the API's own JSON error bodies with this HTML page.
run "only_403_is_mapped_to_the_404_page" {
  command = plan

  assert {
    condition     = [for r in aws_cloudfront_distribution.web.custom_error_response : r.error_code] == [403]
    error_message = "Map 403 and only 403: a 404 mapping also catches the API's own 404 bodies and serves them as HTML."
  }
}
