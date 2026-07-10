# Staging environment — apply from the *staging* workspace:
#   terraform workspace new staging   # first time only
#   terraform workspace select staging
#   terraform apply -var-file=staging.tfvars
#
# Secrets (db_password, session_secret, resend_api_key) must be supplied via
# TF_VAR_* environment variables or an untracked *.auto.tfvars — never commit them.

api_domain       = "staging.ona.api.bennetts.work"
dashboard_domain = "staging.ona.dashboard.bennetts.work"
survey_domain    = "staging.ona.survey.bennetts.work"

# The OIDC provider/role are account-global and managed by prod
manage_github_oidc = false

db_user = "ona_admin"

db_deletion_protection = false
