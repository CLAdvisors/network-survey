variable "aws_region" {
  description = "AWS region"
  default     = "us-east-1"
}

variable "project_name" {
  description = "Project tag value"
  default     = "network-survey"
}

variable "environment" {
  description = "Environment tag value"
  default     = "prod"
}

variable "vpc_id" {
  description = "Existing prod VPC id containing the current demo/prod database subnet group"
  default     = "vpc-0a3c3c61ed4c7a097"
}

variable "backend_security_group_id" {
  description = "Security group used by the prod API/backend; new DB allows Postgres from this SG"
  default     = "sg-05b4dc3a549e37d53"
}

variable "db_subnet_group_name" {
  description = "Existing DB subnet group for prod"
  default     = "db-subnet-group"
}

variable "db_identifier" {
  description = "Identifier for the replacement prod RDS instance"
  default     = "network-survey-prod-postgres-v2"
}

variable "db_name" {
  description = "Initial database name"
  default     = "ONA"
}

variable "db_user" {
  description = "Master username for the replacement DB"
  default     = "DbAdmin"
}

variable "db_password" {
  description = "Master password for the replacement DB"
  sensitive   = true
}

variable "allocated_storage" {
  description = "Allocated storage in GB"
  default     = 20
}

variable "instance_class" {
  description = "RDS instance class"
  default     = "db.t3.micro"
}

variable "engine_version" {
  description = "Postgres engine version"
  default     = "15.18"
}

variable "deletion_protection" {
  description = "Enable deletion protection"
  type        = bool
  default     = true
}

variable "api_domain" {
  description = "Domain name for the production API"
  default     = "demo.ona.api.bennetts.work"
}

variable "dashboard_domain" {
  description = "Domain name for the production dashboard"
  default     = "demo.ona.dashboard.bennetts.work"
}

variable "survey_domain" {
  description = "Domain name for the production survey app"
  default     = "demo.ona.survey.bennetts.work"
}

variable "replacement_resource_environment" {
  description = "Environment tag used for replacement app resource discovery before legacy prod resources are retired"
  default     = "prod-v2"
}

variable "app_vpc_cidr" {
  description = "CIDR block for the fresh replacement prod app VPC"
  default     = "10.42.0.0/16"
}

variable "app_public_subnet_cidrs" {
  description = "Two fresh public subnet CIDRs in the existing prod DB VPC (VPC quota prevents creating another VPC in this account)"
  type        = list(string)
  default     = ["10.0.10.0/24", "10.0.11.0/24"]
}

variable "existing_prod_vpc_cidr" {
  description = "CIDR block for the existing VPC that contains network-survey-prod-postgres-v2"
  default     = "10.0.0.0/16"
}

variable "app_instance_type" {
  description = "EC2 instance type for the replacement backend"
  default     = "t3.micro"
}

variable "ssh_allowed_cidrs" {
  description = "CIDR blocks allowed to SSH to the backend. Empty disables SSH ingress; use SSM Session Manager."
  type        = list(string)
  default     = []
}

variable "ssh_key_name" {
  description = "EC2 key pair name for SSH, only used when ssh_allowed_cidrs is non-empty"
  default     = "api-instance-key"
}

variable "alb_deletion_protection" {
  description = "Enable deletion protection on the replacement prod ALB"
  type        = bool
  default     = false
}

variable "artifact_retention_days" {
  description = "Number of days to retain noncurrent API artifact versions"
  type        = number
  default     = 30
}

variable "enable_frontend_custom_domains" {
  description = "Attach demo dashboard/survey aliases and imported ACM certs to the replacement CloudFront distributions. This is true after prod-v2 DNS cutover."
  type        = bool
  default     = true
}
