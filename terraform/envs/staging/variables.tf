variable "aws_region" {
  description = "AWS region to deploy resources"
  default     = "us-east-1"
}

variable "instance_type" {
  description = "Type of instance for the backend"
  default     = "t2.micro"
}

variable "db_user" {
  description = "Database username"
  default     = "admin"
}

variable "db_password" {
  description = "Database password"
  sensitive   = true
}

variable "session_secret" {
  description = "Deprecated: API session secret now comes from SSM Parameter Store at runtime. Kept temporarily so old local tfvars do not break plans."
  type        = string
  sensitive   = true
  default     = null
}

variable "resend_api_key" {
  description = "Deprecated: Resend API key now comes from SSM Parameter Store at runtime. Kept temporarily so old local tfvars do not break plans."
  type        = string
  sensitive   = true
  default     = null
}

variable "api_domain" {
  description = "Domain name for the API (ALB)"
  default     = "demo.ona.api.bennetts.work"
}

variable "dashboard_domain" {
  description = "Domain name for the admin dashboard (CloudFront)"
  default     = "demo.ona.dashboard.bennetts.work"
}

variable "survey_domain" {
  description = "Domain name for the survey app (CloudFront)"
  default     = "demo.ona.survey.bennetts.work"
}

variable "ssh_allowed_cidrs" {
  description = "CIDR blocks allowed to SSH to the backend instance. Empty (default) disables SSH ingress entirely; use SSM Session Manager instead."
  type        = list(string)
  default     = []
}

variable "ssh_key_name" {
  description = "EC2 key pair name for the backend instance. Only useful when ssh_allowed_cidrs is non-empty."
  default     = "api-instance-key"
}

variable "manage_github_oidc" {
  description = "Whether this workspace manages the account-global GitHub OIDC provider and deploy role. Enable in exactly one workspace (prod)."
  type        = bool
  default     = false
}

variable "github_repo" {
  description = "GitHub repository (org/name) allowed to assume the deploy role"
  default     = "CLAdvisors/network-survey"
}

variable "db_deletion_protection" {
  description = "Enable RDS deletion protection (recommended for prod)"
  type        = bool
  default     = false
}

variable "alb_deletion_protection" {
  description = "Enable ALB deletion protection (recommended for prod)"
  type        = bool
  default     = false
}

variable "artifact_retention_days" {
  description = "Number of days to retain noncurrent API artifact versions in S3"
  type        = number
  default     = 30
}

variable "survey_delivery_v2_enabled" {
  description = "Explicit staging rollout gate for durable survey launches."
  type        = bool
  default     = false
}

variable "resend_provider_account_scope" {
  description = "Stable scope shared with production because both use the same Resend team."
  type        = string
  default     = "network-survey-resend-team"
}

variable "resend_webhook_ingest_enabled" {
  description = "Release gate for signed Resend webhook ingestion. Enable only after secret bootstrap and disabled-endpoint reconciliation."
  type        = bool
  default     = false
}

variable "webhook_payload_retention_days" {
  description = "Days to retain bounded raw webhook payloads."
  type        = number
  default     = 30
}

variable "operations_alert_email" {
  description = "Optional initial SNS email subscriber for staging infrastructure alarms."
  type        = string
  default     = "bgarcia2324@gmail.com"
  nullable    = true
}

variable "email_rate_per_second" {
  description = "Approved aggregate Resend account request budget shared with production."
  type        = number
  default     = 1
  validation {
    condition     = var.email_rate_per_second == 1
    error_message = "Staging is capped at 1 request/second so the shared account budget remains bounded."
  }
}

variable "api_config_db_host_override" {
  description = "Optional DB host written to the API runtime config instead of this stack's RDS address. Temporary safety valve while prod DB ownership is split during the infra refactor. Leave null for normal environments."
  type        = string
  default     = null
}
