output "backend_instance_id" {
  value = aws_instance.backend.id
}

output "backend_instance_public_dns" {
  value = aws_instance.backend.public_dns
}

output "backend_security_group_id" {
  value = aws_security_group.backend_sg.id
}

output "alb_security_group_id" {
  value = aws_security_group.alb_sg.id
}

output "config_bucket_name" {
  value = aws_s3_bucket.config_bucket.bucket
}

output "artifacts_bucket_name" {
  value = aws_s3_bucket.artifacts.bucket
}

output "alb_dns_name" {
  value = aws_lb.main_alb.dns_name
}

output "alb_arn" {
  value = aws_lb.main_alb.arn
}

output "target_group_arn" {
  value = aws_lb_target_group.backend_targets.arn
}

output "operations_alert_topic_arn" {
  value       = aws_sns_topic.operations_alerts.arn
  description = "Environment-specific SNS topic used by runtime and webhook alarms."
}

output "runtime_log_group_names" {
  value       = { for name, group in aws_cloudwatch_log_group.runtime : name => group.name }
  description = "CloudWatch log groups for the API and dedicated workers."
}
