# Production Environment Root

This Terraform root owns the current production environment state during the
prod-v2 migration. The S3 backend key is still `prod-db/terraform.tfstate`, but
that state now tracks more than the original replacement DB: it includes the
prod-v2 replacement app stack, the protected replacement RDS instance, imported
ACM certificates, and legacy deploy-glue resources that are safe to manage here.

External DNS is still manual. Keep the ACM DNS validation CNAMEs and any app
cutover records in the external DNS provider unless a later change explicitly
moves DNS into Terraform.

## Current ownership

Prod-v2 resources intentionally remain defined inline in this root in this PR.
The shared frontend module is used first by staging only; moving active prod-v2
CloudFront/S3 resources into that module would require explicit state moves and
a reviewed no-op plan.

Tracked here:

- Replacement app stack discovered as `TF_ENV=prod-v2` by deploy tooling
  (replacement ALB/backend, app buckets, CloudFront distributions, IAM, and
  supporting security groups/subnets in the existing prod VPC).
- Replacement production RDS: `network-survey-prod-postgres-v2`, with Terraform
  `prevent_destroy` and AWS deletion protection enabled.
- Imported `demo.ona.*` ACM certificates. They are protected by state and rely on
  manual external DNS validation records.
- Legacy deploy-glue that must stay available during transition: production S3
  artifact/frontend buckets and IAM inline policies used by deploy/runtime roles.

Not fully tracked here yet:

- Legacy production ALB, EC2/backend, CloudFront distributions, and broad
  VPC/subnet/route ownership. Preserve these until the prod-v2 cutover and
  cleanup plan is complete.

## State

The backend key intentionally remains:

```text
prod-db/terraform.tfstate
```

Keeping the existing key avoided a state migration while expanding ownership
from the replacement DB to the full prod-v2 environment. A later refactor may
rename/move the key after legacy prod resources are retired.

## Current assumptions

- Existing legacy prod/demo RDS retained temporarily: `terraform-2025041516063189290000000a.cb4kmcse0a7d.us-east-1.rds.amazonaws.com`
- Current replacement production RDS: `network-survey-prod-postgres-v2`
- Replacement endpoint: `network-survey-prod-postgres-v2.cb4kmcse0a7d.us-east-1.rds.amazonaws.com`
- Existing prod DB subnet group: `db-subnet-group`
- Existing prod VPC: `vpc-0a3c3c61ed4c7a097`
- Existing prod backend/API security group: `sg-05b4dc3a549e37d53`
- Replacement DB is private, encrypted, uses `default.postgres15`, has deletion protection, and requires TLS.
- Replacement ALB deletion protection defaults to enabled.
- Existing production artifact/config bucket: `my-config-bucket-1xo22t`
- Existing production dashboard bucket: `react-dashboard-7c1f1dec`
- Existing production survey bucket: `react-survey-7c1f1dec`
- Existing production dashboard CloudFront distribution: `E1PEP245TILYDL`
- Existing production survey CloudFront distribution: `E3FANX1T8EYFZ5`
- Imported API ACM certificate: `arn:aws:acm:us-east-1:438465164125:certificate/06e30893-eec6-49c0-9097-140a19fd880b`
- Imported dashboard ACM certificate: `arn:aws:acm:us-east-1:438465164125:certificate/307b9003-ade8-4f56-b8a0-cf8a3b2aca01`
- Imported survey ACM certificate: `arn:aws:acm:us-east-1:438465164125:certificate/3b06fde6-962b-484e-bec4-cb529984299a`

## Imported ACM certificates

The production `demo.ona.*` ACM certificates are already imported into this
state. If rebuilding state from scratch, import them before applying so Terraform
does not request duplicate/pending certificates:

```sh
terraform -chdir=terraform/envs/prod import -var-file=prod-db.local.tfvars \
  aws_acm_certificate.prod_api \
  arn:aws:acm:us-east-1:438465164125:certificate/06e30893-eec6-49c0-9097-140a19fd880b
terraform -chdir=terraform/envs/prod import -var-file=prod-db.local.tfvars \
  aws_acm_certificate.prod_dashboard \
  arn:aws:acm:us-east-1:438465164125:certificate/307b9003-ade8-4f56-b8a0-cf8a3b2aca01
terraform -chdir=terraform/envs/prod import -var-file=prod-db.local.tfvars \
  aws_acm_certificate.prod_survey \
  arn:aws:acm:us-east-1:438465164125:certificate/3b06fde6-962b-484e-bec4-cb529984299a
```

The external DNS validation CNAMEs must remain in place for ACM renewal:

| Domain | CNAME name | CNAME value |
|---|---|---|
| `demo.ona.api.bennetts.work` | `_11e3f568b17ede36909ed6044eea7ea7.demo.ona.api.bennetts.work.` | `_802d02771e55f77ecd7eee320378cc28.zfyfvmchrl.acm-validations.aws.` |
| `demo.ona.dashboard.bennetts.work` | `_066e2be3dc4df9deefa1d51b7103c5b0.demo.ona.dashboard.bennetts.work.` | `_7227ea2510f9e80ad666d941dbc206dc.zfyfvmchrl.acm-validations.aws.` |
| `demo.ona.survey.bennetts.work` | `_e8e6b911771e7b3fb20f2072efd586ea.demo.ona.survey.bennetts.work.` | `_5c80e6e378a0646a091614452d6b7a6b.zfyfvmchrl.acm-validations.aws.` |

## Plan/apply

Local operators should use an untracked `prod-db.local.tfvars` containing the
current DB password:

```hcl
db_password = "..."
```

Current local commands:

```sh
terraform -chdir=terraform/envs/prod init
terraform -chdir=terraform/envs/prod plan -var-file=prod-db.local.tfvars
terraform -chdir=terraform/envs/prod apply -var-file=prod-db.local.tfvars
```

Use the same current prod DB password unless intentionally rotating the RDS
master credential. GitHub Actions does not use `prod-db.local.tfvars`; workflow
plans/applies for `environment=prod-v2` or `environment=prod` require the
`TF_VAR_DB_PASSWORD` secret and run in `terraform/envs/prod`. The old root
production workspace is intentionally blocked.

## Deploy discovery and cleanup sequence

- Keep replacement resources tagged/discovered with `TF_ENV=prod-v2` while any
  legacy `prod` app resources still exist. This avoids duplicate deploy matches.
- Do not create duplicate `Environment=prod`/`App=*` tag combinations across
  legacy and replacement app resources during the transition.
- Keep `enable_legacy_backend_db_access = true` until the legacy backend no
  longer needs access to `network-survey-prod-postgres-v2`.
- Before deleting the legacy backend security group, set
  `enable_legacy_backend_db_access = false`, plan/apply, and confirm the DB SG
  no longer references the legacy backend SG.
- After legacy prod resources are retired, optionally retag the replacement app
  discovery environment from `prod-v2` to `prod` in a planned change.

## Safety

- Do not run destructive applies. Preserve existing prod-v2 resources and DB
  data unless a final snapshot/backup and rollback path are confirmed.
- This root tracks prod DB, prod-v2 app stack, legacy S3 deploy-glue, IAM
  deploy/runtime-secret inline policies, and imported ACM certificates.
- The DB resource has Terraform `prevent_destroy` plus AWS deletion protection.
- ACM DNS validation and app DNS cutover records are managed externally/manual.
