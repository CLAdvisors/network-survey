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

variable "frontend_url" {
  description = "Dashboard/frontend URL written to API runtime config."
  type        = string
}

variable "survey_url" {
  description = "Survey URL written to API runtime config."
  type        = string
}

variable "session_cookie_name" {
  description = "Session cookie name written to API runtime config."
  type        = string
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
  default     = "/health"
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
