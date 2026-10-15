variable "ami_id" {
  description = "Reviewed explicit Ubuntu 22.04 AMI ID from the target-account staging GitHub environment. Never resolve a moving latest image."
  type        = string

  validation {
    condition     = can(regex("^ami-[0-9a-f]{8,17}$", var.ami_id))
    error_message = "ami_id must be a pinned reviewed AMI ID."
  }
}

variable "start_staging_app" {
  description = "Keep false for stage 0: no immutable secure artifact or AWS-only session SecureString exists yet, so min/desired/max capacity stay 0. Set true only after the separately approved secure-runtime, artifact and session readiness gates pass."
  type        = bool
  default     = false
}

variable "enable_custom_domain_aliases" {
  description = "Keep false while ACM validation DNS is pending; CloudFront default domains are used first. Enabling is a later, separately approved DNS batch."
  type        = bool
  default     = false
}

variable "staging_operations_alert_email" {
  description = "Approved staging operations email; null keeps the subscription disabled. Never copy the prod-secondary subscription implicitly."
  type        = string
  default     = null
}
