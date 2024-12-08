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
  value = aws_s3_bucket.config_bucket.bucket
  description = "Name of the S3 bucket where configuration files are stored"
}

# Output the CloudFront URL
output "cloudfront_url" {
  value = aws_cloudfront_distribution.react_dashboard_distribution.domain_name
  description = "URL to access the React app via CloudFront."
}

# Output the DNS validation records for the ACM certificate

# Output the DNS validation records
output "ssl_cert_validation_records" {
  value = [
    for dvo in aws_acm_certificate.ssl_cert.domain_validation_options : {
      name   = dvo.resource_record_name
      type   = dvo.resource_record_type
      value  = dvo.resource_record_value
    }
  ]
}
output "ssl_cert_dashboard_validation_records" {
  value = [
    for dvo in aws_acm_certificate.ssl_cert_dashboard.domain_validation_options : {
      name   = dvo.resource_record_name
      type   = dvo.resource_record_type
      value  = dvo.resource_record_value
    }
  ]
}



output "alb_dns_name" {
  value = aws_lb.main_alb.dns_name
  description = "The DNS name of the ALB. Use this to configure your domain's CNAME record."
}