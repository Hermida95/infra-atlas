# The apply role's policy, rendered and read back. Three of the mistakes a reviewer found in
# this module are invisible to every linter and to the first apply, because the first apply is
# run by hand with administrator credentials -- the role itself is never exercised until CI
# tries to use it:
#
#   - s3:prefix on ListBucket without "env:/" kills `terraform init`, before a line of
#     configuration is read, because the S3 backend enumerates workspaces with that prefix;
#   - no logs:CreateLogDelivery kills the apply on the API Gateway stage's access logging,
#     after the function and the API have already been created;
#   - an ECR ARN of repository/<project>* instead of repository/<project>-<env>* lets dev's
#     pipeline push to prod's registry.
#
# This file uses a real `aws` provider rather than mock_provider, and that is the point:
# aws_iam_policy_document is rendered client-side by the provider, so a mock would hand back a
# generated string and there would be no policy to assert on. The skip_* flags and the dummy
# credentials keep it offline -- nothing here calls AWS, and `command = plan` creates nothing.
provider "aws" {
  region                      = "eu-west-1"
  access_key                  = "mock_access_key"
  secret_key                  = "mock_secret_key"
  skip_credentials_validation = true
  skip_metadata_api_check     = true
  skip_region_validation      = true
  skip_requesting_account_id  = true
}

variables {
  project           = "infra-atlas"
  environment       = "dev"
  github_repository = "Hermida95/infra-atlas"
  oidc_provider_arn = "arn:aws:iam::000000000000:oidc-provider/token.actions.githubusercontent.com"
  plan_subjects     = ["repo:Hermida95/infra-atlas:pull_request"]

  github_environment = "dev"
  apply_ref          = "refs/heads/main"

  state_bucket_arn = "arn:aws:s3:::infra-atlas-tfstate-000000000000"
  state_key_prefix = "envs/dev/"

  permissions_boundary_arn = "arn:aws:iam::000000000000:policy/infra-atlas-execution-boundary"

  aws_partition  = "aws"
  aws_account_id = "000000000000"
}

run "apply_role_can_init_the_backend" {
  command = plan

  assert {
    condition = anytrue([
      for s in jsondecode(data.aws_iam_policy_document.apply.json).Statement :
      contains(try(tolist(s.Condition.StringLike["s3:prefix"]), [tostring(s.Condition.StringLike["s3:prefix"])]), "env:/*")
      if try(s.Sid, "") == "ListOwnStatePrefix"
    ])
    error_message = "ListBucket must allow the \"env:/\" prefix: the S3 backend lists it to enumerate workspaces during `terraform init`, so the apply job dies before it reads any configuration."
  }

  assert {
    condition = anytrue([
      for s in jsondecode(data.aws_iam_policy_document.apply.json).Statement :
      contains(try(tolist(s.Condition.StringLike["s3:prefix"]), [tostring(s.Condition.StringLike["s3:prefix"])]), "envs/dev/*")
      if try(s.Sid, "") == "ListOwnStatePrefix"
    ])
    error_message = "ListBucket must still be restricted to this environment's own state prefix."
  }
}

run "apply_role_can_turn_on_access_logging" {
  command = plan

  assert {
    condition = alltrue([
      for action in [
        "logs:CreateLogDelivery",
        "logs:DeleteLogDelivery",
        "logs:DescribeResourcePolicies",
        "logs:GetLogDelivery",
        "logs:ListLogDeliveries",
        "logs:PutResourcePolicy",
        "logs:UpdateLogDelivery",
      ] :
      anytrue([
        for s in jsondecode(data.aws_iam_policy_document.apply.json).Statement :
        contains(try(tolist(s.Action), [tostring(s.Action)]), action)
        if try(s.Effect, "") == "Allow"
      ])
    ])
    error_message = "The apply role needs the log-delivery actions, or aws_apigatewayv2_stage's access_log_settings fails the apply after the function and the API already exist."
  }
}

run "apply_role_cannot_reach_the_other_environment" {
  command = plan

  # Every ECR ARN this role is given has to carry the environment. repository/infra-atlas*
  # also matches infra-atlas-prod/api.
  assert {
    condition = alltrue(flatten([
      for s in jsondecode(data.aws_iam_policy_document.apply.json).Statement : [
        for r in try(tolist(s.Resource), [tostring(s.Resource)]) :
        startswith(r, "arn:aws:ecr:*:000000000000:repository/infra-atlas-dev")
        if can(regex(":ecr:", r))
      ]
    ]))
    error_message = "The apply role's ECR ARNs must be scoped to repository/<project>-<environment>*, or dev's pipeline can push to prod's registry."
  }

  # The guards the review asked to leave alone, pinned so a later edit cannot quietly drop them.
  assert {
    condition = anytrue([
      for s in jsondecode(data.aws_iam_policy_document.apply.json).Statement :
      contains(try(tolist(s.Action), [tostring(s.Action)]), "iam:AttachRolePolicy")
      if try(s.Effect, "") == "Deny"
    ])
    error_message = "iam:AttachRolePolicy must stay denied outright: it is the one action that turns a pipeline compromise into an account compromise."
  }

  assert {
    condition = anytrue([
      for s in jsondecode(data.aws_iam_policy_document.apply.json).Statement :
      try(s.Condition.StringEquals["iam:PermissionsBoundary"], null) != null
      if try(s.Sid, "") == "CreateOwnRolesWithinBoundary"
    ])
    error_message = "iam:CreateRole must stay conditioned on the permissions boundary."
  }
}

run "plan_role_is_read_only" {
  command = plan

  assert {
    condition = anytrue([
      for s in jsondecode(data.aws_iam_policy_document.plan.json).Statement :
      try(s.Sid, "") == "NeverWriteState" && s.Effect == "Deny"
    ])
    error_message = "The plan role must keep its explicit Deny on writing state: the plan job runs with -lock=false precisely because it cannot write a .tflock object."
  }
}
