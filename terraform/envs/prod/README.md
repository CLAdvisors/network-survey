# Production Environment Root

This Terraform root currently owns the Terraform-managed production replacement
RDS database while the broader prod app stack remains transitional/manual. It was
moved from `terraform/prod-db` into `terraform/envs/prod` as the first step away
from workspace-based prod management.

It intentionally does **not** create a parallel dashboard/API/survey stack yet.
The existing `demo.ona.*` app stack continues to run separately while prod is
inactive during the infra refactor.

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
- This root must preserve the existing `network-survey-prod-postgres-v2` data.
- Before destructive DB operations, confirm backups/final snapshots and rollback
  path.
