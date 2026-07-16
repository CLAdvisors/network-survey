locals {
  common_tags = {
    Project     = var.project_name
    Environment = var.environment
    ManagedBy   = "terraform"
    Purpose     = "prod-db-replacement"
  }
}

resource "aws_security_group" "prod_db" {
  name        = "network-survey-prod-db-v2"
  description = "Postgres access for the replacement production database"
  vpc_id      = var.vpc_id

  dynamic "ingress" {
    for_each = var.enable_legacy_backend_db_access ? [1] : []
    content {
      description     = "Postgres from legacy prod backend security group"
      from_port       = 5432
      to_port         = 5432
      protocol        = "tcp"
      security_groups = [var.backend_security_group_id]
    }
  }

  ingress {
    description     = "Postgres from replacement prod backend security group"
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

  tags = merge(local.common_tags, {
    Name = "network-survey-prod-db-v2"
  })
}

resource "aws_db_instance" "prod_replacement" {
  identifier             = var.db_identifier
  allocated_storage      = var.allocated_storage
  engine                 = "postgres"
  engine_version         = var.engine_version
  instance_class         = var.instance_class
  db_name                = var.db_name
  username               = var.db_user
  password               = var.db_password
  publicly_accessible    = false
  vpc_security_group_ids = [aws_security_group.prod_db.id]
  db_subnet_group_name   = var.db_subnet_group_name
  parameter_group_name   = "default.postgres15"
  apply_immediately      = true

  storage_encrypted         = true
  backup_retention_period   = 7
  deletion_protection       = var.deletion_protection
  skip_final_snapshot       = false
  final_snapshot_identifier = "${var.db_identifier}-final"

  lifecycle {
    prevent_destroy = true
  }

  tags = merge(local.common_tags, {
    Name = var.db_identifier
  })
}
