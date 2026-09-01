locals {
  account_id  = "710054969994"
  aws_region  = "us-east-1"
  environment = "prod-secondary"
  name_prefix = "network-survey-prod-secondary"

  common_tags = {
    Project     = "network-survey"
    Environment = "prod-secondary"
    Stack       = "prod-secondary-v1"
    ManagedBy   = "terraform"
    AccountRole = "prod-secondary"
  }
}
