output "vpc_id" {
  value = module.platform.vpc_id
}

output "cloudfront_default_domains" {
  description = "CloudFront default domains for stage 0/1. Custom DNS aliases attach only after a later approved DNS batch."
  value = {
    api       = module.platform.api_cloudfront_endpoint.domain_name
    dashboard = module.platform.frontend_distributions["dashboard"].domain_name
    survey    = module.platform.frontend_distributions["survey"].domain_name
  }
}

output "custom_domain_configuration" {
  description = "ACM DNS validation CNAMEs surfaced for a later batched DNS request; no DNS record is created by this root."
  value       = module.platform.custom_domain_configuration
}
