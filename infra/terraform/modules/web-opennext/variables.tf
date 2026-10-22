variable "project" {
  description = "Name prefix for every resource."
  type        = string
}

variable "environment" {
  description = "Environment name (dev, prod)."
  type        = string
}

variable "bucket_name" {
  description = <<-EOT
    Name of the assets bucket. S3 bucket names are globally unique, so there is no default.
    It must start with "<project>-<environment>-" or the pipeline's apply role cannot manage
    it (see modules/github-oidc).
  EOT
  type        = string
}

variable "enable_api_origin" {
  description = <<-EOT
    Add the /api/* behaviour, its origin and the edge function that strips the prefix.

    This is a separate flag rather than `api_origin_domain != null`, and the reason is the one
    Terraform rule that `validate` cannot catch: `count` and `dynamic` have to be resolvable
    during `plan`, and api_origin_domain is normally
    `replace(module.api.api_endpoint, "https://", "")` -- an attribute of an API Gateway that
    does not exist yet, so it is unknown until `apply`. Deriving the three conditionals below
    from it gives a configuration that passes `fmt`, `validate`, `tflint` and `checkov` and
    then fails the first `plan` of a new environment with "Invalid count argument".

    The flag is set literally in envs/*/main.tf, so it is known at plan time; the *value* of
    api_origin_domain may stay unknown, which is fine -- an argument can be unknown, the
    number of blocks cannot.
  EOT
  type        = bool
  default     = false
}

variable "api_origin_domain" {
  description = <<-EOT
    Hostname of the API Gateway endpoint, without the scheme, so /api/* is served from the
    same origin as the pages and the browser never makes a cross-origin request.

    Only read when enable_api_origin is true, and it may be an unknown value at plan time.
  EOT
  type        = string
  default     = null
}

variable "aliases" {
  description = <<-EOT
    Custom domains served by the distribution. Requires acm_certificate_arn. Empty means the
    distribution answers only on its own *.cloudfront.net name, which is what it does until a
    domain is bought (docs/DECISIONES.md still lists the domain as unverified).
  EOT
  type        = list(string)
  default     = []
}

variable "acm_certificate_arn" {
  description = <<-EOT
    Certificate for `aliases`. CloudFront only reads certificates from us-east-1, whatever
    region the rest of the stack lives in. Null uses the default *.cloudfront.net certificate,
    which cannot serve a custom domain and forces the TLS floor down to TLSv1 -- AWS pins the
    policy for that certificate and refuses a stricter one.
  EOT
  type        = string
  default     = null

  validation {
    condition     = var.acm_certificate_arn == null || can(regex("^arn:aws[a-z-]*:acm:us-east-1:", var.acm_certificate_arn))
    error_message = "Must be an ACM certificate in us-east-1: CloudFront reads them from nowhere else."
  }
}

variable "price_class" {
  description = <<-EOT
    PriceClass_100 is Europe and North America only -- the cheapest tier, and where the
    readers are. PriceClass_All adds Asia and South America at a higher per-GB rate.
  EOT
  type        = string
  default     = "PriceClass_100"

  validation {
    condition     = contains(["PriceClass_100", "PriceClass_200", "PriceClass_All"], var.price_class)
    error_message = "One of PriceClass_100, PriceClass_200, PriceClass_All."
  }
}

variable "content_security_policy" {
  description = <<-EOT
    CSP sent on every response (decision 10). The default is what the web app needs today:
    Next.js inlines its hydration script, three.js compiles shaders from blobs, and the API
    is called over XHR, so 'self' plus the API origin.

    It is a variable because a CSP that does not match the app breaks the page silently in
    the browser rather than loudly in CI, so it has to be easy to adjust per environment.
  EOT
  type        = string
  default     = "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; worker-src 'self' blob:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'; upgrade-insecure-requests"
}

variable "hsts_max_age_seconds" {
  description = <<-EOT
    Strict-Transport-Security max-age. One year is the usual production value. Note what HSTS
    is: a promise the browser remembers. Sending a long max-age from a domain that later has
    to serve plain HTTP locks visitors out until it expires.
  EOT
  type        = number
  default     = 31536000
}

variable "hsts_preload" {
  description = <<-EOT
    Ask browsers to ship the domain in their preload list. Off by default: getting onto the
    list is easy and getting off it takes months.
  EOT
  type        = bool
  default     = false
}

variable "static_cache_max_age_seconds" {
  description = <<-EOT
    Cache lifetime for /_next/static/*. Those filenames carry a content hash, so they can be
    cached effectively forever; the header is what keeps a repeat visit from costing a request.
  EOT
  type        = number
  default     = 31536000
}

variable "default_cache_max_age_seconds" {
  description = "Cache lifetime for pages. Short, so a deploy is visible without an invalidation."
  type        = number
  default     = 300
}

variable "enable_bucket_versioning" {
  description = <<-EOT
    Keep previous versions of the uploaded assets. Off: the assets are rebuilt from the repo
    by CI, so versions cost storage to duplicate something git already has.
  EOT
  type        = bool
  default     = false
}

variable "tags" {
  description = "Extra tags, merged on top of the provider's default_tags."
  type        = map(string)
  default     = {}
}
