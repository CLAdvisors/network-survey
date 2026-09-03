module "platform" {
  source = "../../modules/prod_secondary_platform"

  account_id  = local.account_id
  aws_region  = local.aws_region
  environment = local.environment
  name_prefix = local.name_prefix

  vpc_cidr            = var.vpc_cidr
  availability_zones  = var.availability_zones
  public_subnet_cidrs = var.public_subnet_cidrs
  app_subnet_cidrs    = var.app_subnet_cidrs
  db_subnet_cidrs     = var.db_subnet_cidrs

  instance_type          = var.instance_type
  ami_id                 = var.ami_id
  alb_allowed_ipv4_cidrs = var.alb_allowed_ipv4_cidrs
  alb_certificate_arn    = var.alb_certificate_arn

  db_instance_class     = var.db_instance_class
  db_allocated_storage  = var.db_allocated_storage
  db_name               = "ONA"
  db_master_username    = "DbAdmin"
  backup_retention_days = 35

  enable_public_aws_endpoints  = var.enable_public_aws_endpoints
  custom_domains               = var.custom_domains
  enable_custom_domain_aliases = var.enable_custom_domain_aliases
  enable_owner_bootstrap       = var.enable_owner_bootstrap
  enable_resend_credentials    = var.enable_resend_credentials
  enable_resend_webhook_ingest = var.enable_resend_webhook_ingest
  enable_survey_delivery_v2    = var.enable_survey_delivery_v2
  operations_alert_email       = "bgarcia2324@gmail.com"

  common_tags = local.common_tags
}
