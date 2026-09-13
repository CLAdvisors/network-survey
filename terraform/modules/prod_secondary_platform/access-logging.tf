locals {
  cloudfront_access_log_bucket_name = "network-survey-prod-secondary-access-logs-${var.account_id}"
  cloudfront_access_log_source_name = "${var.name_prefix}-api-access"
  cloudfront_access_log_fields = [
    "date",
    "time",
    "cs-method",
    "sc-status",
    "time-taken",
    "time-to-first-byte",
    "origin-fbl",
    "origin-lbl",
    "x-edge-result-type",
    "x-edge-response-result-type",
    "x-edge-detailed-result-type",
    "x-edge-request-id",
  ]
}

# CloudFront Standard Logging v2 is field-selective. In particular, this
# allowlist intentionally excludes raw paths, query strings, cookies, referrers,
# user agents, client IPs, forwarded IPs, and custom viewer data. ALB access logs
# remain disabled because their indivisible request_line contains the full URL.
resource "aws_s3_bucket" "cloudfront_access_logs" {
  bucket = local.cloudfront_access_log_bucket_name
  tags   = merge(var.common_tags, { Name = local.cloudfront_access_log_bucket_name, App = "ona-api-access-logs", DataClass = "sensitive-telemetry" })
}

resource "aws_s3_bucket_public_access_block" "cloudfront_access_logs" {
  bucket = aws_s3_bucket.cloudfront_access_logs.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_ownership_controls" "cloudfront_access_logs" {
  bucket = aws_s3_bucket.cloudfront_access_logs.id

  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "cloudfront_access_logs" {
  bucket = aws_s3_bucket.cloudfront_access_logs.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "cloudfront_access_logs" {
  bucket = aws_s3_bucket.cloudfront_access_logs.id

  rule {
    id     = "expire-access-telemetry"
    status = "Enabled"

    filter {}

    expiration {
      days = 30
    }

    abort_incomplete_multipart_upload {
      days_after_initiation = 1
    }
  }
}

data "aws_iam_policy_document" "cloudfront_access_logs" {
  statement {
    sid       = "DenyInsecureTransport"
    effect    = "Deny"
    actions   = ["s3:*"]
    resources = [aws_s3_bucket.cloudfront_access_logs.arn, "${aws_s3_bucket.cloudfront_access_logs.arn}/*"]

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

  statement {
    sid       = "AllowOnlyProdSecondaryDeliveryAclCheck"
    effect    = "Allow"
    actions   = ["s3:GetBucketAcl", "s3:ListBucket"]
    resources = [aws_s3_bucket.cloudfront_access_logs.arn]

    principals {
      type        = "Service"
      identifiers = ["delivery.logs.amazonaws.com"]
    }

    condition {
      test     = "StringEquals"
      variable = "aws:SourceAccount"
      values   = [var.account_id]
    }

    condition {
      test     = "ArnLike"
      variable = "aws:SourceArn"
      values   = ["arn:${data.aws_partition.current.partition}:logs:us-east-1:${var.account_id}:delivery-source:${local.cloudfront_access_log_source_name}"]
    }
  }

  statement {
    sid       = "AllowOnlyProdSecondaryLogWrites"
    effect    = "Allow"
    actions   = ["s3:PutObject"]
    resources = ["${aws_s3_bucket.cloudfront_access_logs.arn}/AWSLogs/aws-account-id=${var.account_id}/CloudFront/*"]

    principals {
      type        = "Service"
      identifiers = ["delivery.logs.amazonaws.com"]
    }

    condition {
      test     = "StringEquals"
      variable = "s3:x-amz-acl"
      values   = ["bucket-owner-full-control"]
    }

    condition {
      test     = "StringEquals"
      variable = "aws:SourceAccount"
      values   = [var.account_id]
    }

    condition {
      test     = "ArnLike"
      variable = "aws:SourceArn"
      values   = ["arn:${data.aws_partition.current.partition}:logs:us-east-1:${var.account_id}:delivery-source:${local.cloudfront_access_log_source_name}"]
    }
  }
}

resource "aws_s3_bucket_policy" "cloudfront_access_logs" {
  bucket = aws_s3_bucket.cloudfront_access_logs.id
  policy = data.aws_iam_policy_document.cloudfront_access_logs.json
}

resource "aws_cloudwatch_log_delivery_source" "cloudfront_api_access" {
  name         = local.cloudfront_access_log_source_name
  log_type     = "ACCESS_LOGS"
  resource_arn = aws_cloudfront_distribution.api.arn
  tags         = var.common_tags
}

resource "aws_cloudwatch_log_delivery_destination" "cloudfront_api_access" {
  name          = "${var.name_prefix}-api-access-s3"
  output_format = "json"

  delivery_destination_configuration {
    destination_resource_arn = aws_s3_bucket.cloudfront_access_logs.arn
  }

  tags = var.common_tags
}

resource "aws_cloudwatch_log_delivery" "cloudfront_api_access" {
  delivery_source_name     = aws_cloudwatch_log_delivery_source.cloudfront_api_access.name
  delivery_destination_arn = aws_cloudwatch_log_delivery_destination.cloudfront_api_access.arn
  record_fields            = local.cloudfront_access_log_fields

  s3_delivery_configuration = [{
    enable_hive_compatible_path = true
    suffix_path                 = "{distributionid}/{yyyy}/{MM}/{dd}/{HH}"
  }]

  tags       = var.common_tags
  depends_on = [aws_s3_bucket_policy.cloudfront_access_logs, aws_s3_bucket_ownership_controls.cloudfront_access_logs, aws_s3_bucket_server_side_encryption_configuration.cloudfront_access_logs]
}
