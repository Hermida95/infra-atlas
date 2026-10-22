terraform {
  required_version = ">= 1.10"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
  }

  # Partial configuration: everything that is the same for every clone of this repo is here,
  # and the bucket name -- which is globally unique, so account-specific -- comes from
  # backend.hcl (copy backend.hcl.example). Decision 9:
  #
  #   use_lockfile = true  ->  the lock is an S3 object next to the state, written with a
  #                            conditional PUT. No DynamoDB table to create, pay for or
  #                            forget about. Needs Terraform 1.10 or newer.
  #
  #   terraform init -backend-config=backend.hcl
  backend "s3" {
    key          = "envs/prod/terraform.tfstate"
    region       = "eu-west-1"
    encrypt      = true
    use_lockfile = true
  }
}

provider "aws" {
  region = var.aws_region

  # Every resource gets these without any module having to remember. They are also what makes
  # the bill readable in Cost Explorer: without them, "which environment spent this" has no
  # answer.
  default_tags {
    tags = {
      Project     = var.project
      Environment = var.environment
      ManagedBy   = "terraform"
      Repository  = "Hermida95/infra-atlas"
    }
  }
}
