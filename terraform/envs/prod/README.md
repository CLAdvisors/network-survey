# Production Environment Root

This Terraform root currently owns the Terraform-managed production replacement
RDS database plus the existing production deploy-glue resources that are safe to
track independently (legacy S3 buckets and IAM inline policies). It was moved
from `terraform/prod-db` into `terraform/envs/prod` as the first step away from
workspace-based prod management.

It intentionally does **not** create a parallel dashboard/API/survey stack.
The existing `demo.ona.*` app stack continues to run while prod is inactive
during the infra refactor. CloudFront distributions, ALB, EC2, and VPC resources
are still transitional/manual and should be imported or replaced in later phases.

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
- This root tracks prod DB, legacy S3 buckets, and IAM deploy/runtime-secret
  inline policies. It does not yet track CloudFront distribution config, ALB,
  EC2, VPC/subnets/routes, or ACM certificates.
- This root must preserve the existing `network-survey-prod-postgres-v2` data.
- Before destructive DB operations, confirm backups/final snapshots and rollback
  path.
