# tflint config for every directory under infra/terraform. Run it from the repo root with
# `make tf-lint`, which does the --chdir dance for each module and environment.

config {
  call_module_type = "local"
}

plugin "terraform" {
  enabled = true
  preset  = "all"
}

# The AWS ruleset knows what AWS accepts: an invalid instance type, a log retention value
# CloudWatch rejects, an IAM policy that is syntactically fine and semantically impossible.
# It is downloaded by `tflint --init`, which is why CI and the Makefile run that first.
plugin "aws" {
  enabled = true
  version = "0.44.0"
  source  = "github.com/terraform-linters/tflint-ruleset-aws"
}

rule "terraform_naming_convention" {
  enabled = true
  format  = "snake_case"
}

# Every variable and output in this repo carries a description, and most of them explain a
# trade-off rather than restating the name.
rule "terraform_documented_variables" {
  enabled = true
}

rule "terraform_documented_outputs" {
  enabled = true
}

# A module that does not pin its provider version breaks on a major release of the provider,
# months later, in somebody else's apply.
rule "terraform_required_providers" {
  enabled = true
}

rule "terraform_required_version" {
  enabled = true
}
