output "backend_instance_public_ip" {
  value = aws_instance.backend.public_ip
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
