variable "vpc_cidr" {
  description = "Dedicated target VPC CIDR. Confirm it does not overlap enterprise or partner networks before planning."
  type        = string
  default     = "10.20.0.0/16"

  validation {
    condition     = var.vpc_cidr == "10.20.0.0/16"
    error_message = "The authorized initial prod-secondary VPC CIDR is 10.20.0.0/16."
  }
}

variable "availability_zones" {
  description = "Two us-east-1 Availability Zones for all subnet tiers."
  type        = list(string)
  default     = ["us-east-1a", "us-east-1b"]

  validation {
    condition     = length(var.availability_zones) == 2 && alltrue([for az in var.availability_zones : startswith(az, "us-east-1")])
    error_message = "Exactly two us-east-1 Availability Zones are required."
  }
}

variable "public_subnet_cidrs" {
  description = "Public ALB subnet CIDRs."
  type        = list(string)
  default     = ["10.20.0.0/24", "10.20.1.0/24"]
}

variable "app_subnet_cidrs" {
  description = "Private endpoint-only application subnet CIDRs."
  type        = list(string)
  default     = ["10.20.10.0/24", "10.20.11.0/24"]
}

variable "db_subnet_cidrs" {
  description = "Isolated database subnet CIDRs."
  type        = list(string)
  default     = ["10.20.20.0/24", "10.20.21.0/24"]
}

variable "instance_type" {
  description = "Private ASG EC2 instance type. Capacity is fixed at two by the module."
  type        = string
  default     = "t3.micro"
}

variable "ami_id" {
  description = "Optional reviewed Ubuntu 22.04 AMI ID. Pin this before an approved apply for reproducibility."
  type        = string
  default     = null
}

variable "alb_allowed_ipv4_cidrs" {
  description = "Approved validation CIDRs. Keep empty to fence the public AWS ALB endpoint. Non-empty also requires alb_certificate_arn."
  type        = list(string)
  default     = []
}

variable "alb_certificate_arn" {
  description = "Optional target-account us-east-1 ACM certificate ARN for a later allow-listed validation phase."
  type        = string
  default     = null
}

variable "enable_public_aws_endpoints" {
  description = "Publish the approved AWS default CloudFront endpoints without custom DNS."
  type        = bool
  default     = true
}

variable "custom_domains" {
  description = "Approved prod-secondary custom HTTPS names."
  type = object({
    api       = string
    dashboard = string
    survey    = string
  })
  default = {
    api       = "api.cladvisorsurveys.com"
    dashboard = "dashboard.cladvisorsurveys.com"
    survey    = "surveys.cladvisorsurveys.com"
  }

  validation {
    condition = (
      var.custom_domains.api == "api.cladvisorsurveys.com" &&
      var.custom_domains.dashboard == "dashboard.cladvisorsurveys.com" &&
      var.custom_domains.survey == "surveys.cladvisorsurveys.com"
    )
    error_message = "prod-secondary custom domains must match the explicitly approved cladvisorsurveys.com names."
  }
}

variable "enable_custom_domain_aliases" {
  description = "Attach custom aliases only after ACM DNS validation succeeds."
  type        = bool
  default     = false
}

variable "enable_resend_credentials" {
  description = "Load the isolated prod-secondary Resend sending key into runtime. Activation gate; default off."
  type        = bool
  default     = false
}

variable "enable_resend_webhook_ingest" {
  description = "Load the isolated prod-secondary webhook secret and accept webhooks. Activation gate; default off."
  type        = bool
  default     = false
}

variable "enable_survey_delivery_v2" {
  description = "Expose durable survey launch operations in prod-secondary after provider activation. Default off."
  type        = bool
  default     = false
}

variable "enable_owner_bootstrap" {
  description = "One-time target-only CLA owner bootstrap gate. Return to false immediately after successful verification."
  type        = bool
  default     = false
}

variable "db_instance_class" {
  description = "Multi-AZ RDS instance class."
  type        = string
  default     = "db.t3.micro"
}

variable "db_allocated_storage" {
  description = "Initial encrypted RDS storage in GiB."
  type        = number
  default     = 20

  validation {
    condition     = var.db_allocated_storage >= 20 && var.db_allocated_storage <= 100
    error_message = "db_allocated_storage must be between 20 and 100 GiB."
  }
}
