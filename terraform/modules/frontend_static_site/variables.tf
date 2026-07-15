variable "site_name" {
  description = "Short site name used in CloudFront origin IDs and OAC names."
  type        = string
}

variable "bucket_name" {
  description = "S3 bucket name for the frontend build artifacts."
  type        = string
}

variable "domain_name" {
  description = "Custom domain name for the CloudFront distribution."
  type        = string
}

variable "acm_certificate_arn" {
  description = "ACM certificate ARN in us-east-1 for the custom domain."
  type        = string
}

variable "tags" {
  description = "Default tags applied to frontend resources."
  type        = map(string)
  default     = {}
}

variable "bucket_tags" {
  description = "Optional tags for the S3 bucket; defaults to tags."
  type        = map(string)
  default     = null
}

variable "distribution_tags" {
  description = "Optional tags for the CloudFront distribution; defaults to tags."
  type        = map(string)
  default     = null
}

variable "origin_id" {
  description = "CloudFront origin ID."
  type        = string
  default     = null
}

variable "oac_name" {
  description = "CloudFront origin access control name."
  type        = string
  default     = null
}

variable "oac_description" {
  description = "CloudFront origin access control description."
  type        = string
  default     = null
}

variable "enable_custom_domain" {
  description = "Whether to attach the custom domain alias and ACM certificate."
  type        = bool
  default     = true
}

variable "cors_allowed_origins" {
  description = "Optional CORS allowed origins for the S3 bucket."
  type        = list(string)
  default     = []
}
