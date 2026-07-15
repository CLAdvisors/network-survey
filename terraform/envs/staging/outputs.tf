output "environment" {
  value = local.environment
}

output "backend_instance_id" {
  value = aws_instance.backend.id
}

output "backend_instance_public_ip" {
  value = aws_instance.backend.public_dns
}

output "db_endpoint" {
  value = aws_db_instance.postgres.endpoint
}

output "db_username" {
  value = aws_db_instance.postgres.username
}

output "config_bucket_name" {
  value       = aws_s3_bucket.config_bucket.bucket
  description = "Name of the S3 bucket where configuration files are stored"
}

output "artifacts_bucket_name" {
  value       = aws_s3_bucket.artifacts.bucket
  description = "S3 bucket where CI publishes API release artifacts"
}

output "runtime_secret_parameter_names" {
  value = {
    db_password    = local.db_password_parameter_name
    session_secret = local.session_secret_parameter_name
    resend_api_key = local.resend_api_key_parameter_name
  }
  description = "SSM Parameter Store names that must exist as SecureString values before deploys run"
}

output "dashboard_bucket_name" {
  value       = module.dashboard_frontend.bucket_name
  description = "S3 bucket the CI deploy workflow syncs dashboard builds into"
}

output "survey_bucket_name" {
  value       = module.survey_frontend.bucket_name
  description = "S3 bucket the CI deploy workflow syncs survey builds into"
}

output "dashboard_distribution_id" {
  value = module.dashboard_frontend.distribution_id
}

output "survey_distribution_id" {
  value = module.survey_frontend.distribution_id
}

output "github_actions_deploy_role_arn" {
  value       = var.manage_github_oidc ? aws_iam_role.github_actions_deploy[0].arn : null
  description = "Set this as the AWS_DEPLOY_ROLE_ARN GitHub repository variable"
}

# Output the DNS validation records for the ACM certificates
output "ssl_cert_validation_records" {
  value = [
    for dvo in aws_acm_certificate.ssl_cert.domain_validation_options : {
      name  = dvo.resource_record_name
      type  = dvo.resource_record_type
      value = dvo.resource_record_value
    }
  ]
}

output "ssl_cert_dashboard_validation_records" {
  value = [
    for dvo in aws_acm_certificate.ssl_cert_dashboard.domain_validation_options : {
      name  = dvo.resource_record_name
      type  = dvo.resource_record_type
      value = dvo.resource_record_value
    }
  ]
}

output "ssl_cert_survey_validation_records" {
  value = [
    for dvo in aws_acm_certificate.ssl_cert_survey.domain_validation_options : {
      name  = dvo.resource_record_name
      type  = dvo.resource_record_type
      value = dvo.resource_record_value
    }
  ]
}

output "alb_dns_name" {
  value       = aws_lb.main_alb.dns_name
  description = "The DNS name of the ALB. Point the API domain's CNAME record here."
}

output "dashboard_cloudfront_domain" {
  value       = module.dashboard_frontend.cloudfront_domain_name
  description = "Point the dashboard domain's CNAME record here."
}

output "survey_cloudfront_domain" {
  value       = module.survey_frontend.cloudfront_domain_name
  description = "Point the survey domain's CNAME record here."
}
