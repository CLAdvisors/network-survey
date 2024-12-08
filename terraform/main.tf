# Create a VPC for networking
resource "aws_vpc" "main" {
  cidr_block           = "10.0.0.0/16"
  enable_dns_support   = true
  enable_dns_hostnames = true
}

# Create additional subnets for RDS
resource "aws_subnet" "db_subnet_1" {
  vpc_id                  = aws_vpc.main.id
  cidr_block              = "10.0.2.0/24"
  availability_zone       = "${var.aws_region}a"
  map_public_ip_on_launch = true
}

resource "aws_subnet" "db_subnet_2" {
  vpc_id                  = aws_vpc.main.id
  cidr_block              = "10.0.3.0/24"
  availability_zone       = "${var.aws_region}b"
}

# DB parameter group to turn off ssl
resource "aws_db_parameter_group" "postgres_no_ssl" {
  name        = "postgres-no-ssl"
  family      = "postgres15" # Use the family matching your PostgreSQL version
  description = "Parameter group to allow connections without SSL"

  parameter {
    name  = "rds.force_ssl"
    value = "0" # Disable forced SSL
    apply_method = "pending-reboot"
  }
}

# Create a DB subnet group
resource "aws_db_subnet_group" "db_subnet_group" {
  name       = "db-subnet-group"
  subnet_ids = [
    aws_subnet.db_subnet_1.id,
    aws_subnet.db_subnet_2.id,
  ]

  tags = {
    Name = "DB Subnet Group"
  }
}

# Create a security group for the instance
resource "aws_security_group" "backend_sg" {
  name   = "backend-security-group"
  vpc_id = aws_vpc.main.id

  ingress {
    from_port   = 22
    to_port     = 22
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"] # Allow SSH
  }

  ingress {
    from_port   = 3000
    to_port     = 3000
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"] # Allow backend access
  }

  ingress {
    from_port = 5432
    to_port   = 5432

    protocol    = "tcp"
    cidr_blocks = ["10.0.0.0/16"]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name = "backend-security-group"
  }
}

# Update EC2 instance to use the IAM Instance Profile
resource "aws_instance" "backend" {
  ami           = "ami-0dba2cb6798deb6d8" # Replace with appropriate AMI ID for your region
  instance_type = var.instance_type
  subnet_id     = aws_subnet.db_subnet_1.id
  vpc_security_group_ids = [aws_security_group.backend_sg.id]
  associate_public_ip_address = true
  iam_instance_profile        = aws_iam_instance_profile.ec2_instance_profile.name
  key_name                    = "api-instance-key"

  user_data = templatefile("cloud-init-template.sh", {
    bucket_name = aws_s3_bucket.config_bucket.bucket
  })

  tags = {
    Name = "backend-instance"
  }
}
# Create an Internet Gateway
resource "aws_internet_gateway" "igw" {
  vpc_id = aws_vpc.main.id

  tags = {
    Name = "main-igw"
  }
}

# Create a public route table
resource "aws_route_table" "public_rt" {
  vpc_id = aws_vpc.main.id

  tags = {
    Name = "public-route-table"
  }
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
  engine_version         = "15.10"            # Use a compatible version
  instance_class         = "db.t3.micro"     # Use a compatible instance class
  db_name                = "ONA"
  username               = var.db_user
  password               = var.db_password
  publicly_accessible    = true
  vpc_security_group_ids = [aws_security_group.backend_sg.id]
  db_subnet_group_name   = aws_db_subnet_group.db_subnet_group.name
  parameter_group_name   = aws_db_parameter_group.postgres_no_ssl.name # Apply custom parameter group
  skip_final_snapshot    = true
  tags = {
    Name = "postgres-db"
  }
}

# Create an S3 bucket to store configuration files
resource "aws_s3_bucket" "config_bucket" {
  bucket = "my-config-bucket-${random_string.suffix.result}"

  tags = {
    Name = "Config Bucket"
  }
}

# Ensure the bucket is private by blocking public access
resource "aws_s3_bucket_public_access_block" "config_bucket_public_access" {
  bucket = aws_s3_bucket.config_bucket.id

  block_public_acls   = true
  ignore_public_acls  = true
  block_public_policy = true
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

# Upload API config file to the S3 bucket
resource "aws_s3_object" "api_config" {
  bucket = aws_s3_bucket.config_bucket.id
  key    = "configs/.env.prod"
  content = templatefile("./templates/env.tmpl", {
    db_host     = aws_db_instance.postgres.address
    db_port     = aws_db_instance.postgres.port
    db_name     = aws_db_instance.postgres.db_name
    db_user     = var.db_user
    db_password = var.db_password
  })
}

# IAM Role for the EC2 instance
resource "aws_iam_role" "ec2_role" {
  name               = "ec2-role-config-access"
  assume_role_policy = data.aws_iam_policy_document.ec2_assume_role_policy.json
}

# Policy to allow the EC2 instance to access the S3 bucket
resource "aws_iam_policy" "s3_access_policy" {
  name        = "s3-config-access-policy"
  description = "Allow EC2 to access S3 config bucket"
  policy      = data.aws_iam_policy_document.s3_access_policy.json
}

data "aws_iam_policy_document" "s3_access_policy" {
  statement {
    effect    = "Allow"
    actions   = ["s3:GetObject"]
    resources = ["${aws_s3_bucket.config_bucket.arn}/*"]
  }
}

# EC2 instance config role policy attachment 
resource "aws_iam_role_policy_attachment" "ec2_s3_policy" {
  role       = aws_iam_role.ec2_role.name
  policy_arn = aws_iam_policy.s3_access_policy.arn
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
        Action = "s3:GetObject"
        Resource = "${aws_s3_bucket.config_bucket.arn}/*"
      }
    ]
  })
}

# Attach the S3 access policy to the EC2 IAM role
resource "aws_iam_role_policy_attachment" "attach_s3_policy" {
  role       = aws_iam_role.ec2_role.name
  policy_arn = aws_iam_policy.s3_access_policy.arn
}

# EC2 Instance Profile
resource "aws_iam_instance_profile" "ec2_instance_profile" {
  name = "instance-profile-access"
  role = aws_iam_role.ec2_role.name
}

resource "local_file" "liquibase_properties" {
  filename = "../db/liquibase-prod.sh"
  content  = templatefile("./templates/liquibase-prod.sh.tmpl", {
    db_host     = aws_db_instance.postgres.address
    db_port     = aws_db_instance.postgres.port
    db_name     = aws_db_instance.postgres.db_name
    db_user     = var.db_user
    db_password = var.db_password
  })

  # Ensure the generated script is executable
  file_permission = "0755"
}

resource "local_file" "liquibase_properties_ps" {
  filename = "../db/liquibase-prod.ps1"
  content  = templatefile("./templates/liquibase-prod.ps1.tmpl", {
    db_host     = aws_db_instance.postgres.address
    db_port     = aws_db_instance.postgres.port
    db_name     = aws_db_instance.postgres.db_name
    db_user     = var.db_user
    db_password = var.db_password
  })

  # Ensure the generated script is executable
  file_permission = "0755"
}

resource "local_file" "api_config" {
  filename = "../api/.env.prod"
  content  = templatefile("./templates/env.tmpl", {
    db_host     = aws_db_instance.postgres.address
    db_port     = aws_db_instance.postgres.port
    db_name     = aws_db_instance.postgres.db_name
    db_user     = var.db_user
    db_password = var.db_password
  })
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

# Upload React build files to S3
resource "aws_s3_object" "react_dashboard_files" {
  for_each = fileset("../dashboard/build", "**/*")

  bucket = aws_s3_bucket.react_dashboard.id
  key    = each.value
  source = "../dashboard/build/${each.value}"

  content_type = lookup(
    {
      "html" = "text/html",
      "css"  = "text/css",
      "js"   = "application/javascript",
      "png"  = "image/png",
      "jpg"  = "image/jpeg",
    },
    element(split(".", each.value), length(split(".", each.value)) - 1),
    "application/octet-stream"
  )
}
# Define the S3 bucket to store your static website or assets
resource "aws_s3_bucket" "react_dashboard" {
  bucket = "react-dashboard-${random_id.bucket_id.hex}"

  tags = {
    Name        = "ReactAppBucket"
    Environment = "Production"
  }
}

resource "aws_s3_bucket_cors_configuration" "react_dashboard_cors" {
  bucket = aws_s3_bucket.react_dashboard.id

  cors_rule {
    allowed_methods = ["GET", "HEAD"]
    allowed_origins = ["*"] # Replace with specific origins if needed
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
  aliases = [ "demo.ona.dashboard.bennetts.work" ]
  default_cache_behavior {
    allowed_methods  = ["GET", "HEAD", "OPTIONS"]
    cached_methods   = ["GET", "HEAD"]
    target_origin_id = "S3-react-app"
    viewer_protocol_policy = "allow-all"

    forwarded_values {
      query_string             = true
      query_string_cache_keys  = ["v"]
      headers                  = ["Origin"]
      cookies {
        forward = "none"
      }
    }

    min_ttl                = 0
    default_ttl            = 3600
    max_ttl                = 86400
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    acm_certificate_arn      = aws_acm_certificate.ssl_cert_dashboard.arn
    ssl_support_method       = "sni-only"
    minimum_protocol_version = "TLSv1.2_2018"
  }

  tags = {
    Name        = "ReactAppCloudFront"
    Environment = "Production"
  }
}


# Update the S3 bucket policy to allow access from the CloudFront distribution using OAC
resource "aws_s3_bucket_policy" "react_dashboard_policy" {
  bucket = aws_s3_bucket.react_dashboard.id

  policy = jsonencode({
    "Version": "2012-10-17",
    "Statement": [
      {
        "Effect": "Allow",
        "Principal": {
          "Service": "cloudfront.amazonaws.com"
        },
        "Action": "s3:GetObject",
        "Resource": "${aws_s3_bucket.react_dashboard.arn}/*",
        "Condition": {
          "StringEquals": {
            "AWS:SourceArn": "${aws_cloudfront_distribution.react_dashboard_distribution.arn}"
          }
        }
      }
    ]
  })
}

# Request an SSL certificate in ACM
resource "aws_acm_certificate" "ssl_cert" {
  domain_name       = "demo.ona.api.bennetts.work"
  validation_method = "DNS"

  tags = {
    Name = "SSL Certificate"
  }
}

# Request an SSL certificate in ACM for dashboard
resource "aws_acm_certificate" "ssl_cert_dashboard" {
  domain_name       = "demo.ona.dashboard.bennetts.work"
  validation_method = "DNS"

  subject_alternative_names = [ "demo.ona.dashboard.bennetts.work" ]

  tags = {
    Name = "SSL Certificate"
  }
}

# Wait for the certificate to be validated (manual process)
resource "aws_acm_certificate_validation" "ssl_cert_validation" {
  certificate_arn         = aws_acm_certificate.ssl_cert.arn
  validation_record_fqdns = [
    for dvo in aws_acm_certificate.ssl_cert.domain_validation_options : dvo.resource_record_name
  ]
}

# Wait for the certificate to be validated (manual process)
resource "aws_acm_certificate_validation" "ssl_cert_dashboard_validation" {
  certificate_arn         = aws_acm_certificate.ssl_cert_dashboard.arn
  validation_record_fqdns = [
    for dvo in aws_acm_certificate.ssl_cert_dashboard.domain_validation_options : dvo.resource_record_name
  ]
}

# Security group for the ALB
resource "aws_security_group" "alb_sg" {
  name        = "alb-security-group"
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
}

# Target group for backend instances
resource "aws_lb_target_group" "backend_targets" {
  name        = "backend-targets"
  protocol    = "HTTP"
  port        = 3000 # Your backend app's port
  vpc_id      = aws_vpc.main.id
  target_type = "instance"
}

# ALB
resource "aws_lb" "main_alb" {
  name               = "main-alb"
  internal           = false
  load_balancer_type = "application"
  security_groups    = [aws_security_group.alb_sg.id]
  subnets            = [aws_subnet.db_subnet_1.id, aws_subnet.db_subnet_2.id]

  enable_deletion_protection = false
  tags = {
    Name = "main-alb"
  }
}

# HTTPS Listener
resource "aws_lb_listener" "https_listener" {
  load_balancer_arn = aws_lb.main_alb.arn
  port              = 443
  protocol          = "HTTPS"

  ssl_policy = "ELBSecurityPolicy-2016-08"
  certificate_arn = aws_acm_certificate.ssl_cert.arn # Use your validated certificate's ARN

  default_action {
    type = "forward"
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