output "identity_contract" {
  description = "Authorized account, region, and exact environment contract."
  value = {
    account_id  = local.account_id
    region      = local.aws_region
    environment = local.environment
    backend_key = "envs/prod-secondary/terraform.tfstate"
  }
}

output "network" {
  value = {
    vpc_id                 = module.platform.vpc_id
    public_subnet_ids      = module.platform.public_subnet_ids
    private_app_subnet_ids = module.platform.private_app_subnet_ids
    isolated_db_subnet_ids = module.platform.isolated_db_subnet_ids
  }
}

output "autoscaling_group_name" {
  value = module.platform.autoscaling_group_name
}

output "alb_endpoint" {
  description = "AWS ALB endpoint and its explicit network-fence state."
  value = {
    dns_name      = module.platform.alb_dns_name
    access_fenced = module.platform.alb_access_fenced
  }
}

output "database" {
  description = "Private empty Multi-AZ RDS metadata. No credential value is output."
  value = {
    endpoint           = module.platform.db_endpoint
    managed_secret_arn = module.platform.db_master_secret_arn
  }
}

output "kms_key_arns" {
  value = module.platform.kms_key_arns
}

output "runtime_bucket_names" {
  value = module.platform.runtime_bucket_names
}

output "frontend_bucket_names" {
  value = module.platform.frontend_bucket_names
}

output "frontend_distributions" {
  description = "CloudFront distributions are created disabled and have no aliases."
  value       = module.platform.frontend_distributions
}

output "operations_topic_arn" {
  value = module.platform.operations_topic_arn
}

output "runtime_log_group_names" {
  value = module.platform.runtime_log_group_names
}
