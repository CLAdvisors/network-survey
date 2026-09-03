data "aws_caller_identity" "current" {}
data "aws_partition" "current" {}

data "aws_ami" "ubuntu" {
  count = var.ami_id == null ? 1 : 0

  most_recent = true
  owners      = ["099720109477"]

  filter {
    name   = "name"
    values = ["ubuntu/images/hvm-ssd/ubuntu-jammy-22.04-amd64-server-*"]
  }

  filter {
    name   = "architecture"
    values = ["x86_64"]
  }

  filter {
    name   = "virtualization-type"
    values = ["hvm"]
  }
}

data "aws_prefix_list" "s3" {
  name = "com.amazonaws.${var.aws_region}.s3"
}

data "aws_ec2_managed_prefix_list" "cloudfront_origin" {
  name = "com.amazonaws.global.cloudfront.origin-facing"
}

data "aws_cloudfront_cache_policy" "caching_disabled" {
  name = "Managed-CachingDisabled"
}

data "aws_cloudfront_origin_request_policy" "all_viewer_and_cloudfront" {
  name = "Managed-AllViewerAndCloudFrontHeaders-2022-06"
}

locals {
  selected_ami_id = coalesce(var.ami_id, try(data.aws_ami.ubuntu[0].id, null))

  bucket_names = {
    config    = "network-survey-prod-secondary-config-${var.account_id}"
    artifacts = "network-survey-prod-secondary-artifacts-${var.account_id}"
    dashboard = "network-survey-prod-secondary-dashboard-${var.account_id}"
    survey    = "network-survey-prod-secondary-survey-${var.account_id}"
  }

  runtime_config = join("\n", [
    "ENVIRONMENT=prod-secondary",
    "DB_NAME=${var.db_name}",
    "DB_HOST=${aws_db_instance.postgres.address}",
    "DB_PORT=${aws_db_instance.postgres.port}",
    "DB_USER=${var.db_master_username}",
    "DB_MANAGED_SECRET_ARN=${aws_db_instance.postgres.master_user_secret[0].secret_arn}",
    "DB_SSL=true",
    "DB_SSL_CA=/opt/service/certs/rds-global-bundle.pem",
    "SESSION_SECRET_PARAMETER=/network-survey/prod-secondary/api/session-secret",
    "SESSION_COOKIE_NAME=prodSecondarySessionId",
    "TRUST_CLOUDFRONT_VIEWER_PROTO=true",
    "ALLOW_PUBLIC_SIGNUP=false",
    "FRONTEND_URL=https://${var.enable_custom_domain_aliases ? var.custom_domains.dashboard : aws_cloudfront_distribution.frontend["dashboard"].domain_name}",
    "SURVEY_URL=https://${var.enable_custom_domain_aliases ? var.custom_domains.survey : aws_cloudfront_distribution.frontend["survey"].domain_name}",
    "EMAIL_WORKER_ENV=prod-secondary",
    "EMAIL_RATE_BUDGET_ENV=prod-secondary",
    "SURVEY_DELIVERY_V2_ENABLED=false",
    "LEGACY_START_ENABLED=false",
    "EMAIL_CLAIMING_ENABLED=false",
    "EMAIL_SENDING_ENABLED=false",
    "RESEND_CREDENTIAL_LOAD_ENABLED=${var.enable_resend_credentials}",
    "RESEND_API_KEY_PARAMETER=${var.enable_resend_credentials ? "/network-survey/prod-secondary/resend/api-key" : ""}",
    "RESEND_PROVIDER_ACCOUNT_SCOPE=network-survey-resend-prod-secondary",
    "SURVEY_EMAIL_SENDER=CLA Survey <survey@cladvisorsurveys.com>",
    "SURVEY_EMAIL_REPLY_TO=survey@cladvisors.com",
    "RESEND_WEBHOOK_SECRET_PARAMETER=${var.enable_resend_webhook_ingest ? "/network-survey/prod-secondary/resend/webhook-secret" : ""}",
    "RESEND_WEBHOOK_PREVIOUS_SECRET_PARAMETER=${var.enable_resend_webhook_ingest ? "/network-survey/prod-secondary/resend/webhook-previous-secret" : ""}",
    "RESEND_WEBHOOK_INGEST_ENABLED=${var.enable_resend_webhook_ingest}",
    "WEBHOOK_PROCESSING_ENABLED=false",
    "BOOTSTRAP_ENABLED=${var.enable_owner_bootstrap}",
    "BOOTSTRAP_ADMIN_USERNAME=",
    "BOOTSTRAP_ADMIN_EMAIL=",
    "BOOTSTRAP_ADMIN_IDENTITY_PARAMETER=${var.enable_owner_bootstrap ? "/network-survey/prod-secondary/api/bootstrap-admin-identity" : ""}",
    "BOOTSTRAP_ADMIN_PASSWORD_PARAMETER=${var.enable_owner_bootstrap ? "/network-survey/prod-secondary/api/bootstrap-admin-password" : ""}",
    "BOOTSTRAP_ORGANIZATION_NAME=CLA",
    "BOOTSTRAP_ORGANIZATION_SLUG=cla",
    "BOOTSTRAP_PLATFORM_ADMIN=false",
    "BOOTSTRAP_ACCOUNT_MODE=create-or-verify",
    "CLA_PRODUCTION_CUTOVER=false",
    "PUBLIC_TRAFFIC_ENABLED=${var.enable_public_aws_endpoints}",
    "",
  ])

  endpoint_services = toset([
    "ec2messages",
    "kms",
    "logs",
    "secretsmanager",
    "ssm",
    "ssmmessages",
  ])
}

resource "terraform_data" "safety_contract" {
  input = {
    account_id  = data.aws_caller_identity.current.account_id
    environment = var.environment
  }

  lifecycle {
    precondition {
      condition     = data.aws_caller_identity.current.account_id == var.account_id
      error_message = "Refusing to manage resources outside the authorized target account."
    }

    precondition {
      condition     = var.account_id == "710054969994" && var.aws_region == "us-east-1"
      error_message = "This stack is authorized only for account 710054969994 in us-east-1."
    }

    precondition {
      condition     = anytrue([for prefix in var.allowed_instance_type_prefixes : startswith(var.instance_type, prefix)])
      error_message = "instance_type is outside the approved small-instance families."
    }
  }
}

resource "aws_s3_account_public_access_block" "this" {
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true

  depends_on = [terraform_data.safety_contract]
}

resource "aws_iam_service_linked_role" "autoscaling" {
  aws_service_name = "autoscaling.amazonaws.com"
  description      = "Service-linked role for the prod-secondary private ASG"
}

data "aws_iam_policy_document" "data_kms" {
  statement {
    sid       = "EnableAccountIAM"
    effect    = "Allow"
    actions   = ["kms:*"]
    resources = ["*"]

    principals {
      type        = "AWS"
      identifiers = ["arn:${data.aws_partition.current.partition}:iam::${var.account_id}:root"]
    }
  }

  statement {
    sid    = "AllowCloudWatchLogs"
    effect = "Allow"
    actions = [
      "kms:Decrypt",
      "kms:DescribeKey",
      "kms:Encrypt",
      "kms:GenerateDataKey*",
      "kms:ReEncrypt*",
    ]
    resources = ["*"]

    principals {
      type        = "Service"
      identifiers = ["logs.${var.aws_region}.amazonaws.com"]
    }

    condition {
      test     = "ArnLike"
      variable = "kms:EncryptionContext:aws:logs:arn"
      values   = ["arn:${data.aws_partition.current.partition}:logs:${var.aws_region}:${var.account_id}:log-group:/network-survey/prod-secondary/*"]
    }
  }

  statement {
    sid    = "AllowAutoScalingEncryptedVolumes"
    effect = "Allow"
    actions = [
      "kms:CreateGrant",
      "kms:Decrypt",
      "kms:DescribeKey",
      "kms:Encrypt",
      "kms:GenerateDataKey*",
      "kms:ReEncrypt*",
    ]
    resources = ["*"]

    principals {
      type        = "AWS"
      identifiers = [aws_iam_service_linked_role.autoscaling.arn]
    }
  }
}

resource "aws_kms_key" "data" {
  description             = "prod-secondary application, S3, logs, and EBS encryption"
  enable_key_rotation     = true
  deletion_window_in_days = 30
  policy                  = data.aws_iam_policy_document.data_kms.json
  tags                    = merge(var.common_tags, { Name = "${var.name_prefix}-data-kms" })
}

resource "aws_kms_alias" "data" {
  name          = "alias/${var.name_prefix}-data"
  target_key_id = aws_kms_key.data.key_id
}

resource "aws_kms_key" "rds" {
  description             = "prod-secondary RDS storage and RDS-managed master secret encryption"
  enable_key_rotation     = true
  deletion_window_in_days = 30
  tags                    = merge(var.common_tags, { Name = "${var.name_prefix}-rds-kms" })
}

resource "aws_kms_alias" "rds" {
  name          = "alias/${var.name_prefix}-rds"
  target_key_id = aws_kms_key.rds.key_id
}

resource "aws_ebs_encryption_by_default" "this" {
  enabled = true
}

resource "aws_ebs_default_kms_key" "this" {
  key_arn = aws_kms_key.data.arn

  depends_on = [aws_ebs_encryption_by_default.this]
}

resource "aws_vpc" "this" {
  cidr_block           = var.vpc_cidr
  enable_dns_support   = true
  enable_dns_hostnames = true

  tags = merge(var.common_tags, { Name = "${var.name_prefix}-vpc" })
}

resource "aws_internet_gateway" "this" {
  vpc_id = aws_vpc.this.id
  tags   = merge(var.common_tags, { Name = "${var.name_prefix}-igw" })
}

resource "aws_subnet" "public" {
  count = 2

  vpc_id                  = aws_vpc.this.id
  availability_zone       = var.availability_zones[count.index]
  cidr_block              = var.public_subnet_cidrs[count.index]
  map_public_ip_on_launch = false

  tags = merge(var.common_tags, {
    Name = "${var.name_prefix}-public-${count.index + 1}"
    Tier = "public-alb"
  })
}

resource "aws_subnet" "app" {
  count = 2

  vpc_id                  = aws_vpc.this.id
  availability_zone       = var.availability_zones[count.index]
  cidr_block              = var.app_subnet_cidrs[count.index]
  map_public_ip_on_launch = false

  tags = merge(var.common_tags, {
    Name = "${var.name_prefix}-private-app-${count.index + 1}"
    Tier = "private-app"
  })
}

resource "aws_subnet" "db" {
  count = 2

  vpc_id                  = aws_vpc.this.id
  availability_zone       = var.availability_zones[count.index]
  cidr_block              = var.db_subnet_cidrs[count.index]
  map_public_ip_on_launch = false

  tags = merge(var.common_tags, {
    Name = "${var.name_prefix}-isolated-db-${count.index + 1}"
    Tier = "isolated-db"
  })
}

resource "aws_route_table" "public" {
  vpc_id = aws_vpc.this.id
  tags   = merge(var.common_tags, { Name = "${var.name_prefix}-public-routes" })
}

resource "aws_route" "public_internet" {
  route_table_id         = aws_route_table.public.id
  destination_cidr_block = "0.0.0.0/0"
  gateway_id             = aws_internet_gateway.this.id
}

resource "aws_route_table_association" "public" {
  count = 2

  subnet_id      = aws_subnet.public[count.index].id
  route_table_id = aws_route_table.public.id
}

resource "aws_eip" "nat" {
  count  = 2
  domain = "vpc"

  tags       = merge(var.common_tags, { Name = "${var.name_prefix}-nat-${count.index + 1}" })
  depends_on = [aws_internet_gateway.this]
}

resource "aws_nat_gateway" "this" {
  count = 2

  allocation_id = aws_eip.nat[count.index].id
  subnet_id     = aws_subnet.public[count.index].id

  connectivity_type = "public"
  tags              = merge(var.common_tags, { Name = "${var.name_prefix}-nat-${count.index + 1}" })

  depends_on = [aws_route.public_internet]
}

resource "aws_route_table" "app" {
  count = 2

  vpc_id = aws_vpc.this.id
  tags   = merge(var.common_tags, { Name = "${var.name_prefix}-private-app-routes-${count.index + 1}" })
}

resource "aws_route" "app_egress" {
  count = 2

  route_table_id         = aws_route_table.app[count.index].id
  destination_cidr_block = "0.0.0.0/0"
  nat_gateway_id         = aws_nat_gateway.this[count.index].id
}

resource "aws_route_table_association" "app" {
  count = 2

  subnet_id      = aws_subnet.app[count.index].id
  route_table_id = aws_route_table.app[count.index].id
}

resource "aws_route_table" "db" {
  count = 2

  vpc_id = aws_vpc.this.id
  tags   = merge(var.common_tags, { Name = "${var.name_prefix}-isolated-db-routes-${count.index + 1}" })
}

resource "aws_route_table_association" "db" {
  count = 2

  subnet_id      = aws_subnet.db[count.index].id
  route_table_id = aws_route_table.db[count.index].id
}

resource "aws_security_group" "app" {
  name        = "${var.name_prefix}-app"
  description = "Private application instances"
  vpc_id      = aws_vpc.this.id

  tags = merge(var.common_tags, { Name = "${var.name_prefix}-app-sg" })
}

resource "aws_security_group" "endpoints" {
  name        = "${var.name_prefix}-endpoints"
  description = "Private AWS service endpoints"
  vpc_id      = aws_vpc.this.id

  tags = merge(var.common_tags, { Name = "${var.name_prefix}-endpoints-sg" })
}

resource "aws_vpc_security_group_ingress_rule" "endpoints_from_app" {
  security_group_id            = aws_security_group.endpoints.id
  referenced_security_group_id = aws_security_group.app.id
  description                  = "HTTPS from private application instances"
  ip_protocol                  = "tcp"
  from_port                    = 443
  to_port                      = 443
}

resource "aws_vpc_security_group_egress_rule" "app_to_endpoints" {
  security_group_id            = aws_security_group.app.id
  referenced_security_group_id = aws_security_group.endpoints.id
  description                  = "HTTPS to private AWS service endpoints"
  ip_protocol                  = "tcp"
  from_port                    = 443
  to_port                      = 443
}

resource "aws_vpc_security_group_egress_rule" "app_web_https" {
  security_group_id = aws_security_group.app.id
  cidr_ipv4         = "0.0.0.0/0"
  description       = "Controlled HTTPS egress through the per-AZ NAT gateway"
  ip_protocol       = "tcp"
  from_port         = 443
  to_port           = 443
}

resource "aws_vpc_security_group_egress_rule" "app_web_http" {
  security_group_id = aws_security_group.app.id
  cidr_ipv4         = "0.0.0.0/0"
  description       = "Package repository HTTP egress through the per-AZ NAT gateway"
  ip_protocol       = "tcp"
  from_port         = 80
  to_port           = 80
}

resource "aws_vpc_security_group_egress_rule" "app_to_s3" {
  security_group_id = aws_security_group.app.id
  prefix_list_id    = data.aws_prefix_list.s3.id
  description       = "HTTPS to S3 through the gateway endpoint"
  ip_protocol       = "tcp"
  from_port         = 443
  to_port           = 443
}

resource "aws_vpc_endpoint" "interface" {
  for_each = local.endpoint_services

  vpc_id              = aws_vpc.this.id
  service_name        = "com.amazonaws.${var.aws_region}.${each.value}"
  vpc_endpoint_type   = "Interface"
  private_dns_enabled = true
  subnet_ids          = aws_subnet.app[*].id
  security_group_ids  = [aws_security_group.endpoints.id]

  tags = merge(var.common_tags, { Name = "${var.name_prefix}-${each.value}-endpoint" })
}

resource "aws_vpc_endpoint" "s3" {
  vpc_id            = aws_vpc.this.id
  service_name      = "com.amazonaws.${var.aws_region}.s3"
  vpc_endpoint_type = "Gateway"
  route_table_ids   = aws_route_table.app[*].id

  tags = merge(var.common_tags, { Name = "${var.name_prefix}-s3-endpoint" })
}

resource "aws_security_group" "alb" {
  name        = "${var.name_prefix}-alb"
  description = "CIDR-fenced public ALB; empty ingress means no endpoint access"
  vpc_id      = aws_vpc.this.id

  tags = merge(var.common_tags, { Name = "${var.name_prefix}-alb-sg" })
}

resource "aws_vpc_security_group_ingress_rule" "alb_from_cloudfront" {
  count = var.enable_public_aws_endpoints ? 1 : 0

  security_group_id = aws_security_group.alb.id
  prefix_list_id    = data.aws_ec2_managed_prefix_list.cloudfront_origin.id
  description       = "HTTP origin traffic only from CloudFront managed edge addresses"
  ip_protocol       = "tcp"
  from_port         = 80
  to_port           = 80
}

resource "aws_vpc_security_group_ingress_rule" "alb_http" {
  for_each = var.alb_certificate_arn == null ? toset(var.alb_allowed_ipv4_cidrs) : toset([])

  security_group_id = aws_security_group.alb.id
  cidr_ipv4         = each.value
  description       = "Approved endpoint-first HTTP validation CIDR"
  ip_protocol       = "tcp"
  from_port         = 80
  to_port           = 80
}

resource "aws_vpc_security_group_ingress_rule" "alb_https" {
  for_each = var.alb_certificate_arn == null ? toset([]) : toset(var.alb_allowed_ipv4_cidrs)

  security_group_id = aws_security_group.alb.id
  cidr_ipv4         = each.value
  description       = "Approved endpoint-first HTTPS validation CIDR"
  ip_protocol       = "tcp"
  from_port         = 443
  to_port           = 443
}

resource "aws_vpc_security_group_egress_rule" "alb_to_app" {
  security_group_id            = aws_security_group.alb.id
  referenced_security_group_id = aws_security_group.app.id
  description                  = "API traffic to private application instances"
  ip_protocol                  = "tcp"
  from_port                    = 3000
  to_port                      = 3000
}

resource "aws_vpc_security_group_ingress_rule" "app_from_alb" {
  security_group_id            = aws_security_group.app.id
  referenced_security_group_id = aws_security_group.alb.id
  description                  = "API traffic from the ALB"
  ip_protocol                  = "tcp"
  from_port                    = 3000
  to_port                      = 3000
}

resource "aws_lb" "api" {
  # ALB names are limited to 32 characters; the canonical prefix is 29.
  name                       = var.name_prefix
  internal                   = false
  load_balancer_type         = "application"
  security_groups            = [aws_security_group.alb.id]
  subnets                    = aws_subnet.public[*].id
  drop_invalid_header_fields = true
  enable_deletion_protection = true

  tags = merge(var.common_tags, { Name = "${var.name_prefix}-alb", App = "ona-api" })
}

resource "aws_lb_target_group" "api" {
  # Target-group names have the same 32-character limit.
  name        = "${var.name_prefix}-tg"
  port        = 3000
  protocol    = "HTTP"
  target_type = "instance"
  vpc_id      = aws_vpc.this.id

  health_check {
    enabled             = true
    healthy_threshold   = 2
    interval            = 30
    matcher             = "200"
    path                = "/health"
    port                = "traffic-port"
    protocol            = "HTTP"
    timeout             = 5
    unhealthy_threshold = 3
  }

  deregistration_delay = 30
  tags                 = merge(var.common_tags, { Name = "${var.name_prefix}-api-targets", App = "ona-api" })
}

resource "aws_lb_listener" "http_forward" {
  count = var.alb_certificate_arn == null ? 1 : 0

  load_balancer_arn = aws_lb.api.arn
  port              = 80
  protocol          = "HTTP"

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.api.arn
  }
}

resource "aws_lb_listener" "http_redirect" {
  count = var.alb_certificate_arn == null ? 0 : 1

  load_balancer_arn = aws_lb.api.arn
  port              = 80
  protocol          = "HTTP"

  default_action {
    type = "redirect"

    redirect {
      port        = "443"
      protocol    = "HTTPS"
      status_code = "HTTP_301"
    }
  }
}

resource "aws_lb_listener" "https" {
  count = var.alb_certificate_arn == null ? 0 : 1

  load_balancer_arn = aws_lb.api.arn
  port              = 443
  protocol          = "HTTPS"
  certificate_arn   = var.alb_certificate_arn
  ssl_policy        = "ELBSecurityPolicy-TLS13-1-2-2021-06"

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.api.arn
  }
}

resource "aws_acm_certificate" "cloudfront" {
  domain_name               = var.custom_domains.api
  subject_alternative_names = [var.custom_domains.dashboard, var.custom_domains.survey]
  validation_method         = "DNS"

  options {
    certificate_transparency_logging_preference = "ENABLED"
  }

  lifecycle {
    create_before_destroy = true
  }

  tags = merge(var.common_tags, { Name = "${var.name_prefix}-cloudfront" })
}

resource "aws_cloudfront_distribution" "api" {
  enabled         = var.enable_public_aws_endpoints
  is_ipv6_enabled = true
  aliases         = var.enable_custom_domain_aliases ? [var.custom_domains.api] : []
  comment         = "prod-secondary API edge"

  origin {
    domain_name = aws_lb.api.dns_name
    origin_id   = "prod-secondary-api-alb"

    custom_origin_config {
      http_port              = 80
      https_port             = 443
      origin_protocol_policy = "http-only"
      origin_ssl_protocols   = ["TLSv1.2"]
    }
  }

  default_cache_behavior {
    allowed_methods        = ["DELETE", "GET", "HEAD", "OPTIONS", "PATCH", "POST", "PUT"]
    cached_methods         = ["GET", "HEAD"]
    target_origin_id       = "prod-secondary-api-alb"
    viewer_protocol_policy = "redirect-to-https"
    compress               = true

    cache_policy_id          = data.aws_cloudfront_cache_policy.caching_disabled.id
    origin_request_policy_id = data.aws_cloudfront_origin_request_policy.all_viewer_and_cloudfront.id
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    cloudfront_default_certificate = !var.enable_custom_domain_aliases
    acm_certificate_arn            = var.enable_custom_domain_aliases ? aws_acm_certificate.cloudfront.arn : null
    ssl_support_method             = var.enable_custom_domain_aliases ? "sni-only" : null
    minimum_protocol_version       = var.enable_custom_domain_aliases ? "TLSv1.2_2021" : "TLSv1"
  }

  tags = merge(var.common_tags, { Name = "${var.name_prefix}-api-edge", App = "ona-api-edge" })
}

resource "aws_db_subnet_group" "this" {
  name       = "${var.name_prefix}-db"
  subnet_ids = aws_subnet.db[*].id
  tags       = merge(var.common_tags, { Name = "${var.name_prefix}-db-subnet-group" })
}

resource "aws_security_group" "db" {
  name        = "${var.name_prefix}-db"
  description = "PostgreSQL only from private application instances"
  vpc_id      = aws_vpc.this.id

  tags = merge(var.common_tags, { Name = "${var.name_prefix}-db-sg" })
}

resource "aws_vpc_security_group_ingress_rule" "db_from_app" {
  security_group_id            = aws_security_group.db.id
  referenced_security_group_id = aws_security_group.app.id
  description                  = "PostgreSQL from private application instances"
  ip_protocol                  = "tcp"
  from_port                    = 5432
  to_port                      = 5432
}

resource "aws_vpc_security_group_egress_rule" "app_to_db" {
  security_group_id            = aws_security_group.app.id
  referenced_security_group_id = aws_security_group.db.id
  description                  = "PostgreSQL to isolated RDS"
  ip_protocol                  = "tcp"
  from_port                    = 5432
  to_port                      = 5432
}

resource "aws_db_instance" "postgres" {
  identifier = "${var.name_prefix}-postgres"

  allocated_storage     = var.db_allocated_storage
  max_allocated_storage = max(var.db_allocated_storage, 100)
  storage_type          = "gp3"
  storage_encrypted     = true
  kms_key_id            = aws_kms_key.rds.arn

  engine         = "postgres"
  engine_version = "15.18"
  instance_class = var.db_instance_class
  db_name        = var.db_name
  username       = var.db_master_username
  port           = 5432

  manage_master_user_password   = true
  master_user_secret_kms_key_id = aws_kms_key.rds.arn

  multi_az               = true
  publicly_accessible    = false
  db_subnet_group_name   = aws_db_subnet_group.this.name
  vpc_security_group_ids = [aws_security_group.db.id]
  parameter_group_name   = "default.postgres15"

  backup_retention_period   = var.backup_retention_days
  backup_window             = "03:00-04:00"
  maintenance_window        = "sun:05:00-sun:06:00"
  copy_tags_to_snapshot     = true
  deletion_protection       = true
  skip_final_snapshot       = false
  final_snapshot_identifier = "${var.name_prefix}-postgres-final"

  enabled_cloudwatch_logs_exports = ["postgresql", "upgrade"]
  performance_insights_enabled    = true
  performance_insights_kms_key_id = aws_kms_key.rds.arn

  apply_immediately = false

  lifecycle {
    prevent_destroy = true
  }

  tags = merge(var.common_tags, { Name = "${var.name_prefix}-postgres", App = "ona-database" })
}

resource "aws_cloudwatch_log_group" "runtime" {
  for_each = toset(["api", "email-worker", "webhook-worker"])

  name              = "/network-survey/prod-secondary/${each.value}"
  retention_in_days = 30
  kms_key_id        = aws_kms_key.data.arn
  tags              = merge(var.common_tags, { App = "ona-${each.value}" })
}

resource "aws_sns_topic" "operations" {
  name              = "${var.name_prefix}-operations"
  kms_master_key_id = "alias/aws/sns"
  tags              = merge(var.common_tags, { App = "ona-operations" })
}

data "aws_iam_policy_document" "operations_topic" {
  statement {
    sid       = "AccountAdministration"
    effect    = "Allow"
    actions   = ["SNS:GetTopicAttributes", "SNS:SetTopicAttributes", "SNS:AddPermission", "SNS:RemovePermission", "SNS:DeleteTopic", "SNS:Subscribe", "SNS:ListSubscriptionsByTopic", "SNS:Publish"]
    resources = [aws_sns_topic.operations.arn]

    principals {
      type        = "AWS"
      identifiers = ["arn:${data.aws_partition.current.partition}:iam::${var.account_id}:root"]
    }
  }

  statement {
    sid       = "CloudWatchAlarmPublish"
    effect    = "Allow"
    actions   = ["SNS:Publish"]
    resources = [aws_sns_topic.operations.arn]

    principals {
      type        = "Service"
      identifiers = ["cloudwatch.amazonaws.com"]
    }

    condition {
      test     = "StringEquals"
      variable = "AWS:SourceAccount"
      values   = [var.account_id]
    }
  }
}

resource "aws_sns_topic_policy" "operations" {
  arn    = aws_sns_topic.operations.arn
  policy = data.aws_iam_policy_document.operations_topic.json
}

resource "aws_sns_topic_subscription" "operations_email" {
  topic_arn = aws_sns_topic.operations.arn
  protocol  = "email"
  endpoint  = var.operations_alert_email
}

resource "aws_cloudwatch_metric_alarm" "alb_unhealthy" {
  alarm_name          = "${var.name_prefix}-alb-unhealthy-targets"
  alarm_description   = "One or more prod-secondary API targets are unhealthy."
  namespace           = "AWS/ApplicationELB"
  metric_name         = "UnHealthyHostCount"
  dimensions          = { LoadBalancer = aws_lb.api.arn_suffix, TargetGroup = aws_lb_target_group.api.arn_suffix }
  comparison_operator = "GreaterThanThreshold"
  threshold           = 0
  evaluation_periods  = 2
  datapoints_to_alarm = 2
  period              = 60
  statistic           = "Maximum"
  treat_missing_data  = "breaching"
  alarm_actions       = [aws_sns_topic.operations.arn]
  ok_actions          = [aws_sns_topic.operations.arn]
  tags                = var.common_tags
}

resource "aws_cloudwatch_metric_alarm" "asg_capacity" {
  alarm_name          = "${var.name_prefix}-asg-capacity"
  alarm_description   = "Prod-secondary ASG has fewer than two in-service instances."
  namespace           = "AWS/AutoScaling"
  metric_name         = "GroupInServiceInstances"
  dimensions          = { AutoScalingGroupName = aws_autoscaling_group.app.name }
  comparison_operator = "LessThanThreshold"
  threshold           = 2
  evaluation_periods  = 2
  datapoints_to_alarm = 2
  period              = 60
  statistic           = "Minimum"
  treat_missing_data  = "breaching"
  alarm_actions       = [aws_sns_topic.operations.arn]
  ok_actions          = [aws_sns_topic.operations.arn]
  tags                = var.common_tags
}

resource "aws_cloudwatch_metric_alarm" "rds_cpu" {
  alarm_name          = "${var.name_prefix}-rds-high-cpu"
  alarm_description   = "Prod-secondary RDS CPU exceeds 80 percent."
  namespace           = "AWS/RDS"
  metric_name         = "CPUUtilization"
  dimensions          = { DBInstanceIdentifier = aws_db_instance.postgres.identifier }
  comparison_operator = "GreaterThanThreshold"
  threshold           = 80
  evaluation_periods  = 3
  datapoints_to_alarm = 3
  period              = 300
  statistic           = "Average"
  treat_missing_data  = "breaching"
  alarm_actions       = [aws_sns_topic.operations.arn]
  ok_actions          = [aws_sns_topic.operations.arn]
  tags                = var.common_tags
}

resource "aws_cloudwatch_metric_alarm" "rds_storage" {
  alarm_name          = "${var.name_prefix}-rds-low-storage"
  alarm_description   = "Prod-secondary RDS free storage is below 2 GiB."
  namespace           = "AWS/RDS"
  metric_name         = "FreeStorageSpace"
  dimensions          = { DBInstanceIdentifier = aws_db_instance.postgres.identifier }
  comparison_operator = "LessThanThreshold"
  threshold           = 2147483648
  evaluation_periods  = 2
  datapoints_to_alarm = 2
  period              = 300
  statistic           = "Minimum"
  treat_missing_data  = "breaching"
  alarm_actions       = [aws_sns_topic.operations.arn]
  ok_actions          = [aws_sns_topic.operations.arn]
  tags                = var.common_tags
}

resource "aws_s3_bucket" "runtime" {
  for_each = {
    config    = local.bucket_names.config
    artifacts = local.bucket_names.artifacts
  }

  bucket = each.value
  tags = merge(var.common_tags, {
    Name = each.value
    App  = each.key == "config" ? "ona-config" : "ona-artifacts"
  })
}

resource "aws_s3_bucket_public_access_block" "runtime" {
  for_each = aws_s3_bucket.runtime

  bucket                  = each.value.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_ownership_controls" "runtime" {
  for_each = aws_s3_bucket.runtime

  bucket = each.value.id

  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

resource "aws_s3_bucket_versioning" "runtime" {
  for_each = aws_s3_bucket.runtime

  bucket = each.value.id

  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "runtime" {
  for_each = aws_s3_bucket.runtime

  bucket = each.value.id

  rule {
    bucket_key_enabled = true

    apply_server_side_encryption_by_default {
      kms_master_key_id = aws_kms_key.data.arn
      sse_algorithm     = "aws:kms"
    }
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "artifacts" {
  bucket = aws_s3_bucket.runtime["artifacts"].id

  rule {
    id     = "expire-noncurrent-artifacts"
    status = "Enabled"

    filter {
      prefix = "api/"
    }

    noncurrent_version_expiration {
      noncurrent_days = 30
    }
  }
}

data "aws_iam_policy_document" "runtime_bucket" {
  for_each = aws_s3_bucket.runtime

  statement {
    sid       = "DenyInsecureTransport"
    effect    = "Deny"
    actions   = ["s3:*"]
    resources = [each.value.arn, "${each.value.arn}/*"]

    principals {
      type        = "*"
      identifiers = ["*"]
    }

    condition {
      test     = "Bool"
      variable = "aws:SecureTransport"
      values   = ["false"]
    }
  }
}

resource "aws_s3_bucket_policy" "runtime" {
  for_each = aws_s3_bucket.runtime

  bucket = each.value.id
  policy = data.aws_iam_policy_document.runtime_bucket[each.key].json
}

resource "aws_s3_object" "runtime_config" {
  bucket                 = aws_s3_bucket.runtime["config"].id
  key                    = "configs/.env.prod-secondary"
  content                = local.runtime_config
  server_side_encryption = "aws:kms"
  kms_key_id             = aws_kms_key.data.arn
  content_type           = "text/plain"

  depends_on = [aws_s3_bucket_server_side_encryption_configuration.runtime]
}

data "aws_iam_policy_document" "ec2_assume" {
  statement {
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["ec2.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "app" {
  name               = "${var.name_prefix}-app"
  assume_role_policy = data.aws_iam_policy_document.ec2_assume.json
  tags               = merge(var.common_tags, { App = "ona-api" })
}

data "aws_iam_policy_document" "app" {
  statement {
    sid     = "ReadRuntimeObjects"
    effect  = "Allow"
    actions = ["s3:GetObject"]
    resources = [
      "${aws_s3_bucket.runtime["config"].arn}/configs/*",
      "${aws_s3_bucket.runtime["artifacts"].arn}/api/*",
    ]
  }

  statement {
    sid       = "ListArtifacts"
    effect    = "Allow"
    actions   = ["s3:ListBucket"]
    resources = [aws_s3_bucket.runtime["artifacts"].arn]

    condition {
      test     = "StringLike"
      variable = "s3:prefix"
      values   = ["api/*"]
    }
  }

  statement {
    sid     = "ReadRuntimeParameters"
    effect  = "Allow"
    actions = ["ssm:GetParameter", "ssm:GetParameters"]
    resources = concat(
      ["arn:${data.aws_partition.current.partition}:ssm:${var.aws_region}:${var.account_id}:parameter/network-survey/prod-secondary/api/session-secret"],
      var.enable_resend_credentials ? [
        "arn:${data.aws_partition.current.partition}:ssm:${var.aws_region}:${var.account_id}:parameter/network-survey/prod-secondary/resend/api-key",
      ] : [],
      var.enable_resend_webhook_ingest ? [
        "arn:${data.aws_partition.current.partition}:ssm:${var.aws_region}:${var.account_id}:parameter/network-survey/prod-secondary/resend/webhook-secret",
        "arn:${data.aws_partition.current.partition}:ssm:${var.aws_region}:${var.account_id}:parameter/network-survey/prod-secondary/resend/webhook-previous-secret",
      ] : [],
      var.enable_owner_bootstrap ? [
        "arn:${data.aws_partition.current.partition}:ssm:${var.aws_region}:${var.account_id}:parameter/network-survey/prod-secondary/api/bootstrap-admin-identity",
        "arn:${data.aws_partition.current.partition}:ssm:${var.aws_region}:${var.account_id}:parameter/network-survey/prod-secondary/api/bootstrap-admin-password",
      ] : [],
    )
  }

  statement {
    sid       = "ReadRDSManagedSecret"
    effect    = "Allow"
    actions   = ["secretsmanager:DescribeSecret", "secretsmanager:GetSecretValue"]
    resources = [aws_db_instance.postgres.master_user_secret[0].secret_arn]
  }

  statement {
    sid       = "DecryptTargetDataOnly"
    effect    = "Allow"
    actions   = ["kms:Decrypt", "kms:DescribeKey"]
    resources = [aws_kms_key.data.arn, aws_kms_key.rds.arn]
  }

  statement {
    sid       = "WriteRuntimeLogs"
    effect    = "Allow"
    actions   = ["logs:CreateLogStream", "logs:DescribeLogStreams", "logs:PutLogEvents"]
    resources = [for group in aws_cloudwatch_log_group.runtime : "${group.arn}:*"]
  }
}

resource "aws_iam_role_policy" "app" {
  name   = "${var.name_prefix}-runtime"
  role   = aws_iam_role.app.id
  policy = data.aws_iam_policy_document.app.json
}

data "aws_iam_policy_document" "ssm_core_without_parameter_reads" {
  statement {
    effect = "Allow"
    actions = [
      "ssm:DescribeAssociation", "ssm:DescribeDocument", "ssm:GetDeployablePatchSnapshotForInstance",
      "ssm:GetDocument", "ssm:GetManifest", "ssm:ListAssociations", "ssm:ListInstanceAssociations",
      "ssm:PutComplianceItems", "ssm:PutConfigurePackageResult", "ssm:PutInventory",
      "ssm:UpdateAssociationStatus", "ssm:UpdateInstanceAssociationStatus", "ssm:UpdateInstanceInformation",
      "ssmmessages:CreateControlChannel", "ssmmessages:CreateDataChannel",
      "ssmmessages:OpenControlChannel", "ssmmessages:OpenDataChannel",
      "ec2messages:AcknowledgeMessage", "ec2messages:DeleteMessage", "ec2messages:FailMessage",
      "ec2messages:GetEndpoint", "ec2messages:GetMessages", "ec2messages:SendReply",
    ]
    resources = ["*"]
  }
}

resource "aws_iam_policy" "ssm_core_without_parameter_reads" {
  name   = "${var.name_prefix}-ssm-core-no-parameter-reads"
  policy = data.aws_iam_policy_document.ssm_core_without_parameter_reads.json
  tags   = var.common_tags
}

resource "aws_iam_role_policy_attachment" "ssm" {
  role       = aws_iam_role.app.name
  policy_arn = aws_iam_policy.ssm_core_without_parameter_reads.arn
}

resource "aws_iam_instance_profile" "app" {
  name = "${var.name_prefix}-app"
  role = aws_iam_role.app.name
  tags = merge(var.common_tags, { App = "ona-api" })
}

resource "aws_launch_template" "app" {
  name_prefix   = "${var.name_prefix}-app-"
  image_id      = local.selected_ami_id
  instance_type = var.instance_type

  iam_instance_profile {
    arn = aws_iam_instance_profile.app.arn
  }

  metadata_options {
    http_endpoint               = "enabled"
    http_protocol_ipv6          = "disabled"
    http_put_response_hop_limit = 1
    http_tokens                 = "required"
    instance_metadata_tags      = "enabled"
  }

  network_interfaces {
    associate_public_ip_address = false
    delete_on_termination       = true
    device_index                = 0
    security_groups             = [aws_security_group.app.id]
  }

  block_device_mappings {
    device_name = "/dev/sda1"

    ebs {
      delete_on_termination = true
      encrypted             = true
      kms_key_id            = aws_kms_key.data.arn
      volume_size           = 20
      volume_type           = "gp3"
    }
  }

  user_data = base64encode(templatefile("${path.module}/cloud-init.sh", {
    config_bucket            = aws_s3_bucket.runtime["config"].bucket
    config_key               = "configs/.env.prod-secondary"
    artifacts_bucket         = aws_s3_bucket.runtime["artifacts"].bucket
    aws_region               = var.aws_region
    environment              = var.environment
    api_log_group            = aws_cloudwatch_log_group.runtime["api"].name
    email_worker_log_group   = aws_cloudwatch_log_group.runtime["email-worker"].name
    webhook_worker_log_group = aws_cloudwatch_log_group.runtime["webhook-worker"].name
  }))

  tag_specifications {
    resource_type = "instance"
    tags          = merge(var.common_tags, { Name = "${var.name_prefix}-app", App = "ona-api" })
  }

  tag_specifications {
    resource_type = "volume"
    tags          = merge(var.common_tags, { Name = "${var.name_prefix}-app-volume", App = "ona-api" })
  }

  update_default_version = true
  tags                   = merge(var.common_tags, { Name = "${var.name_prefix}-app-template", App = "ona-api" })

  depends_on = [aws_iam_role_policy.app, aws_iam_role_policy_attachment.ssm, aws_route.app_egress, aws_vpc_endpoint.interface, aws_vpc_endpoint.s3]
}

resource "aws_autoscaling_group" "app" {
  name                      = "${var.name_prefix}-app"
  min_size                  = 2
  desired_capacity          = 2
  max_size                  = 2
  vpc_zone_identifier       = aws_subnet.app[*].id
  target_group_arns         = [aws_lb_target_group.api.arn]
  health_check_type         = "ELB"
  health_check_grace_period = 1200
  enabled_metrics           = ["GroupInServiceInstances"]

  launch_template {
    id      = aws_launch_template.app.id
    version = aws_launch_template.app.latest_version
  }

  instance_refresh {
    strategy = "Rolling"

    preferences {
      instance_warmup        = 300
      min_healthy_percentage = 50
      max_healthy_percentage = 100
    }

    triggers = ["tag"]
  }

  dynamic "tag" {
    for_each = merge(var.common_tags, { Name = "${var.name_prefix}-app", App = "ona-api" })

    content {
      key                 = tag.key
      value               = tag.value
      propagate_at_launch = true
    }
  }

  lifecycle {
    precondition {
      condition     = length(var.alb_allowed_ipv4_cidrs) == 0 || var.alb_certificate_arn != null
      error_message = "CIDR access may only be enabled after a reviewed TLS certificate is supplied."
    }
  }
}

resource "aws_s3_bucket" "frontend" {
  for_each = {
    dashboard = local.bucket_names.dashboard
    survey    = local.bucket_names.survey
  }

  bucket = each.value
  tags = merge(var.common_tags, {
    Name = each.value
    App  = "ona-${each.key}"
  })
}

resource "aws_s3_bucket_public_access_block" "frontend" {
  for_each = aws_s3_bucket.frontend

  bucket                  = each.value.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_versioning" "frontend" {
  for_each = aws_s3_bucket.frontend

  bucket = each.value.id

  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "frontend" {
  for_each = aws_s3_bucket.frontend

  bucket = each.value.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_cloudfront_origin_access_control" "frontend" {
  for_each = aws_s3_bucket.frontend

  name                              = "${var.name_prefix}-${each.key}-oac"
  description                       = "OAC for dark prod-secondary ${each.key} origin"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

resource "aws_cloudfront_distribution" "frontend" {
  for_each = aws_s3_bucket.frontend

  enabled             = var.enable_public_aws_endpoints
  is_ipv6_enabled     = true
  aliases             = var.enable_custom_domain_aliases ? [var.custom_domains[each.key]] : []
  default_root_object = "index.html"
  comment             = "prod-secondary ${each.key} edge"

  origin {
    domain_name              = each.value.bucket_regional_domain_name
    origin_id                = "S3-${each.key}"
    origin_access_control_id = aws_cloudfront_origin_access_control.frontend[each.key].id
  }

  default_cache_behavior {
    allowed_methods        = ["GET", "HEAD", "OPTIONS"]
    cached_methods         = ["GET", "HEAD"]
    target_origin_id       = "S3-${each.key}"
    viewer_protocol_policy = "redirect-to-https"
    compress               = true

    forwarded_values {
      query_string = false
      cookies {
        forward = "none"
      }
    }

    min_ttl     = 0
    default_ttl = 3600
    max_ttl     = 86400
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    cloudfront_default_certificate = !var.enable_custom_domain_aliases
    acm_certificate_arn            = var.enable_custom_domain_aliases ? aws_acm_certificate.cloudfront.arn : null
    ssl_support_method             = var.enable_custom_domain_aliases ? "sni-only" : null
    minimum_protocol_version       = var.enable_custom_domain_aliases ? "TLSv1.2_2021" : "TLSv1"
  }

  tags = merge(var.common_tags, { Name = "${var.name_prefix}-${each.key}", App = "ona-${each.key}" })
}

data "aws_iam_policy_document" "frontend_bucket" {
  for_each = aws_s3_bucket.frontend

  statement {
    sid       = "AllowOnlyThisDistribution"
    effect    = "Allow"
    actions   = ["s3:GetObject"]
    resources = ["${each.value.arn}/*"]

    principals {
      type        = "Service"
      identifiers = ["cloudfront.amazonaws.com"]
    }

    condition {
      test     = "StringEquals"
      variable = "AWS:SourceArn"
      values   = [aws_cloudfront_distribution.frontend[each.key].arn]
    }
  }

  statement {
    sid       = "DenyInsecureTransport"
    effect    = "Deny"
    actions   = ["s3:*"]
    resources = [each.value.arn, "${each.value.arn}/*"]

    principals {
      type        = "*"
      identifiers = ["*"]
    }

    condition {
      test     = "Bool"
      variable = "aws:SecureTransport"
      values   = ["false"]
    }
  }
}

resource "aws_s3_bucket_policy" "frontend" {
  for_each = aws_s3_bucket.frontend

  bucket = each.value.id
  policy = data.aws_iam_policy_document.frontend_bucket[each.key].json
}

data "aws_iam_role" "github_deploy" {
  name = var.github_deploy_role_name
}

data "aws_iam_policy_document" "github_deploy" {
  statement {
    sid       = "DiscoverTargetStack"
    effect    = "Allow"
    actions   = ["autoscaling:DescribeAutoScalingGroups", "cloudfront:GetDistribution", "ec2:DescribeInstances", "elasticloadbalancing:DescribeLoadBalancers", "elasticloadbalancing:DescribeTargetHealth", "resourcegroupstaggingapi:GetResources", "ssm:GetCommandInvocation"]
    resources = ["*"]
  }

  statement {
    sid       = "UseReviewedDeployDocument"
    effect    = "Allow"
    actions   = ["ssm:SendCommand"]
    resources = ["arn:${data.aws_partition.current.partition}:ssm:${var.aws_region}::document/AWS-RunShellScript"]
  }

  statement {
    sid       = "SendCommandsToTargetStackInstances"
    effect    = "Allow"
    actions   = ["ssm:SendCommand"]
    resources = ["arn:${data.aws_partition.current.partition}:ec2:${var.aws_region}:${var.account_id}:instance/*"]

    condition {
      test     = "StringEquals"
      variable = "ssm:resourceTag/Environment"
      values   = [var.environment]
    }

    condition {
      test     = "StringEquals"
      variable = "ssm:resourceTag/App"
      values   = ["ona-api"]
    }

    condition {
      test     = "StringEquals"
      variable = "ssm:resourceTag/Stack"
      values   = [var.common_tags["Stack"]]
    }
  }

  statement {
    sid     = "PublishArtifactsAndFrontends"
    effect  = "Allow"
    actions = ["s3:DeleteObject", "s3:GetObject", "s3:PutObject"]
    resources = concat(
      ["${aws_s3_bucket.runtime["artifacts"].arn}/api/*"],
      [for bucket in aws_s3_bucket.frontend : "${bucket.arn}/*"],
    )
  }

  statement {
    sid     = "ListDeploymentBuckets"
    effect  = "Allow"
    actions = ["s3:GetBucketLocation", "s3:ListBucket"]
    resources = concat(
      [aws_s3_bucket.runtime["artifacts"].arn],
      [for bucket in aws_s3_bucket.frontend : bucket.arn],
    )
  }

  statement {
    sid       = "EncryptTargetArtifacts"
    effect    = "Allow"
    actions   = ["kms:Decrypt", "kms:DescribeKey", "kms:Encrypt", "kms:GenerateDataKey"]
    resources = [aws_kms_key.data.arn]
  }

  statement {
    sid       = "InvalidateTargetDistributions"
    effect    = "Allow"
    actions   = ["cloudfront:CreateInvalidation"]
    resources = [for distribution in aws_cloudfront_distribution.frontend : distribution.arn]
  }
}

resource "aws_iam_role_policy" "github_deploy" {
  name   = "${var.name_prefix}-deploy"
  role   = data.aws_iam_role.github_deploy.id
  policy = data.aws_iam_policy_document.github_deploy.json
}
