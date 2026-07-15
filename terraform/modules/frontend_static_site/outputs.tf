output "bucket_name" {
  value       = aws_s3_bucket.this.bucket
  description = "Frontend S3 bucket name."
}

output "bucket_arn" {
  value       = aws_s3_bucket.this.arn
  description = "Frontend S3 bucket ARN."
}

output "distribution_id" {
  value       = aws_cloudfront_distribution.this.id
  description = "CloudFront distribution ID."
}

output "distribution_arn" {
  value       = aws_cloudfront_distribution.this.arn
  description = "CloudFront distribution ARN."
}

output "cloudfront_domain_name" {
  value       = aws_cloudfront_distribution.this.domain_name
  description = "CloudFront distribution domain name."
}
