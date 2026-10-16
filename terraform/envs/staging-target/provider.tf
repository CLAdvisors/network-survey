terraform {
  required_version = ">= 1.12.0, < 2.0.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.100"
    }
  }

  # Distinct target-account root and state key. Never reuse, copy, or migrate the
  # legacy source-account staging root or its state key.
  backend "s3" {
    bucket       = "network-survey-terraform-state-710054969994"
    key          = "envs/staging-target/terraform.tfstate"
    region       = "us-east-1"
    encrypt      = true
    kms_key_id   = "alias/network-survey-prod-secondary-state"
    use_lockfile = true
  }
}

provider "aws" {
  region              = "us-east-1"
  allowed_account_ids = ["710054969994"]

  default_tags {
    tags = local.common_tags
  }
}
