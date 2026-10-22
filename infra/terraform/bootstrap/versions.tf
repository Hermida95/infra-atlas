terraform {
  # use_lockfile (S3-native state locking, decision 9) needs 1.10 or newer.
  required_version = ">= 1.10"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
  }

  # No backend on purpose: bootstrap is what creates the bucket every other state lives in,
  # so its own state is local and stays out of git (.gitignore ignores *.tfstate). Losing it
  # is cheap -- every resource here is importable, see README.md.
  #
  # To move it into the bucket it just created, uncomment and run `terraform init -migrate-state`:
  #
  # backend "s3" {
  #   key          = "bootstrap/terraform.tfstate"
  #   region       = "eu-west-1"
  #   encrypt      = true
  #   use_lockfile = true
  # }
}

provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      Project    = var.project
      ManagedBy  = "terraform"
      Component  = "bootstrap"
      Repository = "${var.github_owner}/${var.github_repo}"
    }
  }
}
