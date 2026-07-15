# Terraform infrastructure

Terraform is being refactored from a single workspace-based root into explicit
environment roots.

| Environment | Current root | Backend key | Notes |
|---|---|---|---|
| staging | `terraform/envs/staging` | `envs/staging/terraform.tfstate` | New standalone root added in this PR. State migration is documented only; not yet executed. |
| prod / prod-v2 | `terraform/envs/prod` | `prod-db/terraform.tfstate` | Active prod-v2 cutover stack. Preserve RDS and imported ACM certificates. |
| legacy root | `terraform/` | workspace-based (`env/staging/terraform.tfstate` for staging, `terraform.tfstate` for default) | Kept intact for rollback/state reference. Do not use it for production applies. |

## Shared modules

`terraform/modules/frontend_static_site` contains the shared private S3 +
CloudFront Origin Access Control pattern used by the new staging root. It keeps
custom-domain support optional and is parameterized to preserve the staging
resource names/attributes during the later state migration.

Prod-v2 frontend resources remain inline in `terraform/envs/prod` for now to
avoid unnecessary state moves or accidental diffs against active production.
Move prod to the module only in a later reviewed change with explicit
`terraform state mv` commands and a no-op plan.

The API/ALB/EC2/IAM pattern is intentionally not extracted yet: staging and
prod-v2 differ enough that a larger module would increase risk. Prefer a small,
validated follow-up after staging is safely under its environment root.

## Secrets

`db_password` is required because Terraform manages RDS. Provide it via GitHub
environment secret `TF_VAR_DB_PASSWORD` or locally as:

```sh
export TF_VAR_db_password=...
```

API runtime secrets are stored in SSM Parameter Store SecureString values, e.g.:

```sh
aws ssm put-parameter --type SecureString --overwrite \
  --name /network-survey/staging/db/password --value '...'
aws ssm put-parameter --type SecureString --overwrite \
  --name /network-survey/staging/api/session-secret --value '...'
aws ssm put-parameter --type SecureString --overwrite \
  --name /network-survey/staging/api/resend-api-key --value '...'
```

Use `/network-survey/prod/...` for production runtime parameters. Never commit
secret values or local `*.local.tfvars` files.

## Staging migration plan (documented only)

No state was migrated as part of this PR. The old root remains available so the
current staging state is not broken while this branch is reviewed.

When ready, migrate staging state from the old workspace key to the new explicit
key. Use remote-state backups and inspect plans before any apply:

```sh
# 1. Back up the existing staging state locally.
terraform -chdir=terraform init
terraform -chdir=terraform workspace select staging
terraform -chdir=terraform state pull > staging-workspace-pre-migration.tfstate

# 2. Initialize the new staging root against the new backend key.
terraform -chdir=terraform/envs/staging init

# 3. Push the backed-up state into the new key only after review.
#    This mutates remote state; do it in a maintenance window.
terraform -chdir=terraform/envs/staging state push ../../../staging-workspace-pre-migration.tfstate

# 4. Move frontend addresses into the module addresses so Terraform does not
#    recreate S3/CloudFront resources.
terraform -chdir=terraform/envs/staging state mv aws_s3_bucket.react_dashboard module.dashboard_frontend.aws_s3_bucket.this
terraform -chdir=terraform/envs/staging state mv aws_s3_bucket_public_access_block.react_dashboard_public_access module.dashboard_frontend.aws_s3_bucket_public_access_block.this
terraform -chdir=terraform/envs/staging state mv aws_s3_bucket_server_side_encryption_configuration.react_dashboard_encryption module.dashboard_frontend.aws_s3_bucket_server_side_encryption_configuration.this
terraform -chdir=terraform/envs/staging state mv aws_s3_bucket_versioning.react_dashboard_versioning module.dashboard_frontend.aws_s3_bucket_versioning.this
terraform -chdir=terraform/envs/staging state mv aws_s3_bucket_cors_configuration.react_dashboard_cors 'module.dashboard_frontend.aws_s3_bucket_cors_configuration.this[0]'
terraform -chdir=terraform/envs/staging state mv aws_cloudfront_origin_access_control.react_dashboard_oac module.dashboard_frontend.aws_cloudfront_origin_access_control.this
terraform -chdir=terraform/envs/staging state mv aws_cloudfront_distribution.react_dashboard_distribution module.dashboard_frontend.aws_cloudfront_distribution.this
terraform -chdir=terraform/envs/staging state mv aws_s3_bucket_policy.react_dashboard_policy module.dashboard_frontend.aws_s3_bucket_policy.this

terraform -chdir=terraform/envs/staging state mv aws_s3_bucket.react_survey module.survey_frontend.aws_s3_bucket.this
terraform -chdir=terraform/envs/staging state mv aws_s3_bucket_public_access_block.react_survey_public_access module.survey_frontend.aws_s3_bucket_public_access_block.this
terraform -chdir=terraform/envs/staging state mv aws_s3_bucket_server_side_encryption_configuration.react_survey_encryption module.survey_frontend.aws_s3_bucket_server_side_encryption_configuration.this
terraform -chdir=terraform/envs/staging state mv aws_s3_bucket_versioning.react_survey_versioning module.survey_frontend.aws_s3_bucket_versioning.this
terraform -chdir=terraform/envs/staging state mv aws_s3_bucket_cors_configuration.react_survey_cors 'module.survey_frontend.aws_s3_bucket_cors_configuration.this[0]'
terraform -chdir=terraform/envs/staging state mv aws_cloudfront_origin_access_control.react_survey_oac module.survey_frontend.aws_cloudfront_origin_access_control.this
terraform -chdir=terraform/envs/staging state mv aws_cloudfront_distribution.react_survey_distribution module.survey_frontend.aws_cloudfront_distribution.this
terraform -chdir=terraform/envs/staging state mv aws_s3_bucket_policy.react_survey_policy module.survey_frontend.aws_s3_bucket_policy.this

# 5. Plan with the real staging DB password and confirm no destructive changes.
TF_VAR_db_password=... terraform -chdir=terraform/envs/staging plan -var-file=staging.tfvars
```

If the plan is not effectively a no-op, stop and either adjust configuration or
restore from `staging-workspace-pre-migration.tfstate`.

The GitHub `Terraform Apply` workflow requires `confirm_staging_state_migrated=true`
before it will apply `staging`, because the new backend key starts empty until
these migration/import steps are completed.

## Production safety

Production is already under `terraform/envs/prod`. Preserve:

- RDS `network-survey-prod-postgres-v2` (Terraform `prevent_destroy` plus AWS
  deletion protection).
- Imported ACM certificates for `demo.ona.*` and their external DNS validation
  records.
- Legacy resources until a separate cleanup plan is approved.

Do not run `terraform apply` or destructive state operations during this refactor.
