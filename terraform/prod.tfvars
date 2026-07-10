# Prod environment — apply from the *default* workspace:
#   terraform workspace select default
#   terraform apply -var-file=prod.tfvars
#
# Secrets (db_password, session_secret, resend_api_key) must be supplied via
# TF_VAR_* environment variables or an untracked *.auto.tfvars — never commit them.

api_domain       = "demo.ona.api.bennetts.work"
dashboard_domain = "demo.ona.dashboard.bennetts.work"
survey_domain    = "demo.ona.survey.bennetts.work"

# Prod owns the account-global GitHub OIDC provider + deploy role
manage_github_oidc = true

db_deletion_protection = true
