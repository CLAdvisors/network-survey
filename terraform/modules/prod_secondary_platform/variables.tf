variable "account_id" {
  description = "AWS account that is allowed to contain the platform."
  type        = string
}

variable "aws_region" {
  description = "AWS region for all regional resources."
  type        = string
}

variable "environment" {
  description = "Canonical machine environment identifier."
  type        = string

  validation {
    condition     = var.environment == "prod-secondary"
    error_message = "This module only supports the exact prod-secondary environment identifier."
  }
}

variable "name_prefix" {
  description = "Prefix for named resources."
  type        = string
}

variable "vpc_cidr" {
  description = "CIDR for the dedicated VPC."
  type        = string
}

variable "availability_zones" {
  description = "Exactly two Availability Zones used by every subnet tier."
  type        = list(string)

  validation {
    condition     = length(var.availability_zones) == 2 && length(distinct(var.availability_zones)) == 2
    error_message = "availability_zones must contain exactly two distinct Availability Zones."
  }
}

variable "public_subnet_cidrs" {
  description = "Exactly two public ALB subnet CIDRs."
  type        = list(string)

  validation {
    condition     = length(var.public_subnet_cidrs) == 2
    error_message = "public_subnet_cidrs must contain exactly two CIDRs."
  }
}

variable "app_subnet_cidrs" {
  description = "Exactly two private application subnet CIDRs."
  type        = list(string)

  validation {
    condition     = length(var.app_subnet_cidrs) == 2
    error_message = "app_subnet_cidrs must contain exactly two CIDRs."
  }
}

variable "db_subnet_cidrs" {
  description = "Exactly two isolated database subnet CIDRs."
  type        = list(string)

  validation {
    condition     = length(var.db_subnet_cidrs) == 2
    error_message = "db_subnet_cidrs must contain exactly two CIDRs."
  }
}

variable "instance_type" {
  description = "EC2 instance type used by the private ASG."
  type        = string
  default     = "t3.micro"
}

variable "ami_id" {
  description = "Optional reviewed AMI ID. Null selects the latest Canonical Ubuntu 22.04 x86_64 AMI at plan time."
  type        = string
  default     = null
}

variable "alb_allowed_ipv4_cidrs" {
  description = "IPv4 CIDRs allowed to reach the AWS ALB endpoint. Empty keeps the endpoint network-fenced."
  type        = list(string)
  default     = []
}

variable "alb_certificate_arn" {
  description = "Optional reviewed ACM certificate ARN. Null creates only an HTTP listener; ingress remains CIDR-fenced."
  type        = string
  default     = null
}

variable "db_instance_class" {
  description = "RDS instance class."
  type        = string
  default     = "db.t3.micro"
}

variable "db_allocated_storage" {
  description = "RDS allocated storage in GiB."
  type        = number
  default     = 20
}

variable "db_name" {
  description = "Name of the fresh, empty application database."
  type        = string
  default     = "ONA"
}

variable "db_master_username" {
  description = "RDS master username. The password is generated and managed by RDS in Secrets Manager."
  type        = string
  default     = "DbAdmin"
}

variable "backup_retention_days" {
  description = "RDS automated backup retention."
  type        = number
  default     = 14

  validation {
    condition     = var.backup_retention_days >= 7 && var.backup_retention_days <= 35
    error_message = "backup_retention_days must be between 7 and 35."
  }
}

variable "allowed_instance_type_prefixes" {
  description = "Optional EC2 instance type prefixes permitted by policy."
  type        = list(string)
  default     = ["t3.", "t3a."]
}

variable "enable_owner_bootstrap" {
  description = "Temporarily expose the approved CLA owner bootstrap configuration."
  type        = bool
  default     = false
}

variable "operations_alert_email" {
  description = "Initial operations email subscriber for prod-secondary alarms."
  type        = string
}

variable "github_deploy_role_name" {
  description = "Pre-bootstrapped target-account GitHub deploy role receiving exact workload permissions."
  type        = string
  default     = "network-survey-prod-secondary-deploy"
}

variable "common_tags" {
  description = "Required exact environment and ownership tags."
  type        = map(string)

  validation {
    condition = (
      lookup(var.common_tags, "Project", "") == "network-survey" &&
      lookup(var.common_tags, "Environment", "") == "prod-secondary" &&
      lookup(var.common_tags, "Stack", "") == "prod-secondary-v1" &&
      lookup(var.common_tags, "ManagedBy", "") == "terraform" &&
      lookup(var.common_tags, "AccountRole", "") == "prod-secondary"
    )
    error_message = "common_tags must contain the exact prod-secondary naming contract."
  }
}
