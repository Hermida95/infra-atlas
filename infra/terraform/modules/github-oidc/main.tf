# Two roles per environment, because "the pipeline can deploy" and "the pipeline can read" are
# very different amounts of trust:
#
#   <project>-<env>-gha-plan   assumable from any PR. Read-only. Cannot write state.
#   <project>-<env>-gha-apply  assumable only from a GitHub environment. Creates and destroys.
#
# A pull request from a fork never gets either: the `sub` claim carries the *base* repository,
# but fork PRs run with a token whose claims GitHub restricts, and the plan role's subject list
# is pinned to repo:<owner/repo>:pull_request of this repository.

locals {
  name_prefix = "${var.project}-${var.environment}"

  # Resources the apply role is allowed to manage. Everything is name-prefixed so one
  # environment's pipeline cannot touch another's, and neither can touch anything else in
  # the account.
  arn = {
    lambda = "arn:${var.aws_partition}:lambda:*:${var.aws_account_id}:function:${local.name_prefix}-*"
    # <project>-<env>*, not <project>*: the latter also matched the other environment's
    # registry, so dev's pipeline could push to prod's (modules/api-lambda names the
    # repository <project>-<env>/api).
    ecr        = "arn:${var.aws_partition}:ecr:*:${var.aws_account_id}:repository/${local.name_prefix}*"
    logs       = "arn:${var.aws_partition}:logs:*:${var.aws_account_id}:log-group:*${local.name_prefix}*"
    iam_role   = "arn:${var.aws_partition}:iam::${var.aws_account_id}:role/${local.name_prefix}-*"
    sns        = "arn:${var.aws_partition}:sns:*:${var.aws_account_id}:${local.name_prefix}-*"
    alarm      = "arn:${var.aws_partition}:cloudwatch:*:${var.aws_account_id}:alarm:${local.name_prefix}-*"
    budget     = "arn:${var.aws_partition}:budgets::${var.aws_account_id}:budget/${local.name_prefix}-*"
    apigateway = "arn:${var.aws_partition}:apigateway:*::/*"
    # Buckets this environment owns. Deliberately narrower than "${var.project}-*", which
    # would also match the state bucket (infra-atlas-tfstate-...).
    bucket     = "arn:${var.aws_partition}:s3:::${local.name_prefix}-*"
    bucket_obj = "arn:${var.aws_partition}:s3:::${local.name_prefix}-*/*"
  }

  # Read verbs only, per service. Refresh needs to see the world; neither role needs to see
  # it outside these services.
  read_actions = [
    "apigateway:GET",
    "budgets:ViewBudget",
    "budgets:DescribeBudget",
    "budgets:DescribeBudgets",
    "cloudfront:Describe*",
    "cloudfront:Get*",
    "cloudfront:List*",
    "cloudwatch:DescribeAlarms",
    "cloudwatch:ListTagsForResource",
    "ecr:Describe*",
    "ecr:GetLifecyclePolicy",
    "ecr:GetRepositoryPolicy",
    "ecr:List*",
    "iam:GetOpenIDConnectProvider",
    "iam:GetPolicy",
    "iam:GetPolicyVersion",
    "iam:GetRole",
    "iam:GetRolePolicy",
    "iam:ListAttachedRolePolicies",
    "iam:ListOpenIDConnectProviders",
    "iam:ListRolePolicies",
    "iam:ListRoleTags",
    "iam:ListRoles",
    "kms:DescribeKey",
    "kms:ListAliases",
    "lambda:Get*",
    "lambda:List*",
    "logs:Describe*",
    "logs:ListTagsForResource",
    "s3:Get*",
    "s3:List*",
    "sns:Get*",
    "sns:List*",
    "sts:GetCallerIdentity",
    "tag:GetResources",
  ]
}

# --------------------------------------------------------------------------------------------
# Trust policies: who may turn a GitHub job token into AWS credentials
# --------------------------------------------------------------------------------------------

data "aws_iam_policy_document" "plan_trust" {
  statement {
    sid     = "GitHubActionsPlan"
    effect  = "Allow"
    actions = ["sts:AssumeRoleWithWebIdentity"]

    principals {
      type        = "Federated"
      identifiers = [var.oidc_provider_arn]
    }

    # Without the audience check, a token minted for any other service that trusts the same
    # issuer would be accepted here.
    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values   = ["sts.amazonaws.com"]
    }

    # The subject is the branch/PR/environment restriction. StringLike, because a subject may
    # legitimately end in * (e.g. one role for every release tag).
    condition {
      test     = "StringLike"
      variable = "token.actions.githubusercontent.com:sub"
      values   = var.plan_subjects
    }
  }
}

data "aws_iam_policy_document" "apply_trust" {
  statement {
    sid     = "GitHubActionsApply"
    effect  = "Allow"
    actions = ["sts:AssumeRoleWithWebIdentity"]

    principals {
      type        = "Federated"
      identifiers = [var.oidc_provider_arn]
    }

    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values   = ["sts.amazonaws.com"]
    }

    # StringEquals, not StringLike: exactly one environment, no wildcard possible. A job that
    # does not declare `environment: <name>` gets a different subject and is refused, so the
    # approval configured on the GitHub environment is enforced by IAM, not by the workflow.
    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:sub"
      values   = ["repo:${var.github_repository}:environment:${var.github_environment}"]
    }

    # Second claim: the branch. `sub` cannot carry it once an environment is in play.
    dynamic "condition" {
      for_each = var.apply_ref == null ? [] : [var.apply_ref]

      content {
        test     = "StringEquals"
        variable = "token.actions.githubusercontent.com:ref"
        values   = [condition.value]
      }
    }
  }
}

# --------------------------------------------------------------------------------------------
# Plan role: read-only, and explicitly unable to write state
# --------------------------------------------------------------------------------------------

resource "aws_iam_role" "plan" {
  name                  = "${local.name_prefix}-gha-plan"
  description           = "terraform plan for ${var.environment} from GitHub Actions. Read-only."
  assume_role_policy    = data.aws_iam_policy_document.plan_trust.json
  max_session_duration  = var.max_session_duration
  force_detach_policies = true

  tags = merge(var.tags, {
    Environment = var.environment
    Role        = "terraform-plan"
  })
}

data "aws_iam_policy_document" "plan" {
  # checkov:skip=CKV_AWS_356:Describe/List/Get have no resource-level permissions in most of
  # these services, so a read-only policy has to be written against "*". The statement grants
  # read verbs only, and the Deny below removes the one write path that would matter.
  statement {
    sid       = "ReadEverythingThisProjectUses"
    effect    = "Allow"
    actions   = local.read_actions
    resources = ["*"]
  }

  # Belt and braces: even if the read list above ever grows a write action by accident, the
  # plan role still cannot change the state. This is also why the plan job runs with
  # -lock=false: taking an S3 lock means writing a .tflock object.
  statement {
    sid    = "NeverWriteState"
    effect = "Deny"

    actions = [
      "s3:PutObject",
      "s3:DeleteObject",
      "s3:DeleteObjectVersion",
    ]

    resources = ["${var.state_bucket_arn}/*"]
  }
}

resource "aws_iam_role_policy" "plan" {
  name   = "${local.name_prefix}-gha-plan"
  role   = aws_iam_role.plan.id
  policy = data.aws_iam_policy_document.plan.json
}

# --------------------------------------------------------------------------------------------
# Apply role: creates and destroys, but only this project's resources
# --------------------------------------------------------------------------------------------

resource "aws_iam_role" "apply" {
  name                  = "${local.name_prefix}-gha-apply"
  description           = "terraform apply for ${var.environment}, from the ${var.github_environment} GitHub environment."
  assume_role_policy    = data.aws_iam_policy_document.apply_trust.json
  max_session_duration  = var.max_session_duration
  force_detach_policies = true

  tags = merge(var.tags, {
    Environment = var.environment
    Role        = "terraform-apply"
  })
}

data "aws_iam_policy_document" "apply" {
  # checkov:skip=CKV_AWS_111:The unscoped statements are the read-only one,
  # ecr:GetAuthorizationToken, CloudFront's Create* and the log-delivery one. The first grants
  # no writes; the rest are AWS APIs with no resource-level permissions at all -- a docker
  # login token, a distribution that does not exist yet and a log delivery that does not exist
  # yet have nothing to name. Every other write is ARN-scoped to <project>-<env>-*.
  # checkov:skip=CKV_AWS_356:Same four statements, same reason.
  statement {
    sid       = "ReadEverythingThisProjectUses"
    effect    = "Allow"
    actions   = local.read_actions
    resources = ["*"]
  }

  # State. The prefix is what keeps dev out of prod's state, and it covers the .tflock object
  # `use_lockfile` writes next to the state (decision 9: native locking, no DynamoDB table).
  statement {
    sid    = "ReadWriteOwnStatePrefix"
    effect = "Allow"

    actions = [
      "s3:GetObject",
      "s3:GetObjectVersion",
      "s3:PutObject",
      "s3:DeleteObject",
    ]

    resources = ["${var.state_bucket_arn}/${var.state_key_prefix}*"]
  }

  # "env:/" is not a typo and not this project's choice: `terraform init` enumerates the
  # workspaces of an S3 backend by listing the bucket with the prefix the backend's
  # workspace_key_prefix sets, which defaults to `env:`. Without it in this list the apply
  # job dies in `init`, before it reads a single line of configuration -- and a first apply
  # run by hand with administrator credentials never sees it.
  statement {
    sid       = "ListOwnStatePrefix"
    effect    = "Allow"
    actions   = ["s3:ListBucket"]
    resources = [var.state_bucket_arn]

    condition {
      test     = "StringLike"
      variable = "s3:prefix"

      values = [
        "${var.state_key_prefix}*",
        "env:/*",
      ]
    }
  }

  # The web assets bucket. Narrowed to <project>-<env>-*, which does not match the state
  # bucket, and a Deny at the end makes that impossible to widen by accident.
  statement {
    sid    = "ManageOwnBuckets"
    effect = "Allow"

    actions = [
      "s3:CreateBucket",
      "s3:DeleteBucket",
      "s3:DeleteBucketPolicy",
      "s3:DeleteObject",
      "s3:DeleteObjectVersion",
      "s3:PutBucketAcl",
      "s3:PutBucketLogging",
      "s3:PutBucketOwnershipControls",
      "s3:PutBucketPolicy",
      "s3:PutBucketPublicAccessBlock",
      "s3:PutBucketTagging",
      "s3:PutBucketVersioning",
      "s3:PutBucketWebsite",
      "s3:PutEncryptionConfiguration",
      "s3:PutLifecycleConfiguration",
      "s3:PutObject",
    ]

    resources = [local.arn.bucket, local.arn.bucket_obj]
  }

  # ECR: the registry the API image is pushed to, and the push itself (deploy.yml builds the
  # `lambda` target of apps/api/Dockerfile with these credentials).
  statement {
    sid    = "ManageApiRegistry"
    effect = "Allow"

    actions = [
      "ecr:BatchCheckLayerAvailability",
      "ecr:BatchGetImage",
      "ecr:CompleteLayerUpload",
      "ecr:CreateRepository",
      "ecr:DeleteLifecyclePolicy",
      "ecr:DeleteRepository",
      "ecr:DeleteRepositoryPolicy",
      "ecr:GetDownloadUrlForLayer",
      "ecr:InitiateLayerUpload",
      "ecr:PutImage",
      "ecr:PutImageScanningConfiguration",
      "ecr:PutImageTagMutability",
      "ecr:PutLifecyclePolicy",
      "ecr:SetRepositoryPolicy",
      "ecr:TagResource",
      "ecr:UntagResource",
      "ecr:UploadLayerPart",
    ]

    resources = [local.arn.ecr]
  }

  # The docker login token is account-wide and has no resource-level form.
  statement {
    sid       = "EcrLogin"
    effect    = "Allow"
    actions   = ["ecr:GetAuthorizationToken"]
    resources = ["*"]
  }

  statement {
    sid    = "ManageApiFunction"
    effect = "Allow"

    actions = [
      "lambda:AddPermission",
      "lambda:CreateFunction",
      "lambda:DeleteFunction",
      "lambda:DeleteFunctionConcurrency",
      "lambda:PutFunctionConcurrency",
      "lambda:RemovePermission",
      "lambda:TagResource",
      "lambda:UntagResource",
      "lambda:UpdateFunctionCode",
      "lambda:UpdateFunctionConfiguration",
    ]

    resources = [local.arn.lambda]
  }

  # API Gateway resources are paths, not names (arn:aws:apigateway:eu-west-1::/apis/abc123),
  # so there is nothing to prefix-match on. The account only ever holds this project's APIs.
  statement {
    sid    = "ManageHttpApi"
    effect = "Allow"

    actions = [
      "apigateway:DELETE",
      "apigateway:PATCH",
      "apigateway:POST",
      "apigateway:PUT",
      "apigateway:TagResource",
      "apigateway:UntagResource",
    ]

    resources = [local.arn.apigateway]
  }

  statement {
    sid    = "ManageOwnLogGroups"
    effect = "Allow"

    actions = [
      "logs:CreateLogGroup",
      "logs:DeleteLogGroup",
      "logs:DeleteRetentionPolicy",
      "logs:PutRetentionPolicy",
      "logs:TagResource",
      "logs:UntagResource",
    ]

    resources = [local.arn.logs, "${local.arn.logs}:log-stream:*"]
  }

  # Turning on access logging for an API Gateway stage (modules/api-lambda) is not a write to
  # the log group: CloudWatch Logs creates a *log delivery* and attaches a resource policy
  # that lets API Gateway write into it. Those are separate actions, and none of them has a
  # resource-level form -- a delivery does not exist yet when it is created, and a resource
  # policy is an account-wide object. Without this statement the apply fails on
  # aws_apigatewayv2_stage with AccessDeniedException on logs:CreateLogDelivery, after the
  # function and the API have already been created.
  statement {
    sid    = "ManageAccessLogDelivery"
    effect = "Allow"

    actions = [
      "logs:CreateLogDelivery",
      "logs:DeleteLogDelivery",
      "logs:DescribeResourcePolicies",
      "logs:GetLogDelivery",
      "logs:ListLogDeliveries",
      "logs:PutResourcePolicy",
      "logs:UpdateLogDelivery",
    ]

    resources = ["*"]
  }

  # CloudFront has no resource-level permissions for Create*: a distribution id does not exist
  # until it is created. Nothing else in the account uses CloudFront.
  statement {
    sid    = "ManageCdn"
    effect = "Allow"

    actions = [
      "cloudfront:CreateCachePolicy",
      "cloudfront:CreateDistribution",
      "cloudfront:CreateFunction",
      "cloudfront:CreateInvalidation",
      "cloudfront:CreateOriginAccessControl",
      "cloudfront:CreateResponseHeadersPolicy",
      "cloudfront:DeleteCachePolicy",
      "cloudfront:DeleteDistribution",
      "cloudfront:DeleteFunction",
      "cloudfront:DeleteOriginAccessControl",
      "cloudfront:DeleteResponseHeadersPolicy",
      "cloudfront:TagResource",
      "cloudfront:UntagResource",
      "cloudfront:UpdateCachePolicy",
      "cloudfront:PublishFunction",
      "cloudfront:UpdateDistribution",
      "cloudfront:UpdateFunction",
      "cloudfront:UpdateOriginAccessControl",
      "cloudfront:UpdateResponseHeadersPolicy",
    ]

    resources = ["*"]
  }

  statement {
    sid    = "ManageCostAlarms"
    effect = "Allow"

    actions = [
      "budgets:CreateBudget",
      "budgets:DeleteBudget",
      "budgets:ModifyBudget",
      "budgets:TagResource",
      "budgets:UntagResource",
    ]

    resources = [local.arn.budget]
  }

  statement {
    sid    = "ManageMetricAlarms"
    effect = "Allow"

    actions = [
      "cloudwatch:DeleteAlarms",
      "cloudwatch:PutMetricAlarm",
      "cloudwatch:TagResource",
      "cloudwatch:UntagResource",
    ]

    resources = [local.arn.alarm]
  }

  statement {
    sid    = "ManageAlertTopic"
    effect = "Allow"

    actions = [
      "sns:CreateTopic",
      "sns:DeleteTopic",
      "sns:SetTopicAttributes",
      "sns:Subscribe",
      "sns:TagResource",
      "sns:Unsubscribe",
      "sns:UntagResource",
    ]

    resources = [local.arn.sns]
  }

  # IAM is where a deploy role usually becomes an administrator by accident. Three limits:
  #   - only roles named <project>-<env>-*;
  #   - only inline policies (no AttachRolePolicy at all, so no managed policy -- not even
  #     AdministratorAccess -- can be attached to anything);
  #   - only roles that carry the permissions boundary, when one is configured.
  statement {
    sid    = "ManageOwnRoles"
    effect = "Allow"

    actions = [
      "iam:DeleteRole",
      "iam:DeleteRolePolicy",
      "iam:TagRole",
      "iam:UntagRole",
      "iam:UpdateAssumeRolePolicy",
      "iam:UpdateRoleDescription",
    ]

    resources = [local.arn.iam_role]
  }

  statement {
    sid    = "CreateOwnRolesWithinBoundary"
    effect = "Allow"

    actions = [
      "iam:CreateRole",
      "iam:PutRolePolicy",
    ]

    resources = [local.arn.iam_role]

    dynamic "condition" {
      for_each = var.permissions_boundary_arn == null ? [] : [var.permissions_boundary_arn]

      content {
        test     = "StringEquals"
        variable = "iam:PermissionsBoundary"
        values   = [condition.value]
      }
    }
  }

  # A Lambda function cannot be created without handing it its execution role. Restricting the
  # service it may be passed to is what stops this being "pass any of my roles anywhere".
  statement {
    sid       = "PassExecutionRoleToLambdaOnly"
    effect    = "Allow"
    actions   = ["iam:PassRole"]
    resources = [local.arn.iam_role]

    condition {
      test     = "StringEquals"
      variable = "iam:PassedToService"
      values   = ["lambda.amazonaws.com"]
    }
  }

  # Nothing above grants these, but they are the actions that would turn a pipeline compromise
  # into an account compromise, so they are denied outright: a Deny cannot be overridden by a
  # later Allow, however this policy is edited.
  statement {
    sid    = "NeverEscalate"
    effect = "Deny"

    actions = [
      "account:*",
      "iam:AttachRolePolicy",
      "iam:AttachUserPolicy",
      "iam:CreateAccessKey",
      "iam:CreateLoginProfile",
      "iam:CreateUser",
      "iam:DeleteOpenIDConnectProvider",
      "iam:DeleteRolePermissionsBoundary",
      "iam:PutRolePermissionsBoundary",
      "iam:UpdateOpenIDConnectProviderThumbprint",
      "organizations:*",
      "sts:AssumeRole",
    ]

    resources = ["*"]
  }

  # Its own roles, and the plan role, are off limits. Without this the ARN scope
  # role/<project>-<env>-* would include <project>-<env>-gha-apply itself, and
  # iam:UpdateAssumeRolePolicy on your own role means rewriting who may assume you.
  statement {
    sid    = "NeverTouchThePipelineRoles"
    effect = "Deny"

    actions = ["iam:*"]

    resources = ["arn:${var.aws_partition}:iam::${var.aws_account_id}:role/${local.name_prefix}-gha-*"]
  }

  # The state bucket itself is off limits: the apply role writes objects under its own prefix
  # (above) and can do nothing to the bucket.
  statement {
    sid    = "NeverTouchTheStateBucketItself"
    effect = "Deny"

    actions = [
      "s3:DeleteBucket",
      "s3:DeleteBucketPolicy",
      "s3:PutBucketPolicy",
      "s3:PutBucketPublicAccessBlock",
      "s3:PutBucketVersioning",
      "s3:PutEncryptionConfiguration",
      "s3:PutLifecycleConfiguration",
    ]

    resources = [var.state_bucket_arn]
  }
}

resource "aws_iam_role_policy" "apply" {
  name   = "${local.name_prefix}-gha-apply"
  role   = aws_iam_role.apply.id
  policy = data.aws_iam_policy_document.apply.json
}
