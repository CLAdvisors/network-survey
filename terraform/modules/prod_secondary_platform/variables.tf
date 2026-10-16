variable "account_id" {
  description = "AWS account that is allowed to contain the platform."
  type        = string
}

variable "aws_region" {
  description = "AWS region for all regional resources."
  type        = string
}

variable "environment" {
  description = "Canonical machine environment identifier for a target-account instance of this module."
  type        = string

  validation {
    condition     = contains(["prod-secondary", "staging"], var.environment)
    error_message = "This module is allowed only for the target prod-secondary or isolated staging environment identifiers."
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

variable "nat_gateway_count" {
  description = "One NAT for budget-isolated staging egress, two for the existing prod-secondary AZ redundancy. Numeric topology default preserves prod-secondary."
  type        = number
  default     = 2

  validation {
    condition     = contains([1, 2], var.nat_gateway_count)
    error_message = "Only one or two NAT gateways are supported."
  }
}

variable "app_desired_capacity" {
  description = "ASG desired capacity. Prod-secondary stays at two; staging starts at zero until a secure artifact and session parameter exist."
  type        = number
  default     = 2

  validation {
    condition     = var.environment == "prod-secondary" ? var.app_desired_capacity == 2 : contains([0, 1], var.app_desired_capacity)
    error_message = "Prod-secondary must keep two hosts; staging may bootstrap at zero and run at most one."
  }
}

variable "app_max_capacity" {
  description = "Explicit ASG maximum capacity ceiling. Prod-secondary keeps its three-host rolling-refresh ceiling; staging stage 0 enforces zero with no capacity-raising headroom."
  type        = number
  default     = 3

  validation {
    condition     = var.app_max_capacity >= var.app_desired_capacity && var.app_max_capacity <= 3 && (var.environment == "prod-secondary" ? var.app_max_capacity == 3 : true)
    error_message = "app_max_capacity must be at least app_desired_capacity and at most three; prod-secondary must keep its three-host ceiling."
  }
}

variable "db_multi_az" {
  description = "Keep prod-secondary Multi-AZ; allow cheaper isolated staging single-AZ."
  type        = bool
  default     = true
}

variable "enable_interface_endpoints" {
  description = "Create the private interface endpoints for AWS services. Keep true for prod-secondary; staging carries AWS-service egress over one NAT while retaining the S3 gateway endpoint."
  type        = bool
  default     = true
}

variable "instance_type" {
  description = "Reviewed EC2 instance type used by the private ASG; PM2 RSS tripwires require the 2 GiB t3.small capacity envelope."
  type        = string
  default     = "t3.small"

  validation {
    condition     = var.instance_type == "t3.small"
    error_message = "prod-secondary runtime containment is supported only on t3.small; review memory limits before changing size."
  }
}

variable "ami_id" {
  description = "Explicitly reviewed prod-secondary AMI ID. Never resolve a moving latest image during an application infrastructure apply."
  type        = string

  validation {
    condition     = can(regex("^ami-[0-9a-f]{8,17}$", var.ami_id))
    error_message = "ami_id must be an explicit EC2 AMI ID."
  }
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

variable "enable_public_aws_endpoints" {
  description = "Enable CloudFront default-domain endpoints and restrict ALB origin ingress to CloudFront."
  type        = bool
  default     = false
}

variable "custom_domains" {
  description = "Custom HTTPS names for the API and frontend CloudFront distributions."
  type = object({
    api       = string
    dashboard = string
    survey    = string
  })
}

variable "enable_custom_domain_aliases" {
  description = "Attach validated custom names and the ACM certificate to CloudFront."
  type        = bool
  default     = false
}

variable "enable_resend_credentials" {
  description = "Allow prod-secondary runtime to load its isolated Resend sending key. Keep false until approved activation."
  type        = bool
  default     = false
}

variable "enable_resend_webhook_ingest" {
  description = "Allow prod-secondary to load its isolated webhook secret and accept Resend webhooks. Keep false until approved activation."
  type        = bool
  default     = false
}

variable "enable_survey_delivery_v2" {
  description = "Allow prod-secondary administrators to create durable survey launches after provider activation. Keep false until approved activation."
  type        = bool
  default     = false
}

variable "enable_owner_bootstrap" {
  description = "Temporarily expose the approved CLA owner bootstrap configuration."
  type        = bool
  default     = false
}

variable "secure_runtime_enabled" {
  description = "Stamp the target secure-runtime identity into deploy.env and the runtime config. Keep false for every existing environment; only the target staging root sets it true. It makes the API, both workers and every deploy-invoked tool resolve credentials transiently instead of from a plaintext file."
  type        = bool
  default     = false
}

variable "operations_alert_email" {
  description = "Approved operations alarm subscriber. Null keeps the subscription disabled until a reviewed contact exists; prod-secondary passes its explicit address."
  type        = string
  default     = null
}

variable "github_deploy_role_name" {
  description = "Pre-bootstrapped target-account GitHub deploy role receiving exact workload permissions."
  type        = string
  default     = "network-survey-prod-secondary-deploy"
}

variable "common_tags" {
  description = "Required exact target-account environment and ownership tags; every value is derived from the selected environment."
  type        = map(string)

  validation {
    condition = (
      lookup(var.common_tags, "Project", "") == "network-survey" &&
      lookup(var.common_tags, "Environment", "") == var.environment &&
      lookup(var.common_tags, "Stack", "") == "${var.environment}-v1" &&
      lookup(var.common_tags, "ManagedBy", "") == "terraform" &&
      lookup(var.common_tags, "AccountRole", "") == var.environment
    )
    error_message = "common_tags must match the exact selected target-account environment."
  }
}
