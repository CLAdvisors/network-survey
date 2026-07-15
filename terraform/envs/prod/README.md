# Production Environment Root

This Terraform root currently owns the Terraform-managed production replacement
RDS database plus the existing production deploy-glue resources that are safe to
track independently (legacy S3 buckets, IAM inline policies, and imported ACM
certificates). It was moved
from `terraform/prod-db` into `terraform/envs/prod` as the first step away from
workspace-based prod management.

It intentionally does **not** create a parallel dashboard/API/survey stack.
The existing `demo.ona.*` app stack continues to run while prod is inactive
during the infra refactor. CloudFront distributions, ALB, EC2, and VPC resources
are still transitional/manual and should be imported or replaced in later phases.
The ACM certificates are preserved because DNS validation records are managed in
an external DNS provider.

## State

The backend key is intentionally still:

```text
prod-db/terraform.tfstate
```

Keeping the existing key avoids any state migration during this move and ensures
this root continues to manage the existing replacement DB without recreating it.
A later Terraform refactor can migrate the state key once all prod ownership is
settled.

## Current assumptions

- Existing legacy prod/demo RDS retained temporarily: `terraform-2025041516063189290000000a.cb4kmcse0a7d.us-east-1.rds.amazonaws.com`
- Current replacement production RDS: `network-survey-prod-postgres-v2`
- Replacement endpoint: `network-survey-prod-postgres-v2.cb4kmcse0a7d.us-east-1.rds.amazonaws.com`
- Existing prod DB subnet group: `db-subnet-group`
- Existing prod VPC: `vpc-0a3c3c61ed4c7a097`
- Existing prod backend/API security group: `sg-05b4dc3a549e37d53`
- Replacement DB is private, encrypted, uses `default.postgres15`, has deletion protection, and requires TLS.
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

## Apply

Use a local, untracked var file for the DB password:

```sh
terraform -chdir=terraform/envs/prod init
terraform -chdir=terraform/envs/prod plan -var-file=prod-db.local.tfvars
terraform -chdir=terraform/envs/prod apply -var-file=prod-db.local.tfvars
```

`prod-db.local.tfvars` should contain:

```hcl
db_password = "..."
```

Use the same current prod DB password unless intentionally rotating the RDS
master credential.

## Safety

- Do not run the root workspace prod apply from `terraform/` until existing prod
  app resources are imported/folded in or a replacement-prod migration is
  explicitly chosen; that workspace currently has no prod state and would create
  a new parallel stack.
- This root tracks prod DB, legacy S3 buckets, IAM deploy/runtime-secret inline
  policies, and imported ACM certificates. It does not yet track CloudFront
  distribution config, ALB, EC2, or VPC/subnets/routes.
- This root must preserve the existing `network-survey-prod-postgres-v2` data.
  The DB resource has Terraform `prevent_destroy` plus AWS deletion protection.
- Before destructive DB operations, confirm backups/final snapshots and rollback
  path.
