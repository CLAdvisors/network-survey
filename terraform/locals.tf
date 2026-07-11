locals {
  # The default workspace is the original (prod/demo) deployment. Any other
  # workspace (e.g. "staging") gets its own parallel stack.
  environment = terraform.workspace == "default" ? "prod" : terraform.workspace

  # Prod keeps the resource names that already exist in state so switching to
  # workspaces does not force replacements. Non-prod stacks get prefixed names.
  is_prod     = local.environment == "prod"
  name_prefix = local.is_prod ? "" : "${local.environment}-"

  # Legacy bucket names are preserved for prod for the same reason.
  config_bucket_name    = local.is_prod ? "my-config-bucket-${random_string.suffix.result}" : "ona-${local.environment}-config-${random_string.suffix.result}"
  dashboard_bucket_name = local.is_prod ? "react-dashboard-${random_id.bucket_id.hex}" : "ona-${local.environment}-dashboard-${random_id.bucket_id.hex}"
  survey_bucket_name    = local.is_prod ? "react-survey-${random_id.bucket_id.hex}" : "ona-${local.environment}-survey-${random_id.bucket_id.hex}"
  artifacts_bucket_name = "ona-${local.environment}-artifacts-${random_string.suffix.result}"

  frontend_url = "https://${var.dashboard_domain}"
  survey_url   = "https://${var.survey_domain}"

  # Staging and prod share the .bennetts.work cookie domain, so each
  # environment needs its own session cookie name
  session_cookie_name = local.is_prod ? "sessionId" : "sessionId-${local.environment}"

  common_tags = {
    Project     = "network-survey"
    Environment = local.environment
    ManagedBy   = "terraform"
  }
}
