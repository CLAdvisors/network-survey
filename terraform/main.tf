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
  name       = "my-db-subnet-group"
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

# Create an EC2 instance
resource "aws_instance" "backend" {
  ami           = "ami-0dba2cb6798deb6d8" # Ubuntu Server 22.04 LTS AMI (replace with your region's AMI ID)
  instance_type = var.instance_type
  subnet_id     = aws_subnet.db_subnet_1.id
  vpc_security_group_ids = [aws_security_group.backend_sg.id] # Use ID instead of name
  associate_public_ip_address = true
  key_name                    = "api-instance-key" # Specify the key pair name

  user_data = file("cloud-init.sh") # Pass the script here

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