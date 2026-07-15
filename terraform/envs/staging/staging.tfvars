# Staging environment. Apply from terraform/envs/staging after the documented
# remote-state migration/import steps in ../../README.md.
#
# db_password must be supplied via TF_VAR_db_password or an explicit untracked
# *.local.tfvars. API runtime secrets are read from SSM Parameter Store.

api_domain       = "staging.ona.api.bennetts.work"
dashboard_domain = "staging.ona.dashboard.bennetts.work"
survey_domain    = "staging.ona.survey.bennetts.work"

# The OIDC provider/role are account-global and managed outside staging.
manage_github_oidc = false

db_user = "ona_admin"

db_deletion_protection = false
