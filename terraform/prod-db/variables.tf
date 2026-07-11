variable "aws_region" {
  description = "AWS region"
  default     = "us-east-1"
}

variable "project_name" {
  description = "Project tag value"
  default     = "network-survey"
}

variable "environment" {
  description = "Environment tag value"
  default     = "prod"
}

variable "vpc_id" {
  description = "Existing prod VPC id containing the current demo/prod database subnet group"
  default     = "vpc-0a3c3c61ed4c7a097"
}

variable "backend_security_group_id" {
  description = "Security group used by the prod API/backend; new DB allows Postgres from this SG"
  default     = "sg-05b4dc3a549e37d53"
}

variable "db_subnet_group_name" {
  description = "Existing DB subnet group for prod"
  default     = "db-subnet-group"
}

variable "db_identifier" {
  description = "Identifier for the replacement prod RDS instance"
  default     = "network-survey-prod-postgres-v2"
}

variable "db_name" {
  description = "Initial database name"
  default     = "ONA"
}

variable "db_user" {
  description = "Master username for the replacement DB"
  default     = "DbAdmin"
}

variable "db_password" {
  description = "Master password for the replacement DB"
  sensitive   = true
}

variable "allocated_storage" {
  description = "Allocated storage in GB"
  default     = 20
}

variable "instance_class" {
  description = "RDS instance class"
  default     = "db.t3.micro"
}

variable "engine_version" {
  description = "Postgres engine version"
  default     = "15.18"
}

variable "deletion_protection" {
  description = "Enable deletion protection"
  type        = bool
  default     = true
}
