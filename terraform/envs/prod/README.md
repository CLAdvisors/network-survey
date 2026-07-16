# Production Environment Root

This Terraform root owns the active production stack.

Backend key:

```text
envs/prod/terraform.tfstate
```

The old `prod-db/terraform.tfstate` object was archived under
`archive/prod-db/` after migration.

External DNS remains manual. Keep the ACM validation CNAMEs and app CNAMEs in
the external DNS provider unless a future change explicitly moves DNS into
Terraform.

## Current ownership

Tracked here:

- Production app stack discovered as `Environment=prod` by deploy tooling:
  ALB/listeners/target group, backend EC2/IAM, app S3 buckets, CloudFront
  distributions/OACs, security groups, and public subnets/routes in the existing
  prod VPC.
- Replacement production RDS: `network-survey-prod-postgres-v2`, with Terraform
  `prevent_destroy` and AWS deletion protection enabled.
- Imported `demo.ona.*` ACM certificates. They rely on manual external DNS
  validation records.

Retired legacy prod app resources are no longer tracked in this root.

## Shared frontend module

Dashboard and survey frontend S3/CloudFront/OAC resources are expressed through:

```text
terraform/modules/frontend_static_site
```

The state address moves from the old inline resources have already been
completed.

## Imported ACM certificates

The production `demo.ona.*` ACM certificates are imported into this state. If
rebuilding state from scratch, import them before applying:

```sh
terraform -chdir=terraform/envs/prod import \
  aws_acm_certificate.prod_api \
  arn:aws:acm:us-east-1:438465164125:certificate/06e30893-eec6-49c0-9097-140a19fd880b
terraform -chdir=terraform/envs/prod import \
  aws_acm_certificate.prod_dashboard \
  arn:aws:acm:us-east-1:438465164125:certificate/307b9003-ade8-4f56-b8a0-cf8a3b2aca01
terraform -chdir=terraform/envs/prod import \
  aws_acm_certificate.prod_survey \
  arn:aws:acm:us-east-1:438465164125:certificate/3b06fde6-962b-484e-bec4-cb529984299a
```

ACM validation CNAMEs that must remain in external DNS:

| Domain | CNAME name | CNAME value |
|---|---|---|
| `demo.ona.api.bennetts.work` | `_11e3f568b17ede36909ed6044eea7ea7.demo.ona.api.bennetts.work.` | `_802d02771e55f77ecd7eee320378cc28.zfyfvmchrl.acm-validations.aws.` |
| `demo.ona.dashboard.bennetts.work` | `_066e2be3dc4df9deefa1d51b7103c5b0.demo.ona.dashboard.bennetts.work.` | `_7227ea2510f9e80ad666d941dbc206dc.zfyfvmchrl.acm-validations.aws.` |
| `demo.ona.survey.bennetts.work` | `_e8e6b911771e7b3fb20f2072efd586ea.demo.ona.survey.bennetts.work.` | `_5c80e6e378a0646a091614452d6b7a6b.zfyfvmchrl.acm-validations.aws.` |

## Plan/apply

Local commands:

```sh
export TF_VAR_db_password=...
terraform -chdir=terraform/envs/prod init
terraform -chdir=terraform/envs/prod plan
terraform -chdir=terraform/envs/prod apply
```

GitHub Actions uses environment secret `TF_VAR_DB_PASSWORD`. The old root
production workspace is intentionally blocked.

## Deployment

Production deploy discovery now uses the normalized tag:

```text
Environment=prod
```

No GitHub production `TF_ENV` override is required.

## Safety

- Preserve `network-survey-prod-postgres-v2`; it has Terraform
  `prevent_destroy` plus AWS deletion protection.
- Preserve imported ACM certificates and external validation DNS records.
- Do not run destructive DB operations without a final snapshot and rollback
  path.
