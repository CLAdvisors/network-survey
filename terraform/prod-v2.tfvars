# Temporary production-v2 migration environment.
# This stands up a clean prod-shaped stack with temporary domains, so current
# demo/prod can remain untouched until DB migration and validation are complete.
#
# Apply from the prod-v2 workspace:
#   terraform workspace new prod-v2   # first time only
#   terraform workspace select prod-v2
#   terraform apply -var-file=prod-v2.tfvars
#
# Secrets (db_password, session_secret, resend_api_key) must be supplied via
# TF_VAR_* environment variables or an untracked *.auto.tfvars — never commit them.

api_domain       = "prod-v2.ona.api.bennetts.work"
dashboard_domain = "prod-v2.ona.dashboard.bennetts.work"
survey_domain    = "prod-v2.ona.survey.bennetts.work"

db_user = "ona_admin"

# Account-global GitHub OIDC roles are managed/bootstrapped separately.
manage_github_oidc = false

# Use prod-like deletion safety for the migration candidate.
db_deletion_protection = true
