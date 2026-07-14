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
