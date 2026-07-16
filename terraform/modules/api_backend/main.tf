data "aws_caller_identity" "current" {}

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

# S3 bucket to store API runtime configuration files.
resource "aws_s3_bucket" "config_bucket" {
  bucket = var.config_bucket_name

  tags = var.config_bucket_tags
}

resource "aws_s3_bucket_public_access_block" "bucket_public_access" {
  for_each = {
    config    = aws_s3_bucket.config_bucket.id
    artifacts = aws_s3_bucket.artifacts.id
  }

  bucket                  = each.value
  block_public_acls       = true
  ignore_public_acls      = true
  block_public_policy     = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_ownership_controls" "config_bucket_ownership" {
  count = var.enable_config_bucket_ownership_controls ? 1 : 0

  bucket = aws_s3_bucket.config_bucket.id

  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "bucket_encryption" {
  for_each = {
    config    = aws_s3_bucket.config_bucket.id
    artifacts = aws_s3_bucket.artifacts.id
  }

  bucket = each.value

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_versioning" "bucket_versioning" {
  for_each = {
    config    = aws_s3_bucket.config_bucket.id
    artifacts = aws_s3_bucket.artifacts.id
  }

  bucket = each.value

  versioning_configuration {
    status = "Enabled"
  }
}

# S3 bucket for versioned API release artifacts.
resource "aws_s3_bucket" "artifacts" {
  bucket = var.artifacts_bucket_name

  tags = var.artifacts_bucket_tags
}

resource "aws_s3_bucket_lifecycle_configuration" "artifacts_lifecycle" {
  bucket = aws_s3_bucket.artifacts.id

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

resource "aws_s3_object" "api_config" {
  bucket = aws_s3_bucket.config_bucket.id
  key    = "configs/.env.prod"
  content = templatefile(var.env_template_path, {
    db_host                       = var.db_host
    db_port                       = var.db_port
    db_name                       = var.db_name
    db_user                       = var.db_user
    db_password_parameter_name    = var.db_password_parameter_name
    frontend_url                  = var.frontend_url
    survey_url                    = var.survey_url
    session_secret_parameter_name = var.session_secret_parameter_name
    session_cookie_name           = var.session_cookie_name
    resend_api_key_parameter_name = var.resend_api_key_parameter_name
  })
}

resource "aws_security_group" "alb_sg" {
  name        = var.alb_security_group_name
  description = var.alb_security_group_description
  vpc_id      = var.vpc_id

  ingress {
    description = var.alb_https_ingress_description
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  ingress {
    description = var.alb_http_ingress_description
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = var.alb_security_group_tags
}

resource "aws_security_group" "backend_sg" {
  name        = var.backend_security_group_name
  description = var.backend_security_group_description
  vpc_id      = var.vpc_id

  ingress {
    description     = var.backend_api_ingress_description
    from_port       = 3000
    to_port         = 3000
    protocol        = "tcp"
    security_groups = [aws_security_group.alb_sg.id]
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

  tags = var.backend_security_group_tags
}

resource "aws_iam_role" "ec2_role" {
  name               = var.iam_role_name
  assume_role_policy = data.aws_iam_policy_document.ec2_assume_role_policy.json

  tags = var.iam_tags
}

resource "aws_iam_policy" "s3_access_policy" {
  name        = var.iam_policy_name
  description = var.iam_policy_description
  policy      = data.aws_iam_policy_document.s3_access_policy.json

  tags = var.iam_tags
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

  statement {
    effect = "Allow"
    actions = [
      "ssm:GetParameter",
      "ssm:GetParameters",
    ]
    resources = [
      "arn:aws:ssm:${var.aws_region}:${data.aws_caller_identity.current.account_id}:parameter${var.db_password_parameter_name}",
      "arn:aws:ssm:${var.aws_region}:${data.aws_caller_identity.current.account_id}:parameter${var.session_secret_parameter_name}",
      "arn:aws:ssm:${var.aws_region}:${data.aws_caller_identity.current.account_id}:parameter${var.resend_api_key_parameter_name}",
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

resource "aws_iam_role_policy_attachment" "ec2_s3_policy" {
  role       = aws_iam_role.ec2_role.name
  policy_arn = aws_iam_policy.s3_access_policy.arn
}

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
          AWS = aws_iam_role.ec2_role.arn
        }
        Action   = "s3:GetObject"
        Resource = "${aws_s3_bucket.config_bucket.arn}/*"
      }
    ]
  })
}

resource "aws_iam_instance_profile" "ec2_instance_profile" {
  name = var.iam_instance_profile_name
  role = aws_iam_role.ec2_role.name

  tags = var.iam_tags
}

data "aws_iam_policy_document" "ec2_assume_role_policy" {
  statement {
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["ec2.amazonaws.com"]
    }
  }
}

resource "aws_instance" "backend" {
  ami                         = data.aws_ami.ubuntu.id
  instance_type               = var.instance_type
  subnet_id                   = var.backend_subnet_id
  vpc_security_group_ids      = [aws_security_group.backend_sg.id]
  associate_public_ip_address = true
  iam_instance_profile        = aws_iam_instance_profile.ec2_instance_profile.name
  key_name                    = length(var.ssh_allowed_cidrs) > 0 ? var.ssh_key_name : null

  user_data = templatefile(var.cloud_init_template_path, {
    config_bucket    = aws_s3_bucket.config_bucket.bucket
    artifacts_bucket = aws_s3_bucket.artifacts.bucket
    aws_region       = var.aws_region
    environment      = var.environment
  })

  lifecycle {
    ignore_changes = [ami]
  }

  tags = merge(var.backend_instance_tags, {
    Name = var.backend_instance_name
  })
}

resource "aws_lb_target_group" "backend_targets" {
  name        = var.target_group_name
  protocol    = "HTTP"
  port        = 3000
  vpc_id      = var.vpc_id
  target_type = "instance"

  health_check {
    path                = var.health_check_path
    protocol            = var.health_check_protocol
    matcher             = var.health_check_matcher
    timeout             = var.health_check_timeout
    healthy_threshold   = 2
    unhealthy_threshold = 3
    interval            = 30
  }

  tags = var.target_group_tags
}

resource "aws_lb" "main_alb" {
  name               = var.alb_name
  internal           = false
  load_balancer_type = "application"
  security_groups    = [aws_security_group.alb_sg.id]
  subnets            = var.alb_subnet_ids

  enable_deletion_protection = var.alb_deletion_protection
  tags                       = var.alb_tags
}

resource "aws_lb_listener" "http_redirect" {
  load_balancer_arn = aws_lb.main_alb.arn
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

resource "aws_lb_listener" "https_listener" {
  load_balancer_arn = aws_lb.main_alb.arn
  port              = 443
  protocol          = "HTTPS"

  ssl_policy      = "ELBSecurityPolicy-TLS13-1-2-2021-06"
  certificate_arn = var.certificate_arn

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.backend_targets.arn
  }
}

resource "aws_lb_target_group_attachment" "backend_attachments" {
  for_each = var.target_group_attachment_for_each ? { instance1 = aws_instance.backend.id } : {}

  target_group_arn = aws_lb_target_group.backend_targets.arn
  target_id        = each.value
  port             = var.target_group_attachment_port
}

resource "aws_lb_target_group_attachment" "backend_attachment" {
  count = var.target_group_attachment_for_each ? 0 : 1

  target_group_arn = aws_lb_target_group.backend_targets.arn
  target_id        = aws_instance.backend.id
  port             = var.target_group_attachment_port
}
