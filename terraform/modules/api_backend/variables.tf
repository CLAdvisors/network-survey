variable "aws_region" {
  description = "AWS region used for AMI lookup, user data, and IAM SSM ARNs."
  type        = string
}

variable "environment" {
  description = "Runtime environment name passed to cloud-init."
  type        = string
}

variable "name_prefix" {
  description = "Prefix used by named backend resources."
  type        = string
}

variable "vpc_id" {
  description = "VPC ID for ALB, target group, and security groups."
  type        = string
}

variable "backend_subnet_id" {
  description = "Subnet ID for the backend EC2 instance."
  type        = string
}

variable "alb_subnet_ids" {
  description = "Subnet IDs for the ALB."
  type        = list(string)
}

variable "instance_type" {
  description = "EC2 instance type for the backend."
  type        = string
}

variable "ssh_allowed_cidrs" {
  description = "CIDR blocks allowed to SSH to the backend. Empty disables SSH ingress."
  type        = list(string)
  default     = []
}

variable "ssh_key_name" {
  description = "EC2 key pair name when SSH ingress is enabled."
  type        = string
  default     = null
}

variable "alb_deletion_protection" {
  description = "Enable ALB deletion protection."
  type        = bool
  default     = false
}

variable "certificate_arn" {
  description = "ACM certificate ARN for the HTTPS listener."
  type        = string
}

variable "config_bucket_name" {
  description = "Name of the API runtime config bucket."
  type        = string
}

variable "artifacts_bucket_name" {
  description = "Name of the API artifacts bucket."
  type        = string
}

variable "artifact_retention_days" {
  description = "Number of days to retain noncurrent API artifact versions."
  type        = number
}

variable "db_host" {
  description = "Database host written to API runtime config."
  type        = string
}

variable "db_port" {
  description = "Database port written to API runtime config."
  type        = number
}

variable "db_name" {
  description = "Database name written to API runtime config."
  type        = string
}

variable "db_user" {
  description = "Database user written to API runtime config."
  type        = string
}

variable "db_password_parameter_name" {
  description = "SSM parameter name for the DB password."
  type        = string
}

variable "session_secret_parameter_name" {
  description = "SSM parameter name for the API session secret."
  type        = string
}

variable "resend_api_key_parameter_name" {
  description = "SSM parameter name for the Resend API key."
  type        = string
}

variable "resend_webhook_secret_parameter_name" {
  description = "Environment-specific SSM parameter name for the primary Resend webhook signing secret. Terraform never manages the value."
  type        = string
}

variable "resend_webhook_previous_secret_parameter_name" {
  description = "Optional environment-specific SSM parameter name used only during signing-secret rotation overlap. Terraform never manages the value."
  type        = string
  default     = null
}

variable "resend_provider_account_scope" {
  description = "Stable non-secret scope shared by every environment using the same Resend account."
  type        = string

  validation {
    condition     = can(regex("^[A-Za-z0-9_-]{1,128}$", var.resend_provider_account_scope))
    error_message = "resend_provider_account_scope must be a stable 1-128 character identifier containing only letters, digits, underscore, or dash."
  }
}

variable "resend_webhook_ingest_enabled" {
  description = "Exact-true release gate for webhook ingestion. Keep false until the disabled provider endpoint and SSM secret are reconciled."
  type        = bool
  default     = false
}

variable "webhook_payload_retention_days" {
  description = "Retention period for raw webhook payloads; metadata and projections are retained separately."
  type        = number
  default     = 30

  validation {
    condition     = var.webhook_payload_retention_days >= 1 && var.webhook_payload_retention_days <= 365
    error_message = "webhook_payload_retention_days must be between 1 and 365."
  }
}

variable "cloudwatch_log_retention_days" {
  description = "Retention for API and worker CloudWatch log groups."
  type        = number
  default     = 30
}

variable "operations_alert_email" {
  description = "Optional operations email subscribed to the environment SNS alert topic. Confirm the AWS subscription before relying on alerts."
  type        = string
  default     = "bgarcia2324@gmail.com"
  nullable    = true
}

variable "webhook_metric_namespace" {
  description = "CloudWatch namespace used by webhook worker EMF metrics."
  type        = string
  default     = "NetworkSurvey/Webhooks"
}

variable "bootstrap_admin_username" {
  description = "Username for the deploy-time initial dashboard administrator. Null disables bootstrapping."
  type        = string
  default     = null
}

variable "bootstrap_admin_password_parameter_name" {
  description = "SSM SecureString parameter containing the bootstrap administrator password. Null disables bootstrapping."
  type        = string
  default     = null
}

variable "bootstrap_admin_email" {
  description = "Optional email for the deploy-time bootstrap administrator."
  type        = string
  default     = null
}

variable "bootstrap_organization_name" {
  description = "Organization name for the deploy-time bootstrap administrator."
  type        = string
  default     = "Default / Imported"
}

variable "bootstrap_organization_slug" {
  description = "Organization slug for the deploy-time bootstrap administrator."
  type        = string
  default     = "default-imported"
}

variable "bootstrap_platform_admin" {
  description = "Whether the deploy-time bootstrap administrator receives global platform-administrator access."
  type        = bool
  default     = true
}

variable "bootstrap_account_mode" {
  description = "Bootstrap account behavior: ensure preserves an existing password; create-or-verify is retry-safe and requires exact credentials/identity."
  type        = string
  default     = "ensure"

  validation {
    condition     = contains(["ensure", "create-or-verify"], var.bootstrap_account_mode)
    error_message = "bootstrap_account_mode must be ensure or create-or-verify."
  }
}

variable "cla_production_cutover" {
  description = "Select the one-time CLA production cutover changelog. Must remain false outside the reviewed production cutover."
  type        = bool
  default     = false
}

variable "frontend_url" {
  description = "Dashboard/frontend URL written to API runtime config."
  type        = string
}

variable "survey_url" {
  description = "Canonical survey URL written to API runtime config and used for newly generated links."
  type        = string
}

variable "survey_allowed_origins" {
  description = "Comma-separated additional survey origins allowed by API CORS for legacy links."
  type        = string
  default     = ""
}

variable "session_cookie_name" {
  description = "Session cookie name written to API runtime config."
  type        = string
}

variable "email_worker_environment" {
  description = "Durable email worker control namespace (staging or prod)."
  type        = string

  validation {
    condition     = contains(["staging", "prod"], var.email_worker_environment)
    error_message = "email_worker_environment must be staging or prod."
  }
}

variable "survey_delivery_v2_enabled" {
  description = "Explicit rollout gate for durable survey launch enqueue."
  type        = bool
  default     = false
}

variable "legacy_start_enabled" {
  description = "Compatibility start adapter gate; keep false for hosted rollouts."
  type        = bool
  default     = false
}

variable "email_rate_per_second" {
  description = "Approved aggregate provider-account email request budget."
  type        = number
  default     = 5

  validation {
    condition     = var.email_rate_per_second >= 1 && var.email_rate_per_second <= 100
    error_message = "email_rate_per_second must be between 1 and 100."
  }
}

variable "email_rate_budget_environment" {
  description = "Shared reservation namespace for deployments using the same provider account."
  type        = string
  default     = "prod"

  validation {
    condition     = contains(["staging", "prod"], var.email_rate_budget_environment)
    error_message = "email_rate_budget_environment must name a seeded hosted control namespace."
  }
}

variable "cloud_init_template_path" {
  description = "Path to cloud-init template."
  type        = string
}

variable "env_template_path" {
  description = "Path to API env template."
  type        = string
}

variable "common_tags" {
  description = "Common tags for backend resources."
  type        = map(string)
}

variable "config_bucket_tags" {
  description = "Tags for config bucket."
  type        = map(string)
}

variable "artifacts_bucket_tags" {
  description = "Tags for artifacts bucket."
  type        = map(string)
}

variable "backend_security_group_name" {
  description = "Backend security group name."
  type        = string
}

variable "backend_security_group_description" {
  description = "Backend security group description."
  type        = string
  default     = null
}

variable "backend_security_group_tags" {
  description = "Tags for backend security group."
  type        = map(string)
}

variable "backend_api_ingress_description" {
  description = "Description for backend API ingress from ALB."
  type        = string
  default     = "API traffic from the ALB"
}

variable "alb_security_group_name" {
  description = "ALB security group name."
  type        = string
}

variable "alb_security_group_description" {
  description = "ALB security group description."
  type        = string
}

variable "alb_security_group_tags" {
  description = "Tags for ALB security group."
  type        = map(string)
}

variable "alb_http_ingress_description" {
  description = "Description for ALB HTTP ingress."
  type        = string
  default     = "HTTP from the internet for redirect to HTTPS"
}

variable "alb_https_ingress_description" {
  description = "Description for ALB HTTPS ingress."
  type        = string
  default     = "HTTPS from the internet"
}

variable "backend_instance_name" {
  description = "Name tag for backend instance."
  type        = string
}

variable "backend_instance_tags" {
  description = "Tags for backend instance."
  type        = map(string)
}

variable "iam_role_name" {
  description = "EC2 IAM role name."
  type        = string
}

variable "iam_policy_name" {
  description = "EC2 runtime IAM policy name."
  type        = string
}

variable "iam_policy_description" {
  description = "EC2 runtime IAM policy description."
  type        = string
}

variable "iam_instance_profile_name" {
  description = "EC2 IAM instance profile name."
  type        = string
}

variable "iam_tags" {
  description = "Tags for IAM role, policy, and instance profile."
  type        = map(string)
  default     = null
}

variable "target_group_name" {
  description = "ALB target group name."
  type        = string
}

variable "target_group_tags" {
  description = "Target group tags."
  type        = map(string)
  default     = null
}

variable "target_group_attachment_for_each" {
  description = "Use staging-compatible for_each target group attachment address."
  type        = bool
  default     = false
}

variable "target_group_attachment_port" {
  description = "Optional target group attachment port."
  type        = number
  default     = null
}

variable "alb_name" {
  description = "ALB name."
  type        = string
}

variable "alb_tags" {
  description = "Tags for ALB."
  type        = map(string)
}

variable "health_check_path" {
  description = "Target group health check path."
  type        = string
  default     = "/live"
}

variable "health_check_protocol" {
  description = "Optional target group health check protocol."
  type        = string
  default     = null
}

variable "health_check_matcher" {
  description = "Optional target group health check matcher."
  type        = string
  default     = null
}

variable "health_check_timeout" {
  description = "Optional target group health check timeout."
  type        = number
  default     = null
}

variable "enable_config_bucket_ownership_controls" {
  description = "Whether to manage BucketOwnerEnforced ownership controls on the config bucket."
  type        = bool
  default     = false
}
