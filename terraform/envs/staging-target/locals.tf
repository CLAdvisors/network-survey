locals {
  account_id  = "710054969994"
  aws_region  = "us-east-1"
  environment = "staging"
  name_prefix = "network-survey-staging"

  # Machine environment id/tags stay "staging"; only the root path and state key
  # (see provider.tf) are distinct from the legacy source staging root.
  common_tags = {
    Project     = "network-survey"
    Environment = "staging"
    Stack       = "staging-v1"
    ManagedBy   = "terraform"
    AccountRole = "staging"
  }
}
