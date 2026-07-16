data "aws_availability_zones" "available" {
  state = "available"
}

data "aws_internet_gateway" "prod_vpc" {
  filter {
    name   = "attachment.vpc-id"
    values = [var.vpc_id]
  }
}

resource "random_string" "app_suffix" {
  length  = 6
  upper   = false
  special = false
}

resource "random_id" "frontend_suffix" {
  byte_length = 4
}

locals {
  app_name_prefix = "${var.project_name}-${var.environment}-v2"

  # Runtime secrets intentionally keep the existing production Parameter Store paths.
  ssm_parameter_prefix          = "/network-survey/${var.environment}"
  db_password_parameter_name    = "${local.ssm_parameter_prefix}/db/password"
  session_secret_parameter_name = "${local.ssm_parameter_prefix}/api/session-secret"
  resend_api_key_parameter_name = "${local.ssm_parameter_prefix}/api/resend-api-key"

  frontend_url        = "https://${var.dashboard_domain}"
  survey_url          = "https://${var.survey_domain}"
  session_cookie_name = "sessionId"

  app_common_tags = merge(local.prod_app_tags, {
    # Use a distinct discovery environment until legacy prod resources are retired.
    # This avoids duplicate matches in the deploy workflow while DNS still points at the old stack.
    Environment = var.replacement_resource_environment
    Stack       = "replacement-prod-v2"
  })

  config_bucket_name    = "ona-${var.environment}-v2-config-${random_string.app_suffix.result}"
  artifacts_bucket_name = "ona-${var.environment}-v2-artifacts-${random_string.app_suffix.result}"
  dashboard_bucket_name = "ona-${var.environment}-v2-dashboard-${random_id.frontend_suffix.hex}"
  survey_bucket_name    = "ona-${var.environment}-v2-survey-${random_id.frontend_suffix.hex}"
}

resource "aws_subnet" "prod_app_public" {
  for_each = {
    a = { cidr = var.app_public_subnet_cidrs[0], az = data.aws_availability_zones.available.names[0] }
    b = { cidr = var.app_public_subnet_cidrs[1], az = data.aws_availability_zones.available.names[1] }
  }

  vpc_id                  = var.vpc_id
  cidr_block              = each.value.cidr
  availability_zone       = each.value.az
  map_public_ip_on_launch = true

  tags = merge(local.app_common_tags, { Name = "${local.app_name_prefix}-public-${each.key}" })
}

resource "aws_route_table" "prod_app_public" {
  vpc_id = var.vpc_id

  tags = merge(local.app_common_tags, { Name = "${local.app_name_prefix}-public-rt" })
}

resource "aws_route" "prod_app_default" {
  route_table_id         = aws_route_table.prod_app_public.id
  destination_cidr_block = "0.0.0.0/0"
  gateway_id             = data.aws_internet_gateway.prod_vpc.id
}

resource "aws_route_table_association" "prod_app_public" {
  for_each = aws_subnet.prod_app_public

  subnet_id      = each.value.id
  route_table_id = aws_route_table.prod_app_public.id
}

module "api_backend" {
  source = "../../modules/api_backend"

  aws_region               = var.aws_region
  environment              = var.environment
  name_prefix              = local.app_name_prefix
  vpc_id                   = var.vpc_id
  backend_subnet_id        = aws_subnet.prod_app_public["a"].id
  alb_subnet_ids           = [for subnet in aws_subnet.prod_app_public : subnet.id]
  instance_type            = var.app_instance_type
  ssh_allowed_cidrs        = var.ssh_allowed_cidrs
  ssh_key_name             = var.ssh_key_name
  certificate_arn          = aws_acm_certificate.prod_api.arn
  config_bucket_name       = local.config_bucket_name
  artifacts_bucket_name    = local.artifacts_bucket_name
  artifact_retention_days  = var.artifact_retention_days
  alb_deletion_protection  = var.alb_deletion_protection
  cloud_init_template_path = "${path.module}/../../cloud-init-template.sh"
  env_template_path        = "${path.module}/../../templates/env.tmpl"

  db_host                       = aws_db_instance.prod_replacement.address
  db_port                       = aws_db_instance.prod_replacement.port
  db_name                       = aws_db_instance.prod_replacement.db_name
  db_user                       = var.db_user
  db_password_parameter_name    = local.db_password_parameter_name
  session_secret_parameter_name = local.session_secret_parameter_name
  resend_api_key_parameter_name = local.resend_api_key_parameter_name
  frontend_url                  = local.frontend_url
  survey_url                    = local.survey_url
  session_cookie_name           = local.session_cookie_name

  common_tags           = local.app_common_tags
  config_bucket_tags    = merge(local.app_common_tags, { Name = "${local.app_name_prefix}-config", App = "ona-config" })
  artifacts_bucket_tags = merge(local.app_common_tags, { Name = "${local.app_name_prefix}-artifacts", App = "ona-artifacts" })

  backend_security_group_name        = "${local.app_name_prefix}-backend"
  backend_security_group_description = "Replacement prod API backend; ingress only from ALB"
  backend_security_group_tags        = merge(local.app_common_tags, { Name = "${local.app_name_prefix}-backend", App = "ona-api" })
  backend_api_ingress_description    = "API from ALB"

  alb_security_group_name        = "${local.app_name_prefix}-alb"
  alb_security_group_description = "Public HTTPS access to the replacement prod API ALB"
  alb_security_group_tags        = merge(local.app_common_tags, { Name = "${local.app_name_prefix}-alb" })
  alb_http_ingress_description   = "HTTP redirect"
  alb_https_ingress_description  = "HTTPS"

  backend_instance_name = "${local.app_name_prefix}-backend"
  backend_instance_tags = merge(local.app_common_tags, { App = "ona-api" })

  iam_role_name             = "${local.app_name_prefix}-ec2-role"
  iam_policy_name           = "${local.app_name_prefix}-runtime"
  iam_policy_description    = "Allow replacement prod backend to read config, artifacts, and runtime secrets"
  iam_instance_profile_name = "${local.app_name_prefix}-instance-profile"
  iam_tags                  = local.app_common_tags

  target_group_name            = "${local.app_name_prefix}-api"
  target_group_tags            = merge(local.app_common_tags, { Name = "${local.app_name_prefix}-api" })
  target_group_attachment_port = 3000
  alb_name                     = "${local.app_name_prefix}-alb"
  alb_tags                     = merge(local.app_common_tags, { Name = "${local.app_name_prefix}-alb", App = "ona-api" })
  health_check_protocol        = "HTTP"
  health_check_matcher         = "200"
  health_check_timeout         = 5
}

module "dashboard_frontend" {
  source = "../../modules/frontend_static_site"

  site_name            = "dashboard"
  bucket_name          = local.dashboard_bucket_name
  domain_name          = var.dashboard_domain
  acm_certificate_arn  = aws_acm_certificate.prod_dashboard.arn
  enable_custom_domain = var.enable_frontend_custom_domains
  origin_id            = "S3-dashboard"
  oac_name             = "${local.app_name_prefix}-dashboard-${random_id.frontend_suffix.hex}"
  oac_description      = "OAC for replacement prod dashboard"

  bucket_tags = merge(local.app_common_tags, {
    Name = "${local.app_name_prefix}-dashboard"
    App  = "ona-dashboard"
  })

  distribution_tags = merge(local.app_common_tags, {
    Name = "${local.app_name_prefix}-dashboard-cdn"
    App  = "ona-dashboard"
  })
}

module "survey_frontend" {
  source = "../../modules/frontend_static_site"

  site_name            = "survey"
  bucket_name          = local.survey_bucket_name
  domain_name          = var.survey_domain
  acm_certificate_arn  = aws_acm_certificate.prod_survey.arn
  enable_custom_domain = var.enable_frontend_custom_domains
  origin_id            = "S3-survey"
  oac_name             = "${local.app_name_prefix}-survey-${random_id.frontend_suffix.hex}"
  oac_description      = "OAC for replacement prod survey"

  bucket_tags = merge(local.app_common_tags, {
    Name = "${local.app_name_prefix}-survey"
    App  = "ona-survey"
  })

  distribution_tags = merge(local.app_common_tags, {
    Name = "${local.app_name_prefix}-survey-cdn"
    App  = "ona-survey"
  })
}
