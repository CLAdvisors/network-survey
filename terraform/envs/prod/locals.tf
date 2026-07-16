data "aws_caller_identity" "current" {}

locals {
  prod_app_tags = {
    Project     = var.project_name
    Environment = var.environment
    ManagedBy   = "terraform"
  }
}
