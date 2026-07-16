output "db_endpoint" {
  value = aws_db_instance.prod_replacement.endpoint
}

output "db_address" {
  value = aws_db_instance.prod_replacement.address
}

output "db_name" {
  value = aws_db_instance.prod_replacement.db_name
}

output "db_username" {
  value = aws_db_instance.prod_replacement.username
}

output "db_security_group_id" {
  value = aws_security_group.prod_db.id
}

output "prod_certificate_arns" {
  value = {
    api       = aws_acm_certificate.prod_api.arn
    dashboard = aws_acm_certificate.prod_dashboard.arn
    survey    = aws_acm_certificate.prod_survey.arn
  }
  description = "Imported ACM certificates for demo.ona.* domains. These are preserved because DNS validation lives outside AWS."
}

output "prod_certificate_validation_records" {
  value = {
    api = [
      for dvo in aws_acm_certificate.prod_api.domain_validation_options : {
        name  = dvo.resource_record_name
        type  = dvo.resource_record_type
        value = dvo.resource_record_value
      }
    ]
    dashboard = [
      for dvo in aws_acm_certificate.prod_dashboard.domain_validation_options : {
        name  = dvo.resource_record_name
        type  = dvo.resource_record_type
        value = dvo.resource_record_value
      }
    ]
    survey = [
      for dvo in aws_acm_certificate.prod_survey.domain_validation_options : {
        name  = dvo.resource_record_name
        type  = dvo.resource_record_type
        value = dvo.resource_record_value
      }
    ]
  }
  description = "External DNS validation CNAMEs that must remain in place for ACM renewal."
}

output "replacement_resource_environment" {
  value       = var.replacement_resource_environment
  description = "Environment tag for active production deploy workflow discovery."
}

output "backend_instance_id" {
  value = module.api_backend.backend_instance_id
}

output "backend_instance_public_dns" {
  value = module.api_backend.backend_instance_public_dns
}

output "config_bucket_name" {
  value       = module.api_backend.config_bucket_name
  description = "Replacement API runtime config bucket."
}

output "artifacts_bucket_name" {
  value       = module.api_backend.artifacts_bucket_name
  description = "Replacement API release artifact bucket."
}

output "dashboard_bucket_name" {
  value       = module.dashboard_frontend.bucket_name
  description = "Replacement dashboard deployment bucket."
}

output "survey_bucket_name" {
  value       = module.survey_frontend.bucket_name
  description = "Replacement survey deployment bucket."
}

output "dashboard_distribution_id" {
  value = module.dashboard_frontend.distribution_id
}

output "survey_distribution_id" {
  value = module.survey_frontend.distribution_id
}

output "runtime_secret_parameter_names" {
  value = {
    db_password    = local.db_password_parameter_name
    session_secret = local.session_secret_parameter_name
    resend_api_key = local.resend_api_key_parameter_name
  }
  description = "Existing production SSM Parameter Store paths reused by the replacement app runtime."
}

output "api_alb_dns_name" {
  value       = module.api_backend.alb_dns_name
  description = "External DNS target: point demo.ona.api.bennetts.work CNAME here at cutover."
}

output "dashboard_cloudfront_domain" {
  value       = module.dashboard_frontend.cloudfront_domain_name
  description = "External DNS target: point demo.ona.dashboard.bennetts.work CNAME here after frontend aliases are attached."
}

output "survey_cloudfront_domain" {
  value       = module.survey_frontend.cloudfront_domain_name
  description = "External DNS target: point demo.ona.survey.bennetts.work CNAME here after frontend aliases are attached."
}
