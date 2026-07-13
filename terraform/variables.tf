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
  description = "Secret used to sign API session cookies"
  sensitive   = true
}

variable "resend_api_key" {
  description = "Resend API key used by the API to send survey emails"
  sensitive   = true
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
