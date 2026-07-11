# GitHub Actions OIDC federation for CI/CD deploys.
#
# These resources are account-global, so they are managed by exactly one
# workspace: set manage_github_oidc = true in prod.tfvars only. The deploy
# role's permissions cover every environment via tag/name conventions
# (Project=network-survey tags, ona-*/react-* bucket names).

resource "aws_iam_openid_connect_provider" "github" {
  count = var.manage_github_oidc ? 1 : 0

  url             = "https://token.actions.githubusercontent.com"
  client_id_list  = ["sts.amazonaws.com"]
  thumbprint_list = ["6938fd4d98bab03faadb97b34396831e3780aea1"]
}

data "aws_iam_policy_document" "github_actions_assume" {
  count = var.manage_github_oidc ? 1 : 0

  statement {
    actions = ["sts:AssumeRoleWithWebIdentity"]

    principals {
      type        = "Federated"
      identifiers = [aws_iam_openid_connect_provider.github[0].arn]
    }

    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values   = ["sts.amazonaws.com"]
    }

    condition {
      test     = "StringLike"
      variable = "token.actions.githubusercontent.com:sub"
      values   = ["repo:${var.github_repo}:*"]
    }
  }
}

data "aws_iam_policy_document" "github_actions_deploy" {
  count = var.manage_github_oidc ? 1 : 0

  # Frontend deploys: sync build output, and API deploys: upload artifacts
  statement {
    sid = "S3Deploy"
    actions = [
      "s3:ListBucket",
      "s3:GetObject",
      "s3:PutObject",
      "s3:DeleteObject",
    ]
    resources = [
      "arn:aws:s3:::react-dashboard-*",
      "arn:aws:s3:::react-dashboard-*/*",
      "arn:aws:s3:::react-survey-*",
      "arn:aws:s3:::react-survey-*/*",
      "arn:aws:s3:::ona-*",
      "arn:aws:s3:::ona-*/*",
    ]
  }

  statement {
    sid       = "CloudFrontInvalidate"
    actions   = ["cloudfront:CreateInvalidation", "cloudfront:GetInvalidation"]
    resources = ["*"]
  }

  # Read-only discovery for Terraform plan workflows. Apply workflows should use
  # a more tightly reviewed/admin role; this deploy role can only read infra plus
  # perform the explicit deployment actions below.
  statement {
    sid = "TerraformPlanReadOnly"
    actions = [
      "acm:Describe*",
      "acm:List*",
      "cloudfront:Get*",
      "cloudfront:List*",
      "ec2:Describe*",
      "elasticloadbalancing:Describe*",
      "iam:Get*",
      "iam:List*",
      "rds:Describe*",
      "rds:ListTagsForResource",
      "s3:Get*",
      "s3:List*",
      "tag:Get*",
    ]
    resources = ["*"]
  }

  # Terraform remote state for plan workflows
  statement {
    sid = "TerraformState"
    actions = [
      "s3:ListBucket",
      "s3:GetObject",
      "s3:PutObject",
      "s3:DeleteObject",
    ]
    resources = [
      "arn:aws:s3:::network-survey-terraform-state-*",
      "arn:aws:s3:::network-survey-terraform-state-*/*",
    ]
  }

  # Resolve per-environment resources by tag instead of hardcoding IDs
  statement {
    sid = "ResolveResources"
    actions = [
      "tag:GetResources",
      "ec2:DescribeInstances",
      "cloudfront:ListDistributions",
      "cloudfront:ListTagsForResource",
    ]
    resources = ["*"]
  }

  # Trigger the on-instance deploy script
  statement {
    sid       = "SsmRunDeploy"
    actions   = ["ssm:SendCommand"]
    resources = ["arn:aws:ssm:*::document/AWS-RunShellScript"]
  }

  statement {
    sid       = "SsmRunDeployOnTaggedInstances"
    actions   = ["ssm:SendCommand"]
    resources = ["arn:aws:ec2:*:*:instance/*"]

    condition {
      test     = "StringEquals"
      variable = "ssm:resourceTag/Project"
      values   = ["network-survey"]
    }
  }

  statement {
    sid       = "SsmReadResults"
    actions   = ["ssm:GetCommandInvocation", "ssm:ListCommands", "ssm:ListCommandInvocations"]
    resources = ["*"]
  }
}

resource "aws_iam_role" "github_actions_deploy" {
  count = var.manage_github_oidc ? 1 : 0

  name               = "github-actions-deploy"
  assume_role_policy = data.aws_iam_policy_document.github_actions_assume[0].json

  tags = local.common_tags
}

resource "aws_iam_role_policy" "github_actions_deploy" {
  count = var.manage_github_oidc ? 1 : 0

  name   = "github-actions-deploy"
  role   = aws_iam_role.github_actions_deploy[0].id
  policy = data.aws_iam_policy_document.github_actions_deploy[0].json
}
