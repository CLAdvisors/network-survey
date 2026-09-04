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

  lifecycle {
    precondition {
      condition     = (var.bootstrap_admin_username == null) == (var.bootstrap_admin_password_parameter_name == null)
      error_message = "bootstrap_admin_username and bootstrap_admin_password_parameter_name must either both be set or both be null."
    }
  }
  content = templatefile(var.env_template_path, {
    db_host                                       = var.db_host
    db_port                                       = var.db_port
    db_name                                       = var.db_name
    db_user                                       = var.db_user
    db_password_parameter_name                    = var.db_password_parameter_name
    frontend_url                                  = var.frontend_url
    survey_url                                    = var.survey_url
    survey_allowed_origins                        = var.survey_allowed_origins
    session_secret_parameter_name                 = var.session_secret_parameter_name
    session_cookie_name                           = var.session_cookie_name
    email_worker_environment                      = var.email_worker_environment
    survey_delivery_v2_enabled                    = var.survey_delivery_v2_enabled
    legacy_start_enabled                          = var.legacy_start_enabled
    email_rate_per_second                         = var.email_rate_per_second
    email_rate_budget_environment                 = var.email_rate_budget_environment
    resend_api_key_parameter_name                 = var.resend_api_key_parameter_name
    resend_webhook_secret_parameter_name          = var.resend_webhook_secret_parameter_name
    resend_webhook_previous_secret_parameter_name = var.resend_webhook_previous_secret_parameter_name
    resend_provider_account_scope                 = var.resend_provider_account_scope
    resend_webhook_ingest_enabled                 = var.resend_webhook_ingest_enabled
    webhook_payload_retention_days                = var.webhook_payload_retention_days
    webhook_metric_namespace                      = var.webhook_metric_namespace
    bootstrap_admin_username                      = var.bootstrap_admin_username
    bootstrap_admin_password_parameter_name       = var.bootstrap_admin_password_parameter_name
    bootstrap_admin_email                         = var.bootstrap_admin_email
    bootstrap_organization_name                   = var.bootstrap_organization_name
    bootstrap_organization_slug                   = var.bootstrap_organization_slug
    bootstrap_platform_admin                      = var.bootstrap_platform_admin
    bootstrap_account_mode                        = var.bootstrap_account_mode
    cla_production_cutover                        = var.cla_production_cutover
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
    resources = concat([
      "arn:aws:ssm:${var.aws_region}:${data.aws_caller_identity.current.account_id}:parameter${var.db_password_parameter_name}",
      "arn:aws:ssm:${var.aws_region}:${data.aws_caller_identity.current.account_id}:parameter${var.session_secret_parameter_name}",
      "arn:aws:ssm:${var.aws_region}:${data.aws_caller_identity.current.account_id}:parameter${var.resend_api_key_parameter_name}",
      "arn:aws:ssm:${var.aws_region}:${data.aws_caller_identity.current.account_id}:parameter${var.resend_webhook_secret_parameter_name}",
      ], concat(var.resend_webhook_previous_secret_parameter_name == null ? [] : [
        "arn:aws:ssm:${var.aws_region}:${data.aws_caller_identity.current.account_id}:parameter${var.resend_webhook_previous_secret_parameter_name}",
        ], var.bootstrap_admin_password_parameter_name == null ? [] : [
        "arn:aws:ssm:${var.aws_region}:${data.aws_caller_identity.current.account_id}:parameter${var.bootstrap_admin_password_parameter_name}",
    ]))
  }

  statement {
    effect = "Allow"
    actions = [
      "logs:CreateLogStream",
      "logs:DescribeLogStreams",
      "logs:PutLogEvents",
    ]
    resources = [for group in aws_cloudwatch_log_group.runtime : "${group.arn}:*"]
  }

  statement {
    effect    = "Allow"
    actions   = ["cloudwatch:PutMetricData"]
    resources = ["*"]

    condition {
      test     = "StringEquals"
      variable = "cloudwatch:namespace"
      values   = ["NetworkSurvey/Host"]
    }
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

resource "aws_cloudwatch_log_group" "runtime" {
  for_each = toset(["api", "email-worker", "webhook-worker", "host"])

  name              = "/network-survey/${var.environment}/${each.key}"
  retention_in_days = var.cloudwatch_log_retention_days
  tags              = var.common_tags
}

resource "aws_sns_topic" "operations_alerts" {
  name = "${trimsuffix(var.name_prefix, "-")}-operations-alerts"
  tags = var.common_tags
}

data "aws_iam_policy_document" "operations_alert_topic" {
  statement {
    sid       = "TopicOwnerAdministration"
    effect    = "Allow"
    actions   = ["SNS:GetTopicAttributes", "SNS:SetTopicAttributes", "SNS:AddPermission", "SNS:RemovePermission", "SNS:DeleteTopic", "SNS:Subscribe", "SNS:ListSubscriptionsByTopic", "SNS:Publish"]
    resources = [aws_sns_topic.operations_alerts.arn]
    principals {
      type        = "AWS"
      identifiers = [data.aws_caller_identity.current.account_id]
    }
  }

  statement {
    sid       = "CloudWatchAlarmPublish"
    effect    = "Allow"
    actions   = ["SNS:Publish"]
    resources = [aws_sns_topic.operations_alerts.arn]
    principals {
      type        = "Service"
      identifiers = ["cloudwatch.amazonaws.com"]
    }
    condition {
      test     = "StringEquals"
      variable = "AWS:SourceAccount"
      values   = [data.aws_caller_identity.current.account_id]
    }
    condition {
      test     = "ArnLike"
      variable = "AWS:SourceArn"
      values   = ["arn:aws:cloudwatch:${var.aws_region}:${data.aws_caller_identity.current.account_id}:alarm:*"]
    }
  }
}

resource "aws_sns_topic_policy" "operations_alerts" {
  arn    = aws_sns_topic.operations_alerts.arn
  policy = data.aws_iam_policy_document.operations_alert_topic.json
}

resource "aws_sns_topic_subscription" "operations_email" {
  count = var.operations_alert_email == null ? 0 : 1

  topic_arn = aws_sns_topic.operations_alerts.arn
  protocol  = "email"
  endpoint  = var.operations_alert_email
}

locals {
  cloudwatch_agent_config_b64 = base64encode(jsonencode({
    agent = { metrics_collection_interval = 60, run_as_user = "root" }
    metrics = {
      namespace              = "NetworkSurvey/Host"
      append_dimensions      = { InstanceId = "$${aws:InstanceId}" }
      aggregation_dimensions = [["InstanceId"]]
      metrics_collected = {
        mem  = { measurement = ["mem_used_percent"] }
        swap = { measurement = ["swap_used_percent"] }
        disk = { measurement = ["used_percent", "inodes_free"], resources = ["/"] }
      }
    }
    logs = { logs_collected = { files = { collect_list = [
      { file_path = "/home/ubuntu/.pm2/logs/ona-api-out.log", log_group_name = aws_cloudwatch_log_group.runtime["api"].name, log_stream_name = "{instance_id}/stdout", timezone = "UTC" },
      { file_path = "/home/ubuntu/.pm2/logs/ona-api-error.log", log_group_name = aws_cloudwatch_log_group.runtime["api"].name, log_stream_name = "{instance_id}/stderr", timezone = "UTC" },
      { file_path = "/home/ubuntu/.pm2/logs/ona-email-worker-out.log", log_group_name = aws_cloudwatch_log_group.runtime["email-worker"].name, log_stream_name = "{instance_id}/stdout", timezone = "UTC" },
      { file_path = "/home/ubuntu/.pm2/logs/ona-email-worker-error.log", log_group_name = aws_cloudwatch_log_group.runtime["email-worker"].name, log_stream_name = "{instance_id}/stderr", timezone = "UTC" },
      { file_path = "/home/ubuntu/.pm2/logs/ona-email-webhook-worker-out.log", log_group_name = aws_cloudwatch_log_group.runtime["webhook-worker"].name, log_stream_name = "{instance_id}/stdout", timezone = "UTC" },
      { file_path = "/home/ubuntu/.pm2/logs/ona-email-webhook-worker-error.log", log_group_name = aws_cloudwatch_log_group.runtime["webhook-worker"].name, log_stream_name = "{instance_id}/stderr", timezone = "UTC" },
      { file_path = "/home/ubuntu/.pm2/pm2.log", log_group_name = aws_cloudwatch_log_group.runtime["host"].name, log_stream_name = "{instance_id}/pm2", timezone = "UTC" },
      { file_path = "/var/log/kern.log", log_group_name = aws_cloudwatch_log_group.runtime["host"].name, log_stream_name = "{instance_id}/kernel", timezone = "UTC" },
    ] } } }
  }))

  webhook_metric_alarms = {
    heartbeat = {
      metric      = "WebhookWorkerHeartbeat"
      comparison  = "LessThanThreshold"
      threshold   = 1
      periods     = 2
      period      = 60
      statistic   = "Minimum"
      description = "Webhook worker heartbeat absent or unhealthy for two minutes."
    }
    oldest-pending = {
      metric      = "OldestPendingEventAgeSeconds"
      comparison  = "GreaterThanThreshold"
      threshold   = 300
      periods     = 2
      period      = 60
      statistic   = "Maximum"
      description = "Oldest pending or retry webhook event exceeds five minutes."
    }
    unmatched-warning = {
      metric      = "OldestUnmatchedEventAgeSeconds"
      comparison  = "GreaterThanThreshold"
      threshold   = 3600
      periods     = 2
      period      = 60
      statistic   = "Maximum"
      description = "Oldest unmatched webhook event exceeds one hour."
    }
    unmatched-alarm = {
      metric      = "OldestUnmatchedEventAgeSeconds"
      comparison  = "GreaterThanThreshold"
      threshold   = 86400
      periods     = 1
      period      = 60
      statistic   = "Maximum"
      description = "Oldest unmatched webhook event exceeds 24 hours."
    }
    dead-letter = {
      metric      = "DeadLetterCount"
      comparison  = "GreaterThanOrEqualToThreshold"
      threshold   = 1
      periods     = 1
      period      = 60
      statistic   = "Maximum"
      description = "At least one webhook event is dead-lettered."
    }
    invalid-signature = {
      metric      = "InvalidSignatureCount"
      comparison  = "GreaterThanThreshold"
      threshold   = 10
      periods     = 1
      period      = 300
      statistic   = "Sum"
      description = "More than ten webhook signature failures occurred in five minutes."
      missing     = "notBreaching"
    }
    suppression-reconciliation = {
      metric      = "SuppressionReconciliationFailureCount"
      comparison  = "GreaterThanOrEqualToThreshold"
      threshold   = 1
      periods     = 1
      period      = 60
      statistic   = "Sum"
      description = "Suppression reconciliation failed."
      missing     = "notBreaching"
    }
    payload-purge = {
      metric      = "PayloadPurgeFailureCount"
      comparison  = "GreaterThanOrEqualToThreshold"
      threshold   = 1
      periods     = 1
      period      = 60
      statistic   = "Sum"
      description = "Expired raw webhook payload purge failed."
      missing     = "notBreaching"
    }
    canary = {
      metric      = "WebhookCanaryAgeSeconds"
      comparison  = "GreaterThanThreshold"
      threshold   = 64800
      periods     = 1
      period      = 3600
      statistic   = "Maximum"
      description = "No successful controlled provider webhook canary for 18 hours."
    }
  }
}

resource "aws_cloudwatch_metric_alarm" "webhook" {
  for_each = var.resend_webhook_ingest_enabled ? local.webhook_metric_alarms : {}

  alarm_name          = "${var.name_prefix}-webhook-${each.key}"
  alarm_description   = each.value.description
  namespace           = var.webhook_metric_namespace
  metric_name         = each.value.metric
  dimensions          = { Environment = var.environment }
  comparison_operator = each.value.comparison
  threshold           = each.value.threshold
  evaluation_periods  = each.value.periods
  datapoints_to_alarm = each.value.periods
  period              = each.value.period
  statistic           = each.value.statistic
  treat_missing_data  = lookup(each.value, "missing", "breaching")
  alarm_actions       = [aws_sns_topic.operations_alerts.arn]
  ok_actions          = [aws_sns_topic.operations_alerts.arn]
  tags                = var.common_tags
}

resource "aws_cloudwatch_metric_alarm" "uncertain_quota_disabled" {
  count = var.resend_webhook_ingest_enabled ? 1 : 0

  alarm_name          = "${var.name_prefix}-email-uncertain-and-quota-disabled"
  alarm_description   = "At least one uncertain delivery exists while quota protection has disabled claiming."
  comparison_operator = "GreaterThanOrEqualToThreshold"
  threshold           = 1
  evaluation_periods  = 1
  datapoints_to_alarm = 1
  treat_missing_data  = "breaching"
  alarm_actions       = [aws_sns_topic.operations_alerts.arn]
  ok_actions          = [aws_sns_topic.operations_alerts.arn]
  tags                = var.common_tags

  metric_query {
    id          = "both"
    expression  = "IF(uncertain >= 1, IF(quota >= 1, 1, 0), 0)"
    label       = "Uncertain delivery and quota disable"
    return_data = true
  }

  metric_query {
    id = "uncertain"
    metric {
      namespace   = var.webhook_metric_namespace
      metric_name = "UncertainDeliveryCount"
      period      = 60
      stat        = "Maximum"
      dimensions  = { Environment = var.environment }
    }
  }

  metric_query {
    id = "quota"
    metric {
      namespace   = var.webhook_metric_namespace
      metric_name = "QuotaClaimingDisabled"
      period      = 60
      stat        = "Maximum"
      dimensions  = { Environment = var.environment }
    }
  }
}

locals {
  runtime_processes = toset(["api", "email-worker", "webhook-worker"])
  process_memory_alarm_bytes = {
    api              = 335544320
    "email-worker"   = 157286400
    "webhook-worker" = 157286400
  }
  host_runtime_alarms = {
    memory = { metric = "mem_used_percent", comparison = "GreaterThanThreshold", threshold = 85, statistic = "Maximum" }
    swap   = { metric = "swap_used_percent", comparison = "GreaterThanThreshold", threshold = 20, statistic = "Maximum" }
    disk   = { metric = "disk_used_percent", comparison = "GreaterThanThreshold", threshold = 80, statistic = "Maximum" }
    inodes = { metric = "disk_inodes_free", comparison = "LessThanThreshold", threshold = 10000, statistic = "Minimum" }
  }
}

resource "aws_cloudwatch_metric_alarm" "host_runtime" {
  for_each = local.host_runtime_alarms

  alarm_name          = "${var.name_prefix}host-${each.key}"
  alarm_description   = "Host ${each.key} pressure requires investigation before process or instance restart."
  namespace           = "NetworkSurvey/Host"
  metric_name         = each.value.metric
  dimensions          = { InstanceId = aws_instance.backend.id }
  comparison_operator = each.value.comparison
  threshold           = each.value.threshold
  evaluation_periods  = 3
  datapoints_to_alarm = 3
  period              = 60
  statistic           = each.value.statistic
  treat_missing_data  = "breaching"
  alarm_actions       = [aws_sns_topic.operations_alerts.arn]
  ok_actions          = [aws_sns_topic.operations_alerts.arn]
  tags                = var.common_tags
}

resource "aws_cloudwatch_metric_alarm" "process_heartbeat" {
  for_each = local.runtime_processes

  alarm_name          = "${var.name_prefix}${each.key}-runtime-heartbeat"
  alarm_description   = "${each.key} runtime telemetry is absent."
  namespace           = "NetworkSurvey/Runtime"
  metric_name         = "ProcessHeartbeat"
  dimensions          = { Environment = var.environment, Process = each.key }
  comparison_operator = "LessThanThreshold"
  threshold           = 1
  evaluation_periods  = 3
  datapoints_to_alarm = 3
  period              = 60
  statistic           = "Minimum"
  treat_missing_data  = "breaching"
  alarm_actions       = [aws_sns_topic.operations_alerts.arn]
  ok_actions          = [aws_sns_topic.operations_alerts.arn]
  tags                = var.common_tags
}

resource "aws_cloudwatch_metric_alarm" "process_restart_churn" {
  for_each = local.runtime_processes

  alarm_name          = "${var.name_prefix}${each.key}-restart-churn"
  alarm_description   = "${each.key} started more than three times in 15 minutes; inspect PM2 and kernel logs."
  namespace           = "NetworkSurvey/Runtime"
  metric_name         = "ProcessStartCount"
  dimensions          = { Environment = var.environment, Process = each.key }
  comparison_operator = "GreaterThanThreshold"
  threshold           = 3
  evaluation_periods  = 1
  datapoints_to_alarm = 1
  period              = 900
  statistic           = "Sum"
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.operations_alerts.arn]
  ok_actions          = [aws_sns_topic.operations_alerts.arn]
  tags                = var.common_tags
}

resource "aws_cloudwatch_metric_alarm" "process_memory" {
  for_each = local.process_memory_alarm_bytes

  alarm_name          = "${var.name_prefix}${each.key}-memory"
  alarm_description   = "${each.key} RSS is approaching its reviewed PM2 restart tripwire."
  namespace           = "NetworkSurvey/Runtime"
  metric_name         = "ProcessRssBytes"
  dimensions          = { Environment = var.environment, Process = each.key }
  comparison_operator = "GreaterThanThreshold"
  threshold           = each.value
  evaluation_periods  = 3
  datapoints_to_alarm = 3
  period              = 60
  statistic           = "Maximum"
  treat_missing_data  = "breaching"
  alarm_actions       = [aws_sns_topic.operations_alerts.arn]
  ok_actions          = [aws_sns_topic.operations_alerts.arn]
  tags                = var.common_tags
}

resource "aws_cloudwatch_metric_alarm" "runtime_pressure" {
  for_each = {
    for pair in setproduct(local.runtime_processes, ["event-loop", "db-pool"]) : "${pair[0]}-${pair[1]}" => {
      process     = pair[0]
      metric      = pair[1] == "event-loop" ? "EventLoopLagMilliseconds" : "DbPoolWaiting"
      threshold   = pair[1] == "event-loop" ? 500 : 0
      description = pair[1] == "event-loop" ? "event-loop lag exceeded 500ms" : "PostgreSQL pool waiters persisted"
    }
  }

  alarm_name          = "${var.name_prefix}${each.key}"
  alarm_description   = "${each.value.process} ${each.value.description} for three minutes."
  namespace           = "NetworkSurvey/Runtime"
  metric_name         = each.value.metric
  dimensions          = { Environment = var.environment, Process = each.value.process }
  comparison_operator = "GreaterThanThreshold"
  threshold           = each.value.threshold
  evaluation_periods  = 3
  datapoints_to_alarm = 3
  period              = 60
  statistic           = "Maximum"
  treat_missing_data  = "breaching"
  alarm_actions       = [aws_sns_topic.operations_alerts.arn]
  ok_actions          = [aws_sns_topic.operations_alerts.arn]
  tags                = var.common_tags
}

resource "aws_cloudwatch_log_metric_filter" "kernel_oom" {
  name           = "${var.name_prefix}kernel-oom"
  log_group_name = aws_cloudwatch_log_group.runtime["host"].name
  pattern        = "?\"Out of memory\" ?\"Killed process\" ?oom-kill"

  metric_transformation {
    name      = "KernelOomCount"
    namespace = "NetworkSurvey/Host"
    value     = "1"
  }
}

resource "aws_cloudwatch_log_metric_filter" "critical_system" {
  name           = "${var.name_prefix}critical-system"
  log_group_name = aws_cloudwatch_log_group.runtime["host"].name
  pattern        = "?panic ?segfault ?\"I/O error\" ?EXT4-fs"

  metric_transformation {
    name      = "CriticalSystemLogCount"
    namespace = "NetworkSurvey/Host"
    value     = "1"
  }
}

resource "aws_cloudwatch_metric_alarm" "kernel_oom" {
  alarm_name          = "${var.name_prefix}kernel-oom"
  alarm_description   = "Kernel OOM activity detected; inspect RSS, PM2 restarts, and host capacity."
  namespace           = "NetworkSurvey/Host"
  metric_name         = "KernelOomCount"
  comparison_operator = "GreaterThanOrEqualToThreshold"
  threshold           = 1
  evaluation_periods  = 1
  datapoints_to_alarm = 1
  period              = 60
  statistic           = "Sum"
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.operations_alerts.arn]
  ok_actions          = [aws_sns_topic.operations_alerts.arn]
  tags                = var.common_tags
}

resource "aws_cloudwatch_metric_alarm" "critical_system" {
  alarm_name          = "${var.name_prefix}critical-system"
  alarm_description   = "Kernel panic, segfault, filesystem, or I/O error pattern detected."
  namespace           = "NetworkSurvey/Host"
  metric_name         = "CriticalSystemLogCount"
  comparison_operator = "GreaterThanOrEqualToThreshold"
  threshold           = 1
  evaluation_periods  = 1
  datapoints_to_alarm = 1
  period              = 60
  statistic           = "Sum"
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.operations_alerts.arn]
  ok_actions          = [aws_sns_topic.operations_alerts.arn]
  tags                = var.common_tags
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
    config_bucket            = aws_s3_bucket.config_bucket.bucket
    artifacts_bucket         = aws_s3_bucket.artifacts.bucket
    aws_region               = var.aws_region
    environment              = var.environment
    api_log_group            = aws_cloudwatch_log_group.runtime["api"].name
    email_worker_log_group   = aws_cloudwatch_log_group.runtime["email-worker"].name
    webhook_worker_log_group = aws_cloudwatch_log_group.runtime["webhook-worker"].name
    host_log_group           = aws_cloudwatch_log_group.runtime["host"].name
  })

  lifecycle {
    ignore_changes = [ami]
  }

  tags = merge(var.backend_instance_tags, {
    Name = var.backend_instance_name
  })
}

# Cloud-init does not rerun on existing instances. This association installs or
# refreshes observability in place during Terraform apply as well as on future
# replacement hosts.
resource "aws_ssm_association" "cloudwatch_agent" {
  name             = "AWS-RunShellScript"
  association_name = "${trimsuffix(var.name_prefix, "-")}-cloudwatch-agent"

  targets {
    key    = "InstanceIds"
    values = [aws_instance.backend.id]
  }

  parameters = {
    commands = join("\n", [
      "set -eu",
      "if [ ! -x /opt/aws/amazon-cloudwatch-agent/bin/amazon-cloudwatch-agent-ctl ]; then curl -fsSL https://amazoncloudwatch-agent.s3.amazonaws.com/ubuntu/amd64/latest/amazon-cloudwatch-agent.deb -o /tmp/amazon-cloudwatch-agent.deb; dpkg -i /tmp/amazon-cloudwatch-agent.deb; rm -f /tmp/amazon-cloudwatch-agent.deb; fi",
      "mkdir -p /opt/aws/amazon-cloudwatch-agent/etc",
      "printf '%s' '${local.cloudwatch_agent_config_b64}' | base64 -d > /opt/aws/amazon-cloudwatch-agent/etc/amazon-cloudwatch-agent.json",
      "/opt/aws/amazon-cloudwatch-agent/bin/amazon-cloudwatch-agent-ctl -a fetch-config -m ec2 -c file:/opt/aws/amazon-cloudwatch-agent/etc/amazon-cloudwatch-agent.json -s",
      "/opt/aws/amazon-cloudwatch-agent/bin/amazon-cloudwatch-agent-ctl -a status",
    ])
  }

  depends_on = [aws_iam_role_policy_attachment.ec2_s3_policy, aws_iam_role_policy_attachment.ec2_ssm_policy]
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
