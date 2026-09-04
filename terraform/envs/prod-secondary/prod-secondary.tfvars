# Account, region, environment, ASG capacity, Multi-AZ, backup retention, and
# every product activation gate are intentionally fixed in code.
vpc_cidr            = "10.20.0.0/16"
availability_zones  = ["us-east-1a", "us-east-1b"]
public_subnet_cidrs = ["10.20.0.0/24", "10.20.1.0/24"]
app_subnet_cidrs    = ["10.20.10.0/24", "10.20.11.0/24"]
db_subnet_cidrs     = ["10.20.20.0/24", "10.20.21.0/24"]

instance_type                = "t3.small"
db_instance_class            = "db.t3.micro"
db_allocated_storage         = 20
enable_public_aws_endpoints  = true
enable_custom_domain_aliases = true
enable_owner_bootstrap       = false
# Activated after the isolated sender domain, API key, disabled webhook, and
# signing secret were prepared. Database sending/claiming controls remain
# independently release-fenced.
enable_resend_credentials    = true
enable_resend_webhook_ingest = true
enable_survey_delivery_v2    = true

# Dark bootstrap posture. Do not populate these in the initial apply.
alb_allowed_ipv4_cidrs = []
alb_certificate_arn    = null
