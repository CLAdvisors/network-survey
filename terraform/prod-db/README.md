# Production DB Replacement

This is a small Terraform root for the actual production database migration goal:
keep the existing `demo.ona.*` application stack, create a new private/TLS RDS
Postgres instance with desired settings, migrate data into it, then point the
existing prod API config at the new DB.

It intentionally does **not** create a parallel dashboard/API/survey stack.

## Current assumptions

- Existing prod/demo RDS: `terraform-2025041516063189290000000a.cb4kmcse0a7d.us-east-1.rds.amazonaws.com`
- Existing prod DB subnet group: `db-subnet-group`
- Existing prod VPC: `vpc-0a3c3c61ed4c7a097`
- Existing prod backend/API security group: `sg-05b4dc3a549e37d53`
- Replacement DB identifier: `network-survey-prod-postgres-v2`
- Replacement DB is private, encrypted, uses `default.postgres15`, and requires TLS.

## Apply

Use a local, untracked var file for the DB password:

```sh
terraform -chdir=terraform/prod-db init
terraform -chdir=terraform/prod-db plan -var-file=prod-db.local.tfvars
terraform -chdir=terraform/prod-db apply -var-file=prod-db.local.tfvars
```

`prod-db.local.tfvars` should contain:

```hcl
db_password = "..."
```

Use the same current prod DB password if you want the replacement DB to keep the
same master credential during cutover.

## Migration outline

1. Create the replacement DB.
2. From a host that can reach both DBs, run `pg_dump` from current prod.
3. Restore into `network-survey-prod-postgres-v2`.
4. Run Liquibase status/update if needed.
5. Update the existing prod API runtime config (`my-config-bucket-1xo22t/configs/.env.prod`) to point at the new DB and set DB SSL vars.
6. Restart/redeploy the prod API.
7. Validate `demo.ona.*`.
8. Keep old DB intact through rollback window.
