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
