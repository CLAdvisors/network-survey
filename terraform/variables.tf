variable "aws_region" {
  description = "AWS region to deploy resources"
  default     = "us-east-1"
}

variable "instance_type" {
  description = "Type of instance for the backend"
  default     = "t2.micro"
}

variable "db_name" {
  description = "Name of the PostgreSQL database"
  default     = "mydatabase"
}

variable "db_user" {
  description = "Database username"
  default     = "admin"
}

variable "db_password" {
  description = "Database password"
}

variable "frontend_url" {
  description = "value of the frontend url"
  default = "https://demo.ona.dashboard.bennetts.work"
}