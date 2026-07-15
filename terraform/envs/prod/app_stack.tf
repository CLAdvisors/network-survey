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

resource "aws_security_group" "prod_alb" {
  name        = "${local.app_name_prefix}-alb"
  description = "Public HTTPS access to the replacement prod API ALB"
  vpc_id      = var.vpc_id

  ingress {
    description = "HTTP redirect"
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  ingress {
    description = "HTTPS"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = merge(local.app_common_tags, { Name = "${local.app_name_prefix}-alb" })
}

resource "aws_security_group" "prod_backend" {
  name        = "${local.app_name_prefix}-backend"
  description = "Replacement prod API backend; ingress only from ALB"
  vpc_id      = var.vpc_id

  ingress {
    description     = "API from ALB"
    from_port       = 3000
    to_port         = 3000
    protocol        = "tcp"
    security_groups = [aws_security_group.prod_alb.id]
  }

  dynamic "ingress" {
    for_each = length(var.ssh_allowed_cidrs) > 0 ? [1] : []
    content {
      description = "SSH from allowed CIDRs only"
      from_port   = 22
      to_port     = 22
      protocol    = "tcp"
      cidr_blocks = var.ssh_allowed_cidrs
    }
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = merge(local.app_common_tags, {
    Name = "${local.app_name_prefix}-backend"
    App  = "ona-api"
  })
}

data "aws_ami" "ubuntu" {
  most_recent = true
  owners      = ["099720109477"]

  filter {
    name   = "name"
    values = ["ubuntu/images/hvm-ssd/ubuntu-jammy-22.04-amd64-server-*"]
  }

  filter {
    name   = "virtualization-type"
    values = ["hvm"]
  }
}

resource "aws_iam_role" "prod_backend" {
  name               = "${local.app_name_prefix}-ec2-role"
  assume_role_policy = data.aws_iam_policy_document.prod_backend_assume.json

  tags = local.app_common_tags
}

data "aws_iam_policy_document" "prod_backend_assume" {
  statement {
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["ec2.amazonaws.com"]
    }
  }
}

data "aws_iam_policy_document" "prod_backend_runtime" {
  statement {
    effect  = "Allow"
    actions = ["s3:GetObject"]
    resources = [
      "${aws_s3_bucket.prod_app_config.arn}/*",
      "${aws_s3_bucket.prod_app_artifacts.arn}/*",
    ]
  }

  statement {
    effect    = "Allow"
    actions   = ["s3:ListBucket"]
    resources = [aws_s3_bucket.prod_app_artifacts.arn]
  }

  statement {
    effect  = "Allow"
    actions = ["ssm:GetParameter", "ssm:GetParameters"]
    resources = [
      "arn:aws:ssm:${var.aws_region}:${data.aws_caller_identity.current.account_id}:parameter${local.db_password_parameter_name}",
      "arn:aws:ssm:${var.aws_region}:${data.aws_caller_identity.current.account_id}:parameter${local.session_secret_parameter_name}",
      "arn:aws:ssm:${var.aws_region}:${data.aws_caller_identity.current.account_id}:parameter${local.resend_api_key_parameter_name}",
    ]
  }

  statement {
    effect    = "Allow"
    actions   = ["kms:Decrypt"]
    resources = ["*"]

    condition {
      test     = "StringEquals"
      variable = "kms:ViaService"
      values   = ["ssm.${var.aws_region}.amazonaws.com"]
    }
  }
}

resource "aws_iam_policy" "prod_backend_runtime" {
  name        = "${local.app_name_prefix}-runtime"
  description = "Allow replacement prod backend to read config, artifacts, and runtime secrets"
  policy      = data.aws_iam_policy_document.prod_backend_runtime.json

  tags = local.app_common_tags
}

resource "aws_iam_role_policy_attachment" "prod_backend_runtime" {
  role       = aws_iam_role.prod_backend.name
  policy_arn = aws_iam_policy.prod_backend_runtime.arn
}

resource "aws_iam_role_policy_attachment" "prod_backend_ssm" {
  role       = aws_iam_role.prod_backend.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

resource "aws_iam_instance_profile" "prod_backend" {
  name = "${local.app_name_prefix}-instance-profile"
  role = aws_iam_role.prod_backend.name

  tags = local.app_common_tags
}

resource "aws_instance" "prod_backend" {
  ami                         = data.aws_ami.ubuntu.id
  instance_type               = var.app_instance_type
  subnet_id                   = aws_subnet.prod_app_public["a"].id
  vpc_security_group_ids      = [aws_security_group.prod_backend.id]
  associate_public_ip_address = true
  iam_instance_profile        = aws_iam_instance_profile.prod_backend.name
  key_name                    = length(var.ssh_allowed_cidrs) > 0 ? var.ssh_key_name : null

  user_data = templatefile("../../cloud-init-template.sh", {
    config_bucket    = aws_s3_bucket.prod_app_config.bucket
    artifacts_bucket = aws_s3_bucket.prod_app_artifacts.bucket
    aws_region       = var.aws_region
    environment      = var.environment
  })

  lifecycle {
    ignore_changes = [ami]
  }

  tags = merge(local.app_common_tags, {
    Name = "${local.app_name_prefix}-backend"
    App  = "ona-api"
  })
}

resource "aws_lb_target_group" "prod_backend" {
  name     = "${local.app_name_prefix}-api"
  port     = 3000
  protocol = "HTTP"
  vpc_id   = var.vpc_id

  health_check {
    path                = "/health"
    protocol            = "HTTP"
    matcher             = "200"
    interval            = 30
    timeout             = 5
    healthy_threshold   = 2
    unhealthy_threshold = 3
  }

  tags = merge(local.app_common_tags, { Name = "${local.app_name_prefix}-api" })
}

resource "aws_lb" "prod_api" {
  name               = "${local.app_name_prefix}-alb"
  internal           = false
  load_balancer_type = "application"
  security_groups    = [aws_security_group.prod_alb.id]
  subnets            = [for subnet in aws_subnet.prod_app_public : subnet.id]

  enable_deletion_protection = var.alb_deletion_protection

  tags = merge(local.app_common_tags, {
    Name = "${local.app_name_prefix}-alb"
    App  = "ona-api"
  })
}

resource "aws_lb_listener" "prod_api_http" {
  load_balancer_arn = aws_lb.prod_api.arn
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

resource "aws_lb_listener" "prod_api_https" {
  load_balancer_arn = aws_lb.prod_api.arn
  port              = 443
  protocol          = "HTTPS"
  ssl_policy        = "ELBSecurityPolicy-TLS13-1-2-2021-06"
  certificate_arn   = aws_acm_certificate.prod_api.arn

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.prod_backend.arn
  }
}

resource "aws_lb_target_group_attachment" "prod_backend" {
  target_group_arn = aws_lb_target_group.prod_backend.arn
  target_id        = aws_instance.prod_backend.id
  port             = 3000
}

resource "aws_s3_bucket" "prod_app_config" {
  bucket = local.config_bucket_name

  tags = merge(local.app_common_tags, {
    Name = "${local.app_name_prefix}-config"
    App  = "ona-config"
  })
}

resource "aws_s3_bucket" "prod_app_artifacts" {
  bucket = local.artifacts_bucket_name

  tags = merge(local.app_common_tags, {
    Name = "${local.app_name_prefix}-artifacts"
    App  = "ona-artifacts"
  })
}

resource "aws_s3_bucket" "prod_app_dashboard" {
  bucket = local.dashboard_bucket_name

  tags = merge(local.app_common_tags, {
    Name = "${local.app_name_prefix}-dashboard"
    App  = "ona-dashboard"
  })
}

resource "aws_s3_bucket" "prod_app_survey" {
  bucket = local.survey_bucket_name

  tags = merge(local.app_common_tags, {
    Name = "${local.app_name_prefix}-survey"
    App  = "ona-survey"
  })
}

resource "aws_s3_bucket_public_access_block" "prod_app" {
  for_each = {
    config    = aws_s3_bucket.prod_app_config.id
    artifacts = aws_s3_bucket.prod_app_artifacts.id
    dashboard = aws_s3_bucket.prod_app_dashboard.id
    survey    = aws_s3_bucket.prod_app_survey.id
  }

  bucket                  = each.value
  block_public_acls       = true
  ignore_public_acls      = true
  block_public_policy     = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_server_side_encryption_configuration" "prod_app" {
  for_each = {
    config    = aws_s3_bucket.prod_app_config.id
    artifacts = aws_s3_bucket.prod_app_artifacts.id
    dashboard = aws_s3_bucket.prod_app_dashboard.id
    survey    = aws_s3_bucket.prod_app_survey.id
  }

  bucket = each.value

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_versioning" "prod_app" {
  for_each = {
    config    = aws_s3_bucket.prod_app_config.id
    artifacts = aws_s3_bucket.prod_app_artifacts.id
    dashboard = aws_s3_bucket.prod_app_dashboard.id
    survey    = aws_s3_bucket.prod_app_survey.id
  }

  bucket = each.value

  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "prod_app_artifacts" {
  bucket = aws_s3_bucket.prod_app_artifacts.id

  rule {
    id     = "expire-old-artifact-versions"
    status = "Enabled"

    filter {
      prefix = "api/"
    }

    noncurrent_version_expiration {
      noncurrent_days = var.artifact_retention_days
    }
  }
}

resource "aws_s3_object" "prod_api_config" {
  bucket = aws_s3_bucket.prod_app_config.id
  key    = "configs/.env.prod"
  content = templatefile("../../templates/env.tmpl", {
    db_host                       = aws_db_instance.prod_replacement.address
    db_port                       = aws_db_instance.prod_replacement.port
    db_name                       = aws_db_instance.prod_replacement.db_name
    db_user                       = var.db_user
    db_password_parameter_name    = local.db_password_parameter_name
    frontend_url                  = local.frontend_url
    survey_url                    = local.survey_url
    session_secret_parameter_name = local.session_secret_parameter_name
    session_cookie_name           = local.session_cookie_name
    resend_api_key_parameter_name = local.resend_api_key_parameter_name
  })
}

resource "aws_s3_bucket_policy" "prod_app_config" {
  bucket = aws_s3_bucket.prod_app_config.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { AWS = aws_iam_role.prod_backend.arn }
      Action    = "s3:GetObject"
      Resource  = "${aws_s3_bucket.prod_app_config.arn}/*"
    }]
  })
}

resource "aws_cloudfront_origin_access_control" "prod_dashboard" {
  name                              = "${local.app_name_prefix}-dashboard-${random_id.frontend_suffix.hex}"
  description                       = "OAC for replacement prod dashboard"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

resource "aws_cloudfront_origin_access_control" "prod_survey" {
  name                              = "${local.app_name_prefix}-survey-${random_id.frontend_suffix.hex}"
  description                       = "OAC for replacement prod survey"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

resource "aws_cloudfront_distribution" "prod_dashboard" {
  origin {
    domain_name              = aws_s3_bucket.prod_app_dashboard.bucket_regional_domain_name
    origin_id                = "S3-dashboard"
    origin_access_control_id = aws_cloudfront_origin_access_control.prod_dashboard.id
  }

  enabled             = true
  is_ipv6_enabled     = true
  default_root_object = "index.html"
  aliases             = var.enable_frontend_custom_domains ? [var.dashboard_domain] : []

  default_cache_behavior {
    allowed_methods        = ["GET", "HEAD", "OPTIONS"]
    cached_methods         = ["GET", "HEAD"]
    target_origin_id       = "S3-dashboard"
    viewer_protocol_policy = "redirect-to-https"
    compress               = true

    forwarded_values {
      query_string            = true
      query_string_cache_keys = ["v"]
      headers                 = ["Origin"]
      cookies { forward = "none" }
    }

    min_ttl     = 0
    default_ttl = 3600
    max_ttl     = 86400
  }

  custom_error_response {
    error_code            = 403
    response_code         = 200
    response_page_path    = "/index.html"
    error_caching_min_ttl = 0
  }

  custom_error_response {
    error_code            = 404
    response_code         = 200
    response_page_path    = "/index.html"
    error_caching_min_ttl = 0
  }

  restrictions {
    geo_restriction { restriction_type = "none" }
  }

  dynamic "viewer_certificate" {
    for_each = var.enable_frontend_custom_domains ? [1] : []
    content {
      acm_certificate_arn      = aws_acm_certificate.prod_dashboard.arn
      ssl_support_method       = "sni-only"
      minimum_protocol_version = "TLSv1.2_2021"
    }
  }

  dynamic "viewer_certificate" {
    for_each = var.enable_frontend_custom_domains ? [] : [1]
    content {
      cloudfront_default_certificate = true
    }
  }

  tags = merge(local.app_common_tags, {
    Name = "${local.app_name_prefix}-dashboard-cdn"
    App  = "ona-dashboard"
  })
}

resource "aws_cloudfront_distribution" "prod_survey" {
  origin {
    domain_name              = aws_s3_bucket.prod_app_survey.bucket_regional_domain_name
    origin_id                = "S3-survey"
    origin_access_control_id = aws_cloudfront_origin_access_control.prod_survey.id
  }

  enabled             = true
  is_ipv6_enabled     = true
  default_root_object = "index.html"
  aliases             = var.enable_frontend_custom_domains ? [var.survey_domain] : []

  default_cache_behavior {
    allowed_methods        = ["GET", "HEAD", "OPTIONS"]
    cached_methods         = ["GET", "HEAD"]
    target_origin_id       = "S3-survey"
    viewer_protocol_policy = "redirect-to-https"
    compress               = true

    forwarded_values {
      query_string            = true
      query_string_cache_keys = ["v"]
      headers                 = ["Origin"]
      cookies { forward = "none" }
    }

    min_ttl     = 0
    default_ttl = 3600
    max_ttl     = 86400
  }

  custom_error_response {
    error_code            = 403
    response_code         = 200
    response_page_path    = "/index.html"
    error_caching_min_ttl = 0
  }

  custom_error_response {
    error_code            = 404
    response_code         = 200
    response_page_path    = "/index.html"
    error_caching_min_ttl = 0
  }

  restrictions {
    geo_restriction { restriction_type = "none" }
  }

  dynamic "viewer_certificate" {
    for_each = var.enable_frontend_custom_domains ? [1] : []
    content {
      acm_certificate_arn      = aws_acm_certificate.prod_survey.arn
      ssl_support_method       = "sni-only"
      minimum_protocol_version = "TLSv1.2_2021"
    }
  }

  dynamic "viewer_certificate" {
    for_each = var.enable_frontend_custom_domains ? [] : [1]
    content {
      cloudfront_default_certificate = true
    }
  }

  tags = merge(local.app_common_tags, {
    Name = "${local.app_name_prefix}-survey-cdn"
    App  = "ona-survey"
  })
}

resource "aws_s3_bucket_policy" "prod_app_dashboard" {
  bucket = aws_s3_bucket.prod_app_dashboard.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "cloudfront.amazonaws.com" }
      Action    = "s3:GetObject"
      Resource  = "${aws_s3_bucket.prod_app_dashboard.arn}/*"
      Condition = { StringEquals = { "AWS:SourceArn" = aws_cloudfront_distribution.prod_dashboard.arn } }
    }]
  })
}

resource "aws_s3_bucket_policy" "prod_app_survey" {
  bucket = aws_s3_bucket.prod_app_survey.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "cloudfront.amazonaws.com" }
      Action    = "s3:GetObject"
      Resource  = "${aws_s3_bucket.prod_app_survey.arn}/*"
      Condition = { StringEquals = { "AWS:SourceArn" = aws_cloudfront_distribution.prod_survey.arn } }
    }]
  })
}
