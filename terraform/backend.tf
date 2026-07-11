terraform {
  backend "s3" {
    bucket               = "network-survey-terraform-state-438465164125"
    key                  = "terraform.tfstate"
    region               = "us-east-1"
    encrypt              = true
    use_lockfile         = true
    workspace_key_prefix = "env"
  }
}
