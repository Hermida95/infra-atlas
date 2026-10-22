# Bootstrap: the two things that must exist before CI can run Terraform at all.
#
#   1. The S3 bucket every environment keeps its state in.
#   2. The GitHub OIDC provider, plus the plan/apply roles CI assumes through it.
#
# It is applied once, by hand, with your own credentials (see README.md). Nothing in CI
# touches this directory: the roles CI uses are created here, so CI cannot create them.

data "aws_caller_identity" "current" {}
data "aws_partition" "current" {}

locals {
  github_repository = "${var.github_owner}/${var.github_repo}"
  oidc_provider_arn = var.create_oidc_provider ? aws_iam_openid_connect_provider.github[0].arn : var.existing_oidc_provider_arn

  default_plan_subjects = [
    # Every pull request: `terraform plan` comments on the PR (decision 9).
    "repo:${local.github_repository}:pull_request",
    # Pushes to main: the plan the apply job then runs.
    "repo:${local.github_repository}:ref:refs/heads/main",
  ]
}

# --------------------------------------------------------------------------------------------
# State bucket
# --------------------------------------------------------------------------------------------

# Private, versioned, encrypted, TLS-only. Public access is blocked on the bucket itself, by
# the aws_s3_bucket_public_access_block below; there is no account-level block in this
# configuration, because Terraform's aws_s3_account_public_access_block is an account-wide
# resource and this stack is not the only thing that may ever live in the account. Turning it
# on from the console is one click and is worth doing -- it is just not a thing this code can
# claim. The bucket holds every resource id, name and non-sensitive attribute of the whole
# deployment.
# AWS-0089 is checkov's CKV_AWS_18: no server access logging. Reason inside the block.
#trivy:ignore:AVD-AWS-0089
resource "aws_s3_bucket" "state" {
  # checkov:skip=CKV_AWS_18:Server access logging needs a second bucket whose own storage and
  # request costs are billed forever. CloudTrail data events on this one bucket are the cheaper
  # audit trail and are enabled from the console when the account is set up.
  # checkov:skip=CKV_AWS_144:Cross-region replication doubles storage cost for a state file that
  # is already versioned and reproducible from this repo. Not worth it on a 1-5 EUR/month budget.
  # checkov:skip=CKV2_AWS_62:Event notifications need an SNS topic or Lambda per bucket; nothing
  # consumes state-change events here.
  # checkov:skip=CKV_AWS_145:AES256, which is what the S3 backend actually writes with
  # `encrypt = true`. See the comment on
  # aws_s3_bucket_server_side_encryption_configuration.state below.
  bucket = var.state_bucket_name

  # Losing the state is recoverable (every resource is importable); losing it *silently* is not.
  lifecycle {
    prevent_destroy = true
  }
}

resource "aws_s3_bucket_versioning" "state" {
  bucket = aws_s3_bucket.state.id

  versioning_configuration {
    status = "Enabled"
  }
}

# AES256 (SSE-S3), because that is what actually ends up on the objects whatever is written
# here: `encrypt = true` in the backend block of envs/*/versions.tf, with no kms_key_id beside
# it, makes Terraform send `x-amz-server-side-encryption: AES256` on every state PUT, and a
# request header wins over the bucket default. A default of `aws:kms` would therefore have
# described something that never happened -- and if it ever did take effect, the plan and
# apply roles would need kms:Decrypt and kms:GenerateDataKey on the key to read their own
# state, which modules/github-oidc does not grant.
#
# A customer-managed key is the other coherent answer, at 1 USD/month plus `kms_key_id` in
# every backend block and two more actions in both roles, to encrypt a state file that holds
# no secrets (decision 10 puts those in SSM Parameter Store).
#
# Trivy's AWS-0132 asks for KMS here and checkov's CKV_AWS_145 asks for it on the bucket
# above, which is where that skip lives. Reasons on both.
#trivy:ignore:AVD-AWS-0132
resource "aws_s3_bucket_server_side_encryption_configuration" "state" {
  bucket = aws_s3_bucket.state.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_public_access_block" "state" {
  bucket = aws_s3_bucket.state.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# BucketOwnerEnforced switches ACLs off entirely: object ownership can no longer be handed to
# another account by whoever uploads, and ACL-based public access becomes impossible.
resource "aws_s3_bucket_ownership_controls" "state" {
  bucket = aws_s3_bucket.state.id

  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "state" {
  bucket = aws_s3_bucket.state.id

  rule {
    id     = "expire-noncurrent-state-versions"
    status = "Enabled"

    filter {}

    noncurrent_version_expiration {
      noncurrent_days = var.state_noncurrent_version_retention_days
    }
  }

  rule {
    id     = "abort-incomplete-uploads"
    status = "Enabled"

    filter {}

    # A state upload interrupted halfway leaves parts that are billed but invisible in the
    # object list.
    abort_incomplete_multipart_upload {
      days_after_initiation = 7
    }
  }

  depends_on = [aws_s3_bucket_versioning.state]
}

# Decision 10: TLS everywhere. The first statement rejects plain HTTP, the second rejects
# TLS 1.0 and 1.1, which S3 still accepts by default.
data "aws_iam_policy_document" "state_tls_only" {
  statement {
    sid    = "DenyUnencryptedTransport"
    effect = "Deny"

    principals {
      type        = "*"
      identifiers = ["*"]
    }

    actions = ["s3:*"]

    resources = [
      aws_s3_bucket.state.arn,
      "${aws_s3_bucket.state.arn}/*",
    ]

    condition {
      test     = "Bool"
      variable = "aws:SecureTransport"
      values   = ["false"]
    }
  }

  statement {
    sid    = "DenyOutdatedTlsVersions"
    effect = "Deny"

    principals {
      type        = "*"
      identifiers = ["*"]
    }

    actions = ["s3:*"]

    resources = [
      aws_s3_bucket.state.arn,
      "${aws_s3_bucket.state.arn}/*",
    ]

    condition {
      test     = "NumericLessThan"
      variable = "s3:TlsVersion"
      values   = ["1.2"]
    }
  }
}

resource "aws_s3_bucket_policy" "state" {
  bucket = aws_s3_bucket.state.id
  policy = data.aws_iam_policy_document.state_tls_only.json

  # Attaching a Deny policy before public access is blocked would leave a window where the
  # bucket exists with neither.
  depends_on = [aws_s3_bucket_public_access_block.state]
}

# --------------------------------------------------------------------------------------------
# Permissions boundary for runtime roles
# --------------------------------------------------------------------------------------------

# The ceiling for every role the pipeline creates (today: the API Lambda's execution role).
# A boundary is not a grant: it is the maximum of what a role can ever be given, whatever its
# own policy says. Combined with the IAM conditions in modules/github-oidc, the apply role can
# create roles but cannot create a powerful one.
data "aws_iam_policy_document" "execution_boundary" {
  # checkov:skip=CKV_AWS_111:A permissions boundary is a ceiling, not a grant: it is applied
  # to roles that do not exist yet, so it cannot name their resources. It grants nobody
  # anything on its own.
  # checkov:skip=CKV_AWS_356:Same reason. logs:PutLogEvents, xray:PutTraceSegments and
  # bedrock:InvokeModel are also three of the actions AWS gives no useful resource form for
  # at the time a boundary is written.
  statement {
    sid    = "LogsAndTracingOnly"
    effect = "Allow"

    actions = [
      "logs:CreateLogStream",
      "logs:PutLogEvents",
      "xray:PutTelemetryRecords",
      "xray:PutTraceSegments",
    ]

    resources = ["*"]
  }

  # Phase 3 (RAG with Claude on Bedrock, decision 6). Inside the ceiling from the start so the
  # boundary does not have to be edited under pressure the day the feature lands; the Lambda
  # execution role still only gets what its own policy grants, which today is logs.
  statement {
    sid       = "BedrockInference"
    effect    = "Allow"
    actions   = ["bedrock:InvokeModel"]
    resources = ["*"]
  }
}

resource "aws_iam_policy" "execution_boundary" {
  name        = "${var.project}-execution-boundary"
  description = "Maximum permissions any role created by the ${var.project} pipeline can hold."
  policy      = data.aws_iam_policy_document.execution_boundary.json
}

# --------------------------------------------------------------------------------------------
# GitHub OIDC
# --------------------------------------------------------------------------------------------

# The trust anchor for decision 9: GitHub Actions exchanges a signed job token for temporary
# AWS credentials, so the repository stores no AWS access keys at all.
#
# thumbprint_list is deliberately absent: since mid-2023 AWS verifies this well-known issuer
# against its own trust store and fills the field in. Pinning it by hand only creates an
# outage the day GitHub rotates its certificate.
resource "aws_iam_openid_connect_provider" "github" {
  count = var.create_oidc_provider ? 1 : 0

  url            = "https://token.actions.githubusercontent.com"
  client_id_list = ["sts.amazonaws.com"]

  lifecycle {
    ignore_changes = [thumbprint_list]
  }
}

# One plan role and one apply role per environment. They are created here, not in envs/,
# because CI needs them to exist before it can run anything in envs/.
module "deploy_roles" {
  source = "../modules/github-oidc"

  for_each = var.environments

  project           = var.project
  environment       = each.key
  github_repository = local.github_repository
  oidc_provider_arn = local.oidc_provider_arn

  plan_subjects      = coalesce(each.value.plan_subjects, local.default_plan_subjects)
  github_environment = each.key
  apply_ref          = each.value.apply_ref

  state_bucket_arn = aws_s3_bucket.state.arn
  state_key_prefix = "envs/${each.key}/"

  permissions_boundary_arn = aws_iam_policy.execution_boundary.arn

  aws_partition  = data.aws_partition.current.partition
  aws_account_id = data.aws_caller_identity.current.account_id
}
