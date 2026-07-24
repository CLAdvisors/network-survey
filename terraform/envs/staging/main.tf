data "aws_caller_identity" "current" {}

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

# Dedicated security group for the database: only the backend can reach it
resource "aws_security_group" "db_sg" {
  name   = "${local.name_prefix}db-security-group"
  vpc_id = aws_vpc.main.id

  ingress {
    description     = "Postgres from the backend instance only"
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = [module.api_backend.backend_security_group_id]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = merge(local.common_tags, { Name = "${local.name_prefix}db-security-group" })
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
  engine_version         = "15.18"
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

# Add a random suffix to ensure the bucket name is unique
resource "random_string" "suffix" {
  length  = 6
  upper   = false
  special = false
}

module "api_backend" {
  source = "../../modules/api_backend"

  aws_region                              = var.aws_region
  environment                             = local.environment
  name_prefix                             = local.name_prefix
  vpc_id                                  = aws_vpc.main.id
  backend_subnet_id                       = aws_subnet.db_subnet_1.id
  alb_subnet_ids                          = [aws_subnet.db_subnet_1.id, aws_subnet.db_subnet_2.id]
  instance_type                           = var.instance_type
  ssh_allowed_cidrs                       = var.ssh_allowed_cidrs
  ssh_key_name                            = var.ssh_key_name
  certificate_arn                         = aws_acm_certificate.ssl_cert.arn
  config_bucket_name                      = local.config_bucket_name
  artifacts_bucket_name                   = local.artifacts_bucket_name
  artifact_retention_days                 = var.artifact_retention_days
  alb_deletion_protection                 = var.alb_deletion_protection
  cloud_init_template_path                = "${path.module}/../../cloud-init-template.sh"
  env_template_path                       = "${path.module}/../../templates/env.tmpl"
  db_host                                 = coalesce(var.api_config_db_host_override, aws_db_instance.postgres.address)
  db_port                                 = aws_db_instance.postgres.port
  db_name                                 = aws_db_instance.postgres.db_name
  db_user                                 = var.db_user
  db_password_parameter_name              = local.db_password_parameter_name
  session_secret_parameter_name           = local.session_secret_parameter_name
  resend_api_key_parameter_name           = local.resend_api_key_parameter_name
  bootstrap_admin_username                = "admin"
  bootstrap_admin_password_parameter_name = local.bootstrap_admin_password_parameter_name
  frontend_url                            = local.frontend_url
  survey_url                              = local.survey_url
  session_cookie_name                     = local.session_cookie_name

  common_tags                             = local.common_tags
  config_bucket_tags                      = merge(local.common_tags, { Name = "Config Bucket" })
  artifacts_bucket_tags                   = merge(local.common_tags, { Name = "API Artifacts", App = "ona-artifacts" })
  enable_config_bucket_ownership_controls = true

  backend_security_group_name        = "${local.name_prefix}backend-security-group"
  backend_security_group_description = null
  backend_security_group_tags        = merge(local.common_tags, { Name = "${local.name_prefix}backend-security-group" })
  backend_api_ingress_description    = "API traffic from the ALB"
  alb_security_group_name            = "${local.name_prefix}alb-security-group"
  alb_security_group_description     = "Allow HTTPS traffic to the ALB"
  alb_security_group_tags            = local.common_tags

  backend_instance_name = "${local.name_prefix}backend-instance"
  backend_instance_tags = merge(local.common_tags, { App = "ona-api" })

  iam_role_name             = "${local.name_prefix}ec2-role-config-access"
  iam_policy_name           = "${local.name_prefix}s3-config-access-policy"
  iam_policy_description    = "Allow EC2 to read the S3 config bucket and release artifacts"
  iam_instance_profile_name = "${local.name_prefix}instance-profile-access"
  iam_tags                  = null

  target_group_name                = "${local.name_prefix}backend-targets"
  target_group_tags                = null
  target_group_attachment_for_each = true
  alb_name                         = "${local.name_prefix}main-alb"
  alb_tags                         = merge(local.common_tags, { Name = "${local.name_prefix}main-alb" })
}

# Define the S3 bucket to store your static website or assets.
# Build files are uploaded by the CI deploy workflow (aws s3 sync), not by
# Terraform, so infra applies no longer depend on local build folders.
# Generate a unique suffix for the bucket name
resource "random_id" "bucket_id" {
  byte_length = 4
}

module "dashboard_frontend" {
  source = "../../modules/frontend_static_site"

  site_name           = "dashboard-${random_id.bucket_id.hex}"
  bucket_name         = local.dashboard_bucket_name
  domain_name         = var.dashboard_domain
  acm_certificate_arn = aws_acm_certificate.ssl_cert_dashboard.arn
  origin_id           = "S3-react-app"
  oac_name            = "dashboard-oac-${random_id.bucket_id.hex}"
  oac_description     = "OAC for React Dashboard S3 Bucket"
  cors_allowed_origins = [
    local.frontend_url,
  ]
  bucket_tags = merge(local.common_tags, {
    Name = "ReactAppBucket"
    App  = "ona-dashboard"
  })
  distribution_tags = merge(local.common_tags, {
    Name = "ReactAppCloudFront"
    App  = "ona-dashboard"
  })
}

module "survey_frontend" {
  source = "../../modules/frontend_static_site"

  site_name           = "survey-${random_id.bucket_id.hex}"
  bucket_name         = local.survey_bucket_name
  domain_name         = var.survey_domain
  acm_certificate_arn = aws_acm_certificate.ssl_cert_survey.arn
  origin_id           = "S3-react-app"
  oac_name            = "survey-oac-${random_id.bucket_id.hex}"
  oac_description     = "OAC for React survey S3 Bucket"
  cors_allowed_origins = [
    local.survey_url,
  ]
  bucket_tags = merge(local.common_tags, {
    Name = "ReactAppBucket"
    App  = "ona-survey"
  })
  distribution_tags = merge(local.common_tags, {
    Name = "ReactAppCloudFront"
    App  = "ona-survey"
  })
}

# Create an Origin Access Control (OAC) for CloudFront to securely access the S3 bucket
# Define the CloudFront distribution to serve content from the S3 bucket
# Update the S3 bucket policy to allow access from the CloudFront distribution using OAC
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

