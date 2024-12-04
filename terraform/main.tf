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

# Upload DB config file to the S3 bucket
resource "aws_s3_object" "db_config" {
  bucket = aws_s3_bucket.config_bucket.id
  key    = "configs/liquibase.properties"
  content = templatefile("./templates/liquibase.properties.tmpl", {
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
  name = "ec2-instance-profile"
  role = aws_iam_role.ec2_role.name
}

resource "local_file" "liquibase_properties" {
  filename = "../db/liquibase.properties"
  content  = templatefile("./templates/liquibase.properties.tmpl", {
    db_host     = aws_db_instance.postgres.address
    db_port     = aws_db_instance.postgres.port
    db_name     = aws_db_instance.postgres.db_name
    db_user     = var.db_user
    db_password = var.db_password
  })
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

# Generate a unique suffix for the bucket name
resource "random_id" "bucket_id" {
  byte_length = 4
}

# Create an Origin Access Control (OAC) for CloudFront to securely access the S3 bucket
resource "aws_cloudfront_origin_access_control" "react_dashboard_oac" {
  name                              = "react-dashboard-oac"
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

  default_cache_behavior {
    allowed_methods  = ["GET", "HEAD", "OPTIONS"]
    cached_methods   = ["GET", "HEAD"]
    target_origin_id = "S3-react-app"

    forwarded_values {
      query_string = false

      cookies {
        forward = "none"
      }
    }

    viewer_protocol_policy = "redirect-to-https"
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    cloudfront_default_certificate = true
  }

  tags = {
    Name        = "ReactAppCloudFront"
    Environment = "Production"
  }
}

# Update the S3 bucket policy to allow access from the CloudFront distribution using OAC
resource "aws_s3_bucket_policy" "react_dashboard_policy" {
  bucket = aws_s3_bucket.react_dashboard.id

  policy = data.aws_iam_policy_document.react_dashboard_policy.json
}

# Generate the IAM policy document for the S3 bucket policy
data "aws_iam_policy_document" "react_dashboard_policy" {
  statement {
    effect    = "Allow"
    actions   = ["s3:GetObject"]
    resources = ["${aws_s3_bucket.react_dashboard.arn}/*"]

    principals {
      type        = "Service"
      identifiers = ["cloudfront.amazonaws.com"]
    }

    condition {
      test     = "StringEquals"
      variable = "AWS:SourceArn"
      values   = [aws_cloudfront_distribution.react_dashboard_distribution.arn]
    }
  }
}
