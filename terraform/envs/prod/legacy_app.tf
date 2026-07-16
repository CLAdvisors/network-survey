data "aws_caller_identity" "current" {}

locals {
  prod_app_tags = {
    Project     = var.project_name
    Environment = var.environment
    ManagedBy   = "terraform"
  }

  legacy_app_tags = merge(local.prod_app_tags, {
    Environment = var.legacy_resource_environment
  })

  prod_config_artifacts_bucket = "my-config-bucket-1xo22t"
  prod_dashboard_bucket        = "react-dashboard-7c1f1dec"
  prod_survey_bucket           = "react-survey-7c1f1dec"
  prod_dashboard_distribution  = "E1PEP245TILYDL"
  prod_survey_distribution     = "E3FANX1T8EYFZ5"
}

resource "aws_s3_bucket" "prod_config_artifacts" {
  bucket = local.prod_config_artifacts_bucket

  tags = merge(local.legacy_app_tags, {
    Name = "Config Bucket"
    App  = "ona-artifacts"
  })
}

resource "aws_s3_bucket" "prod_dashboard" {
  bucket = local.prod_dashboard_bucket

  tags = merge(local.legacy_app_tags, {
    Name = "ReactAppBucket"
    App  = "ona-dashboard"
  })
}

resource "aws_s3_bucket" "prod_survey" {
  bucket = local.prod_survey_bucket

  tags = merge(local.legacy_app_tags, {
    Name = "ReactAppBucket"
    App  = "ona-survey"
  })
}

resource "aws_s3_bucket_public_access_block" "prod_config_artifacts" {
  bucket = aws_s3_bucket.prod_config_artifacts.id

  block_public_acls       = true
  ignore_public_acls      = true
  block_public_policy     = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_public_access_block" "prod_dashboard" {
  bucket = aws_s3_bucket.prod_dashboard.id

  block_public_acls       = true
  ignore_public_acls      = true
  block_public_policy     = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_public_access_block" "prod_survey" {
  bucket = aws_s3_bucket.prod_survey.id

  block_public_acls       = true
  ignore_public_acls      = true
  block_public_policy     = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_server_side_encryption_configuration" "prod_config_artifacts" {
  bucket = aws_s3_bucket.prod_config_artifacts.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "prod_dashboard" {
  bucket = aws_s3_bucket.prod_dashboard.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "prod_survey" {
  bucket = aws_s3_bucket.prod_survey.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_versioning" "prod_config_artifacts" {
  bucket = aws_s3_bucket.prod_config_artifacts.id

  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_versioning" "prod_dashboard" {
  bucket = aws_s3_bucket.prod_dashboard.id

  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_versioning" "prod_survey" {
  bucket = aws_s3_bucket.prod_survey.id

  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "prod_config_artifacts" {
  bucket = aws_s3_bucket.prod_config_artifacts.id

  rule {
    id     = "expire-old-artifact-versions"
    status = "Enabled"

    filter {
      prefix = "api/"
    }

    noncurrent_version_expiration {
      noncurrent_days = 30
    }
  }
}

resource "aws_s3_bucket_policy" "prod_config_artifacts" {
  bucket = aws_s3_bucket.prod_config_artifacts.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Principal = {
          AWS = "arn:aws:iam::${data.aws_caller_identity.current.account_id}:role/ec2-role-config-access"
        }
        Action   = "s3:GetObject"
        Resource = "${aws_s3_bucket.prod_config_artifacts.arn}/*"
      }
    ]
  })
}

resource "aws_s3_bucket_policy" "prod_dashboard" {
  bucket = aws_s3_bucket.prod_dashboard.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Principal = {
          Service = "cloudfront.amazonaws.com"
        }
        Action   = "s3:GetObject"
        Resource = "${aws_s3_bucket.prod_dashboard.arn}/*"
        Condition = {
          StringEquals = {
            "AWS:SourceArn" = "arn:aws:cloudfront::${data.aws_caller_identity.current.account_id}:distribution/${local.prod_dashboard_distribution}"
          }
        }
      }
    ]
  })
}

resource "aws_s3_bucket_policy" "prod_survey" {
  bucket = aws_s3_bucket.prod_survey.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Principal = {
          Service = "cloudfront.amazonaws.com"
        }
        Action   = "s3:GetObject"
        Resource = "${aws_s3_bucket.prod_survey.arn}/*"
        Condition = {
          StringEquals = {
            "AWS:SourceArn" = "arn:aws:cloudfront::${data.aws_caller_identity.current.account_id}:distribution/${local.prod_survey_distribution}"
          }
        }
      }
    ]
  })
}

resource "aws_iam_role_policy" "prod_runtime_ssm_parameter_read" {
  name = "prod-runtime-ssm-parameter-read"
  role = "ec2-role-config-access"

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "ssm:GetParameter",
          "ssm:GetParameters",
        ]
        Resource = [
          "arn:aws:ssm:${var.aws_region}:${data.aws_caller_identity.current.account_id}:parameter/network-survey/prod/db/password",
          "arn:aws:ssm:${var.aws_region}:${data.aws_caller_identity.current.account_id}:parameter/network-survey/prod/api/session-secret",
          "arn:aws:ssm:${var.aws_region}:${data.aws_caller_identity.current.account_id}:parameter/network-survey/prod/api/resend-api-key",
        ]
      },
      {
        Effect   = "Allow"
        Action   = "kms:Decrypt"
        Resource = "*"
        Condition = {
          StringEquals = {
            "kms:ViaService" = "ssm.${var.aws_region}.amazonaws.com"
          }
        }
      }
    ]
  })
}

resource "aws_iam_role_policy" "github_actions_prod_legacy_artifact_bucket_deploy" {
  name = "prod-legacy-artifact-bucket-deploy"
  role = "github-actions-deploy"

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "s3:ListBucket",
          "s3:GetObject",
          "s3:PutObject",
          "s3:DeleteObject",
        ]
        Resource = [
          aws_s3_bucket.prod_config_artifacts.arn,
          "${aws_s3_bucket.prod_config_artifacts.arn}/*",
        ]
      }
    ]
  })
}
