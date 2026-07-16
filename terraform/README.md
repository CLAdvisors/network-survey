# Terraform infrastructure

Terraform now uses explicit environment roots for the active staging and
production stacks.

| Environment | Current root | Backend key | Notes |
|---|---|---|---|
| staging | `terraform/envs/staging` | `envs/staging/terraform.tfstate` | Active staging stack. Migrated from the old workspace root. |
| prod | `terraform/envs/prod` | `envs/prod/terraform.tfstate` | Active production stack. Migrated from the old `prod-db/terraform.tfstate` key. |
| legacy root | `terraform/` | workspace-based / default | Kept only for history/rollback reference. Do not use for active staging or production applies. |

## Shared modules

`terraform/modules/frontend_static_site` contains the shared private S3 +
CloudFront Origin Access Control pattern used by both staging and production
frontend distributions.

The API/ALB/EC2/IAM pattern is not yet extracted into an active module because
staging and production still differ in DB ownership, naming history, and rollout
requirements. `terraform/modules/api_backend/README.md` documents the candidate
module boundary for a future low-risk extraction.

## Secrets

`db_password` is required because Terraform manages RDS. Provide it via GitHub
environment secret `TF_VAR_DB_PASSWORD` or locally as:

```sh
export TF_VAR_db_password=...
```

API runtime secrets are stored in SSM Parameter Store SecureString values, e.g.:

```sh
/network-survey/staging/db/password
/network-survey/staging/api/session-secret
/network-survey/staging/api/resend-api-key
/network-survey/prod/db/password
/network-survey/prod/api/session-secret
/network-survey/prod/api/resend-api-key
```

Never commit secret values or local `*.local.tfvars` files.

## Current apply commands

```sh
terraform -chdir=terraform/envs/staging plan -var-file=staging.tfvars
terraform -chdir=terraform/envs/prod plan
```

GitHub `Terraform Plan` / `Terraform Apply` workflows now target these env roots.
Production deploy discovery uses `Environment=prod`; no production `TF_ENV`
override is required.

## Production safety

Preserve:

- RDS `network-survey-prod-postgres-v2` (Terraform `prevent_destroy` plus AWS
  deletion protection).
- Imported ACM certificates for `demo.ona.*` and their external DNS validation
  records.
- External app DNS and ACM validation records, which remain manual/outside AWS.

Legacy prod app resources were retired after prod cutover. The old prod DB was
deleted only after creating a final snapshot; the old `prod-db/terraform.tfstate`
object was archived under `archive/prod-db/` and removed from the active key.
