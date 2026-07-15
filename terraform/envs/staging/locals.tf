locals {
  environment = "staging"
  name_prefix = "${local.environment}-"

  config_bucket_name    = "ona-${local.environment}-config-${random_string.suffix.result}"
  dashboard_bucket_name = "ona-${local.environment}-dashboard-${random_id.bucket_id.hex}"
  survey_bucket_name    = "ona-${local.environment}-survey-${random_id.bucket_id.hex}"
  artifacts_bucket_name = "ona-${local.environment}-artifacts-${random_string.suffix.result}"

  frontend_url = "https://${var.dashboard_domain}"
  survey_url   = "https://${var.survey_domain}"

  # Staging and prod share the .bennetts.work cookie domain, so each
  # environment needs its own session cookie name
  session_cookie_name = "sessionId-${local.environment}"

  ssm_parameter_prefix          = "/network-survey/${local.environment}"
  db_password_parameter_name    = "${local.ssm_parameter_prefix}/db/password"
  session_secret_parameter_name = "${local.ssm_parameter_prefix}/api/session-secret"
  resend_api_key_parameter_name = "${local.ssm_parameter_prefix}/api/resend-api-key"

  common_tags = {
    Project     = "network-survey"
    Environment = local.environment
    ManagedBy   = "terraform"
  }
}
