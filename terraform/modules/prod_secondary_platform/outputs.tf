output "vpc_id" {
  description = "Dedicated prod-secondary VPC ID."
  value       = aws_vpc.this.id
}

output "public_subnet_ids" {
  description = "Public ALB subnet IDs."
  value       = aws_subnet.public[*].id
}

output "private_app_subnet_ids" {
  description = "Private application subnet IDs."
  value       = aws_subnet.app[*].id
}

output "isolated_db_subnet_ids" {
  description = "Isolated database subnet IDs."
  value       = aws_subnet.db[*].id
}

output "autoscaling_group_name" {
  description = "Private two-instance application ASG."
  value       = aws_autoscaling_group.app.name
}

output "alb_dns_name" {
  description = "AWS ALB endpoint. It is unreachable while the CIDR allow-list is empty."
  value       = aws_lb.api.dns_name
}

output "alb_access_fenced" {
  description = "True when the ALB security group has no public ingress CIDRs."
  value       = length(var.alb_allowed_ipv4_cidrs) == 0
}

output "db_endpoint" {
  description = "Private Multi-AZ RDS endpoint."
  value       = aws_db_instance.postgres.endpoint
}

output "db_master_secret_arn" {
  description = "RDS-managed Secrets Manager secret ARN; no secret value is exposed."
  value       = aws_db_instance.postgres.master_user_secret[0].secret_arn
}

output "kms_key_arns" {
  description = "Target-owned workload and RDS CMK ARNs."
  value = {
    data = aws_kms_key.data.arn
    rds  = aws_kms_key.rds.arn
  }
}

output "runtime_bucket_names" {
  description = "Private config and immutable artifact bucket names."
  value = {
    config    = aws_s3_bucket.runtime["config"].bucket
    artifacts = aws_s3_bucket.runtime["artifacts"].bucket
  }
}

output "frontend_bucket_names" {
  description = "Private dashboard and survey origin bucket names."
  value       = { for name, bucket in aws_s3_bucket.frontend : name => bucket.bucket }
}

output "frontend_distributions" {
  description = "Disabled CloudFront endpoints retained for later separately approved activation."
  value = {
    for name, distribution in aws_cloudfront_distribution.frontend : name => {
      id          = distribution.id
      domain_name = distribution.domain_name
      enabled     = distribution.enabled
    }
  }
}

output "operations_topic_arn" {
  description = "SNS topic for prod-secondary operational alarms."
  value       = aws_sns_topic.operations.arn
}

output "runtime_log_group_names" {
  description = "KMS-encrypted runtime log groups."
  value       = { for name, group in aws_cloudwatch_log_group.runtime : name => group.name }
}
