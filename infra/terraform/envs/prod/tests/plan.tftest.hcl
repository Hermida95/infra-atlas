# The check no linter can make: that `terraform plan` of this environment resolves at all.
#
# `fmt`, `validate`, `tflint` and `checkov` all read the configuration without ever building
# a plan graph, so none of them can see the one mistake that is easy to make here and
# impossible to spot by reading: deriving a `count` or a `dynamic` block from a value that is
# not known until `apply`. `module.api.api_id` and
# `replace(module.api.api_endpoint, "https://", "")` are exactly that -- attributes of an API
# Gateway that does not exist yet -- and a configuration that counts on them passes all four
# checks and then dies on the first plan of a new environment with:
#
#   Error: Invalid count argument
#   The "count" value depends on resource attributes that cannot be determined until apply.
#
# `mock_provider` is what makes this runnable with no AWS account and no credentials: the
# provider is never contacted, so the plan is pure Terraform evaluation -- which is where the
# error lives. This is the only regression test in the repository that would have caught it.
mock_provider "aws" {
  # The one data source that needs a realistic mock rather than a generated one: the AWS
  # provider validates that assume_role_policy, the bucket policy and the topic policy are
  # JSON objects, and a mock string is not. The contents do not matter -- nothing is applied,
  # and what is under test is whether the graph resolves.
  mock_data "aws_iam_policy_document" {
    defaults = {
      json = "{\"Version\":\"2012-10-17\",\"Statement\":[]}"
    }
  }

  mock_data "aws_caller_identity" {
    defaults = {
      account_id = "000000000000"
    }
  }
}

# The three values deploy.yml injects. Shapes, not real resources: nothing is created.
variables {
  web_bucket_name          = "infra-atlas-prod-web-000000000000"
  alert_emails             = ["alerts@example.invalid"]
  api_image_uri            = "000000000000.dkr.ecr.eu-west-1.amazonaws.com/infra-atlas-prod/api@sha256:0000000000000000000000000000000000000000000000000000000000000000"
  permissions_boundary_arn = "arn:aws:iam::000000000000:policy/infra-atlas-execution-boundary"
}

# The empty-state case: no resource exists, so every module output is unknown. This is the
# first apply of a fresh account, and the hardest plan to resolve.
run "plan_from_an_empty_state" {
  command = plan
}

# A custom domain changes which branch of the `viewer_certificate` and the alias handling runs,
# and it is the one combination the `precondition` on the distribution rejects when half-set.
run "plan_with_a_custom_domain" {
  command = plan

  variables {
    web_aliases         = ["prod.example.invalid"]
    acm_certificate_arn = "arn:aws:acm:us-east-1:000000000000:certificate/00000000-0000-0000-0000-000000000000"
  }
}
