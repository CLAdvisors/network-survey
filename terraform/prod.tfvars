# Prod environment — apply from the *default* workspace:
#   terraform workspace select default
#   terraform apply -var-file=prod.tfvars
#
# Secrets (db_password, session_secret, resend_api_key) must be supplied via
# TF_VAR_* environment variables or an untracked *.auto.tfvars — never commit them.

api_domain       = "demo.ona.api.bennetts.work"
dashboard_domain = "demo.ona.dashboard.bennetts.work"
survey_domain    = "demo.ona.survey.bennetts.work"

# Match the existing demo/prod RDS master username when importing/adopting prod.
db_user = "DbAdmin"

# GitHub OIDC/deploy role was bootstrapped manually in AWS as:
# arn:aws:iam::438465164125:role/github-actions-deploy
# Keep false unless importing those account-global resources into Terraform state first.
manage_github_oidc = false

db_deletion_protection  = true
alb_deletion_protection = true

# Temporary refactor safety valve: demo/prod currently uses the replacement DB
# managed in terraform/prod-db. Keep root-stack API config pointed at that DB
# until prod DB ownership is folded into the primary prod Terraform root.
api_config_db_host_override = "network-survey-prod-postgres-v2.cb4kmcse0a7d.us-east-1.rds.amazonaws.com"
