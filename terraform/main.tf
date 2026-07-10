# Create a VPC for networking
resource "aws_vpc" "main" {
  cidr_block           = "10.0.0.0/16"
  enable_dns_support   = true
  enable_dns_hostnames = true

  tags = merge(local.common_tags, { Name = "${local.name_prefix}main-vpc" })
}

# Create additional subnets for RDS
resource "aws_subnet" "db_subnet_1" {
  vpc_id                  = aws_vpc.main.id
  cidr_block              = "10.0.2.0/24"
  availability_zone       = "${var.aws_region}a"
  map_public_ip_on_launch = true

  tags = local.common_tags
}

resource "aws_subnet" "db_subnet_2" {
  vpc_id            = aws_vpc.main.id
  cidr_block        = "10.0.3.0/24"
  availability_zone = "${var.aws_region}b"

  tags = local.common_tags
}

# Create a DB subnet group
resource "aws_db_subnet_group" "db_subnet_group" {
  name = "${local.name_prefix}db-subnet-group"
  subnet_ids = [
    aws_subnet.db_subnet_1.id,
    aws_subnet.db_subnet_2.id,
  ]

  tags = merge(local.common_tags, { Name = "DB Subnet Group" })
}

# Create a security group for the backend instance
resource "aws_security_group" "backend_sg" {
  name   = "${local.name_prefix}backend-security-group"
  vpc_id = aws_vpc.main.id

  # SSH is disabled by default; prefer SSM Session Manager.
  # Set ssh_allowed_cidrs to open it to specific addresses only.
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

  # The API port is only reachable through the ALB.
  ingress {
    description     = "API traffic from the ALB"
    from_port       = 3000
    to_port         = 3000
    protocol        = "tcp"
    security_groups = [aws_security_group.alb_sg.id]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = merge(local.common_tags, { Name = "${local.name_prefix}backend-security-group" })
}

# Dedicated security group for the database: only the backend can reach it
resource "aws_security_group" "db_sg" {
  name   = "${local.name_prefix}db-security-group"
  vpc_id = aws_vpc.main.id

  ingress {
    description     = "Postgres from the backend instance only"
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = [aws_security_group.backend_sg.id]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = merge(local.common_tags, { Name = "${local.name_prefix}db-security-group" })
}

# Latest Ubuntu 22.04 LTS AMI. ignore_changes keeps newer AMI releases from
# forcing replacement of already-running instances.
data "aws_ami" "ubuntu" {
  most_recent = true
  owners      = ["099720109477"] # Canonical

  filter {
    name   = "name"
    values = ["ubuntu/images/hvm-ssd/ubuntu-jammy-22.04-amd64-server-*"]
  }

  filter {
    name   = "virtualization-type"
    values = ["hvm"]
  }
}

resource "aws_instance" "backend" {
  ami                         = data.aws_ami.ubuntu.id
  instance_type               = var.instance_type
  subnet_id                   = aws_subnet.db_subnet_1.id
  vpc_security_group_ids      = [aws_security_group.backend_sg.id]
  associate_public_ip_address = true
  iam_instance_profile        = aws_iam_instance_profile.ec2_instance_profile.name
  key_name                    = length(var.ssh_allowed_cidrs) > 0 ? var.ssh_key_name : null

  user_data = templatefile("cloud-init-template.sh", {
    config_bucket    = aws_s3_bucket.config_bucket.bucket
    artifacts_bucket = aws_s3_bucket.artifacts.bucket
    aws_region       = var.aws_region
    environment      = local.environment
  })

  lifecycle {
    ignore_changes = [ami]
  }

  tags = merge(local.common_tags, {
    Name = "${local.name_prefix}backend-instance"
    App  = "ona-api"
  })
}

# Create an Internet Gateway
resource "aws_internet_gateway" "igw" {
  vpc_id = aws_vpc.main.id

  tags = merge(local.common_tags, { Name = "${local.name_prefix}main-igw" })
}

# Create a public route table
resource "aws_route_table" "public_rt" {
  vpc_id = aws_vpc.main.id

  tags = merge(local.common_tags, { Name = "${local.name_prefix}public-route-table" })
}

# Create a route to the Internet Gateway
resource "aws_route" "igw_route" {
  route_table_id         = aws_route_table.public_rt.id
  destination_cidr_block = "0.0.0.0/0"
  gateway_id             = aws_internet_gateway.igw.id
}

# Associate the public route table with the subnets
resource "aws_route_table_association" "db_subnet_1" {
  subnet_id      = aws_subnet.db_subnet_1.id
  route_table_id = aws_route_table.public_rt.id
}

resource "aws_route_table_association" "db_subnet_2" {
  subnet_id      = aws_subnet.db_subnet_2.id
  route_table_id = aws_route_table.public_rt.id
}

resource "aws_db_instance" "postgres" {
  allocated_storage      = 20
  engine                 = "postgres"
  engine_version         = "15.12"
  instance_class         = "db.t3.micro"
  db_name                = "ONA"
  username               = var.db_user
  password               = var.db_password
  publicly_accessible    = false
  vpc_security_group_ids = [aws_security_group.db_sg.id]
  db_subnet_group_name   = aws_db_subnet_group.db_subnet_group.name
  # Default parameter group keeps rds.force_ssl = 1; the API and Liquibase
  # connect with sslmode=require and verify against the RDS CA bundle.
  parameter_group_name = "default.postgres15"
  # Without this, the parameter-group switch waits for the maintenance window
  # and deleting the old postgres-no-ssl group fails with "currently in use"
  apply_immediately         = true
  deletion_protection       = var.db_deletion_protection
  skip_final_snapshot       = var.db_deletion_protection ? false : true
  final_snapshot_identifier = var.db_deletion_protection ? "${local.name_prefix}ona-final-snapshot" : null

  tags = merge(local.common_tags, { Name = "${local.name_prefix}postgres-db" })
}

# Create an S3 bucket to store configuration files
resource "aws_s3_bucket" "config_bucket" {
  bucket = local.config_bucket_name

  tags = merge(local.common_tags, { Name = "Config Bucket" })
}

# Ensure the bucket is private by blocking public access
resource "aws_s3_bucket_public_access_block" "config_bucket_public_access" {
  bucket = aws_s3_bucket.config_bucket.id

  block_public_acls       = true
  ignore_public_acls      = true
  block_public_policy     = true
  restrict_public_buckets = true
}

# Set object ownership to BucketOwnerEnforced to disable ACLs
resource "aws_s3_bucket_ownership_controls" "config_bucket_ownership" {
  bucket = aws_s3_bucket.config_bucket.id

  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

# Add a random suffix to ensure the bucket name is unique
resource "random_string" "suffix" {
  length  = 6
  upper   = false
  special = false
}

# API runtime config, consumed by the instance at deploy time.
# Secrets come from Terraform variables (TF_VAR_*), never from the repo.
resource "aws_s3_object" "api_config" {
  bucket = aws_s3_bucket.config_bucket.id
  key    = "configs/.env.prod"
  content = templatefile("./templates/env.tmpl", {
    db_host             = aws_db_instance.postgres.address
    db_port             = aws_db_instance.postgres.port
    db_name             = aws_db_instance.postgres.db_name
    db_user             = var.db_user
    db_password         = var.db_password
    frontend_url        = local.frontend_url
    survey_url          = local.survey_url
    session_secret      = var.session_secret
    session_cookie_name = local.session_cookie_name
    resend_api_key      = var.resend_api_key
  })
}

# S3 bucket for versioned API release artifacts (uploaded by CI, pulled by the
# instance at deploy time via SSM — no instance rebuilds).
resource "aws_s3_bucket" "artifacts" {
  bucket = local.artifacts_bucket_name

  tags = merge(local.common_tags, {
    Name = "API Artifacts"
    App  = "ona-artifacts"
  })
}

resource "aws_s3_bucket_public_access_block" "artifacts_public_access" {
  bucket = aws_s3_bucket.artifacts.id

  block_public_acls       = true
  ignore_public_acls      = true
  block_public_policy     = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_versioning" "artifacts_versioning" {
  bucket = aws_s3_bucket.artifacts.id

  versioning_configuration {
    status = "Enabled"
  }
}

# IAM Role for the EC2 instance
resource "aws_iam_role" "ec2_role" {
  name               = "${local.name_prefix}ec2-role-config-access"
  assume_role_policy = data.aws_iam_policy_document.ec2_assume_role_policy.json
}

# Policy to allow the EC2 instance to read config and release artifacts
resource "aws_iam_policy" "s3_access_policy" {
  name        = "${local.name_prefix}s3-config-access-policy"
  description = "Allow EC2 to read the S3 config bucket and release artifacts"
  policy      = data.aws_iam_policy_document.s3_access_policy.json
}

data "aws_iam_policy_document" "s3_access_policy" {
  statement {
    effect  = "Allow"
    actions = ["s3:GetObject"]
    resources = [
      "${aws_s3_bucket.config_bucket.arn}/*",
      "${aws_s3_bucket.artifacts.arn}/*",
    ]
  }

  statement {
    effect    = "Allow"
    actions   = ["s3:ListBucket"]
    resources = [aws_s3_bucket.artifacts.arn]
  }
}

# EC2 instance config role policy attachment
resource "aws_iam_role_policy_attachment" "ec2_s3_policy" {
  role       = aws_iam_role.ec2_role.name
  policy_arn = aws_iam_policy.s3_access_policy.arn
}

# SSM Session Manager + Run Command access (replaces SSH and enables
# artifact-based deploys)
resource "aws_iam_role_policy_attachment" "ec2_ssm_policy" {
  role       = aws_iam_role.ec2_role.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

resource "aws_s3_bucket_policy" "config_bucket_policy" {
  bucket = aws_s3_bucket.config_bucket.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Principal = {
          AWS = "${aws_iam_role.ec2_role.arn}"
        }
        Action   = "s3:GetObject"
        Resource = "${aws_s3_bucket.config_bucket.arn}/*"
      }
    ]
  })
}

# EC2 Instance Profile
resource "aws_iam_instance_profile" "ec2_instance_profile" {
  name = "${local.name_prefix}instance-profile-access"
  role = aws_iam_role.ec2_role.name
}

# IAM Role Trust Policy for EC2
data "aws_iam_policy_document" "ec2_assume_role_policy" {
  statement {
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["ec2.amazonaws.com"]
    }
  }
}

# Define the S3 bucket to store your static website or assets.
# Build files are uploaded by the CI deploy workflow (aws s3 sync), not by
# Terraform, so infra applies no longer depend on local build folders.
resource "aws_s3_bucket" "react_dashboard" {
  bucket = local.dashboard_bucket_name

  tags = merge(local.common_tags, {
    Name = "ReactAppBucket"
    App  = "ona-dashboard"
  })
}

resource "aws_s3_bucket" "react_survey" {
  bucket = local.survey_bucket_name

  tags = merge(local.common_tags, {
    Name = "ReactAppBucket"
    App  = "ona-survey"
  })
}

resource "aws_s3_bucket_cors_configuration" "react_dashboard_cors" {
  bucket = aws_s3_bucket.react_dashboard.id

  cors_rule {
    allowed_methods = ["GET", "HEAD"]
    allowed_origins = [local.frontend_url]
    allowed_headers = ["*"]
    max_age_seconds = 3000
  }
}

resource "aws_s3_bucket_cors_configuration" "react_survey_cors" {
  bucket = aws_s3_bucket.react_survey.id

  cors_rule {
    allowed_methods = ["GET", "HEAD"]
    allowed_origins = [local.survey_url]
    allowed_headers = ["*"]
    max_age_seconds = 3000
  }
}

# Generate a unique suffix for the bucket name
resource "random_id" "bucket_id" {
  byte_length = 4
}

# Create an Origin Access Control (OAC) for CloudFront to securely access the S3 bucket
resource "aws_cloudfront_origin_access_control" "react_dashboard_oac" {
  name                              = "dashboard-oac-${random_id.bucket_id.hex}"
  description                       = "OAC for React Dashboard S3 Bucket"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

resource "aws_cloudfront_origin_access_control" "react_survey_oac" {
  name                              = "survey-oac-${random_id.bucket_id.hex}"
  description                       = "OAC for React survey S3 Bucket"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

# Define the CloudFront distribution to serve content from the S3 bucket
resource "aws_cloudfront_distribution" "react_dashboard_distribution" {
  origin {
    domain_name              = aws_s3_bucket.react_dashboard.bucket_regional_domain_name
    origin_id                = "S3-react-app"
    origin_access_control_id = aws_cloudfront_origin_access_control.react_dashboard_oac.id
  }

  enabled             = true
  is_ipv6_enabled     = true
  default_root_object = "index.html"
  aliases             = [var.dashboard_domain]
  default_cache_behavior {
    allowed_methods        = ["GET", "HEAD", "OPTIONS"]
    cached_methods         = ["GET", "HEAD"]
    target_origin_id       = "S3-react-app"
    viewer_protocol_policy = "redirect-to-https"

    forwarded_values {
      query_string            = true
      query_string_cache_keys = ["v"]
      headers                 = ["Origin"]
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
    acm_certificate_arn      = aws_acm_certificate.ssl_cert_dashboard.arn
    ssl_support_method       = "sni-only"
    minimum_protocol_version = "TLSv1.2_2021"
  }

  tags = merge(local.common_tags, {
    Name = "ReactAppCloudFront"
    App  = "ona-dashboard"
  })
}

resource "aws_cloudfront_distribution" "react_survey_distribution" {
  origin {
    domain_name              = aws_s3_bucket.react_survey.bucket_regional_domain_name
    origin_id                = "S3-react-app"
    origin_access_control_id = aws_cloudfront_origin_access_control.react_survey_oac.id
  }

  enabled             = true
  is_ipv6_enabled     = true
  default_root_object = "index.html"
  aliases             = [var.survey_domain]
  default_cache_behavior {
    allowed_methods        = ["GET", "HEAD", "OPTIONS"]
    cached_methods         = ["GET", "HEAD"]
    target_origin_id       = "S3-react-app"
    viewer_protocol_policy = "redirect-to-https"

    forwarded_values {
      query_string            = true
      query_string_cache_keys = ["v"]
      headers                 = ["Origin"]
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
    acm_certificate_arn      = aws_acm_certificate.ssl_cert_survey.arn
    ssl_support_method       = "sni-only"
    minimum_protocol_version = "TLSv1.2_2021"
  }

  tags = merge(local.common_tags, {
    Name = "ReactAppCloudFront"
    App  = "ona-survey"
  })
}

# Update the S3 bucket policy to allow access from the CloudFront distribution using OAC
resource "aws_s3_bucket_policy" "react_dashboard_policy" {
  bucket = aws_s3_bucket.react_dashboard.id

  policy = jsonencode({
    "Version" : "2012-10-17",
    "Statement" : [
      {
        "Effect" : "Allow",
        "Principal" : {
          "Service" : "cloudfront.amazonaws.com"
        },
        "Action" : "s3:GetObject",
        "Resource" : "${aws_s3_bucket.react_dashboard.arn}/*",
        "Condition" : {
          "StringEquals" : {
            "AWS:SourceArn" : "${aws_cloudfront_distribution.react_dashboard_distribution.arn}"
          }
        }
      }
    ]
  })
}

resource "aws_s3_bucket_policy" "react_survey_policy" {
  bucket = aws_s3_bucket.react_survey.id

  policy = jsonencode({
    "Version" : "2012-10-17",
    "Statement" : [
      {
        "Effect" : "Allow",
        "Principal" : {
          "Service" : "cloudfront.amazonaws.com"
        },
        "Action" : "s3:GetObject",
        "Resource" : "${aws_s3_bucket.react_survey.arn}/*",
        "Condition" : {
          "StringEquals" : {
            "AWS:SourceArn" : "${aws_cloudfront_distribution.react_survey_distribution.arn}"
          }
        }
      }
    ]
  })
}

# Request an SSL certificate in ACM
resource "aws_acm_certificate" "ssl_cert" {
  domain_name       = var.api_domain
  validation_method = "DNS"

  tags = merge(local.common_tags, { Name = "SSL Certificate" })
}

# Request an SSL certificate in ACM for dashboard
resource "aws_acm_certificate" "ssl_cert_dashboard" {
  domain_name       = var.dashboard_domain
  validation_method = "DNS"

  tags = merge(local.common_tags, { Name = "SSL Certificate" })
}

# Request an SSL certificate in ACM for survey
resource "aws_acm_certificate" "ssl_cert_survey" {
  domain_name       = var.survey_domain
  validation_method = "DNS"

  tags = merge(local.common_tags, { Name = "SSL Certificate" })
}

# Wait for the certificate to be validated (manual process)
resource "aws_acm_certificate_validation" "ssl_cert_validation" {
  certificate_arn = aws_acm_certificate.ssl_cert.arn
  validation_record_fqdns = [
    for dvo in aws_acm_certificate.ssl_cert.domain_validation_options : dvo.resource_record_name
  ]
}

# Wait for the certificate to be validated (manual process)
resource "aws_acm_certificate_validation" "ssl_cert_dashboard_validation" {
  certificate_arn = aws_acm_certificate.ssl_cert_dashboard.arn
  validation_record_fqdns = [
    for dvo in aws_acm_certificate.ssl_cert_dashboard.domain_validation_options : dvo.resource_record_name
  ]
}

# Wait for the certificate to be validated (manual process)
resource "aws_acm_certificate_validation" "ssl_cert_survey_validation" {
  certificate_arn = aws_acm_certificate.ssl_cert_survey.arn
  validation_record_fqdns = [
    for dvo in aws_acm_certificate.ssl_cert_survey.domain_validation_options : dvo.resource_record_name
  ]
}

# Security group for the ALB
resource "aws_security_group" "alb_sg" {
  name        = "${local.name_prefix}alb-security-group"
  description = "Allow HTTPS traffic to the ALB"
  vpc_id      = aws_vpc.main.id

  ingress {
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"] # Allow HTTPS traffic from anywhere
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = local.common_tags
}

# Target group for backend instances
resource "aws_lb_target_group" "backend_targets" {
  name        = "${local.name_prefix}backend-targets"
  protocol    = "HTTP"
  port        = 3000 # Your backend app's port
  vpc_id      = aws_vpc.main.id
  target_type = "instance"

  health_check {
    path                = "/health"
    healthy_threshold   = 2
    unhealthy_threshold = 3
    interval            = 30
  }
}

# ALB
resource "aws_lb" "main_alb" {
  name               = "${local.name_prefix}main-alb"
  internal           = false
  load_balancer_type = "application"
  security_groups    = [aws_security_group.alb_sg.id]
  subnets            = [aws_subnet.db_subnet_1.id, aws_subnet.db_subnet_2.id]

  enable_deletion_protection = false
  tags                       = merge(local.common_tags, { Name = "${local.name_prefix}main-alb" })
}

# HTTPS Listener
resource "aws_lb_listener" "https_listener" {
  load_balancer_arn = aws_lb.main_alb.arn
  port              = 443
  protocol          = "HTTPS"

  ssl_policy      = "ELBSecurityPolicy-TLS13-1-2-2021-06"
  certificate_arn = aws_acm_certificate.ssl_cert.arn # Use your validated certificate's ARN

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.backend_targets.arn
  }
}

# Register instances with the target group
resource "aws_lb_target_group_attachment" "backend_attachments" {
  for_each = {
    instance1 = aws_instance.backend.id
  }

  target_group_arn = aws_lb_target_group.backend_targets.arn
  target_id        = each.value
}
