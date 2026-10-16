data "aws_iam_policy_document" "github_staging_trust" {
  statement {
    sid     = "OnlyGitHubStagingEnvironment"
    actions = ["sts:AssumeRoleWithWebIdentity"]

    principals {
      type        = "Federated"
      identifiers = ["arn:aws:iam::${local.account_id}:oidc-provider/token.actions.githubusercontent.com"]
    }

    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values   = ["sts.amazonaws.com"]
    }

    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:sub"
      values   = ["repo:CLAdvisors/network-survey:environment:staging"]
    }
  }
}

# The platform attaches precise staging-stack permissions. No broad AWS managed
# policy is attached, and the role name/account match the fail-closed route
# guard in scripts/ci/guard-staging-route.sh; GitHub staging cannot mutate any
# existing source-account or prod-secondary resource.
resource "aws_iam_role" "github_staging_deploy" {
  name               = "${local.name_prefix}-deploy"
  assume_role_policy = data.aws_iam_policy_document.github_staging_trust.json
  tags               = local.common_tags
}

module "platform" {
  source = "../../modules/prod_secondary_platform"

  account_id  = local.account_id
  aws_region  = local.aws_region
  environment = local.environment
  name_prefix = local.name_prefix
  common_tags = local.common_tags

  vpc_cidr            = "10.30.0.0/16"
  availability_zones  = ["us-east-1a", "us-east-1b"]
  public_subnet_cidrs = ["10.30.0.0/24", "10.30.1.0/24"]
  app_subnet_cidrs    = ["10.30.10.0/24", "10.30.11.0/24"]
  db_subnet_cidrs     = ["10.30.20.0/24", "10.30.21.0/24"]

  # One NAT gateway carries staging AWS-service egress. Interface endpoints are
  # disabled (the largest cost lever) while the S3 gateway endpoint is retained,
  # keeping the private app/DB and secret boundaries intact.
  nat_gateway_count          = 1
  enable_interface_endpoints = false

  # Stage 0 ceiling: no host may start before the secure runtime, artifact and
  # session gates pass. min, desired and max are all 0.
  app_desired_capacity = var.start_staging_app ? 1 : 0
  app_max_capacity     = var.start_staging_app ? 1 : 0

  instance_type         = "t3.small"
  ami_id                = var.ami_id
  db_instance_class     = "db.t3.micro"
  db_allocated_storage  = 20
  db_multi_az           = false
  db_name               = "ONA"
  db_master_username    = "DbAdmin"
  backup_retention_days = 14

  alb_allowed_ipv4_cidrs = []
  alb_certificate_arn    = null

  enable_public_aws_endpoints = true
  custom_domains = {
    api       = "staging-api.cladvisorsurveys.com"
    dashboard = "staging-dashboard.cladvisorsurveys.com"
    survey    = "staging-surveys.cladvisorsurveys.com"
  }
  enable_custom_domain_aliases = var.enable_custom_domain_aliases

  # Provider, sending, webhook, bootstrap and delivery gates stay off.
  enable_owner_bootstrap       = false
  enable_resend_credentials    = false
  enable_resend_webhook_ingest = false
  enable_survey_delivery_v2    = false
  # This root is the only place that stamps the secure-runtime identity. It
  # makes the API, both workers and every deploy-invoked tool resolve
  # credentials transiently instead of from api/.env.prod.
  secure_runtime_enabled  = true
  operations_alert_email  = var.staging_operations_alert_email
  github_deploy_role_name = aws_iam_role.github_staging_deploy.name
}
