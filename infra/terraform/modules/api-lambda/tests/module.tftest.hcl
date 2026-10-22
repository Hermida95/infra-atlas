# The registry name is the assertion worth having here. dev and prod are the same account and
# the same region, so a name without the environment in it means the second environment's
# first apply fails with RepositoryAlreadyExists -- and the two pipelines would share one
# registry, each able to expire the other's rollback target.
#
# It is also what the apply role's ECR ARN scope matches on
# (modules/github-oidc: repository/<project>-<env>*), so the two have to agree.
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
  image_uri   = "000000000000.dkr.ecr.eu-west-1.amazonaws.com/infra-atlas-dev/api@sha256:0000000000000000000000000000000000000000000000000000000000000000"
}

run "registry_name_carries_the_environment" {
  command = plan

  assert {
    condition     = aws_ecr_repository.api.name == "infra-atlas-dev/api"
    error_message = "The ECR repository name must include the environment, or the second environment's first apply fails with RepositoryAlreadyExists."
  }

  # The prefix the apply role's ARN scope is written against.
  assert {
    condition     = startswith(aws_ecr_repository.api.name, "infra-atlas-dev")
    error_message = "The repository name must start with <project>-<environment> so the apply role's ECR ARN scope matches it and nothing else."
  }

  assert {
    condition     = aws_lambda_function.api.architectures == tolist(["x86_64"])
    error_message = "The function is x86_64, which is what the --platform linux/amd64 build in the READMEs and in deploy.yml exists to match."
  }
}
