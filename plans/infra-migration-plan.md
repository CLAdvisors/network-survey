# EC2 + SSM Infrastructure Migration Plan

## Current Status

The EC2 + SSM migration groundwork has been implemented, merged to `main`, and validated for staging. Production/demo (`demo.ona.*`) has also been cut over to a new Terraform-managed replacement RDS database while keeping the existing public app domains.

Key outcomes completed:

- Staging infrastructure created and validated.
- GitHub CI/CD added and passing.
- GitHub OIDC deploy and Terraform roles configured.
- Terraform remote state configured.
- Staging deploys automatically from `main`.
- Manual Terraform Apply workflow added and validated against staging.
- Production replacement DB created, migrated, and connected to the production API.
- Existing `demo.ona.*` dashboard/survey/API remain the production app endpoints.

## Architecture Direction

We are intentionally using **EC2 + SSM** instead of ECS for now.

Target model:

- API runs on EC2 under PM2.
- EC2 is managed through SSM Session Manager / Run Command.
- API releases are packaged by GitHub Actions and deployed through SSM.
- Frontends are built by GitHub Actions and synced to S3 + CloudFront.
- Database migrations run from the backend instance because RDS should not be publicly reachable.
- Staging and production are separated.
- Runtime secrets should eventually move out of Terraform/S3 config objects into SSM Parameter Store or Secrets Manager.

## Implemented Components

### GitHub Actions

Implemented workflows:

```text
.github/workflows/ci.yml
.github/workflows/deploy.yml
.github/workflows/terraform-plan.yml
.github/workflows/terraform-apply.yml
```

Current behavior:

- PRs run CI and Terraform Plan.
- Pushes to `main` run CI and deploy staging.
- Deploy workflow can be manually run for `staging` or `production`.
- Terraform Apply workflow is manual and supports `staging` or `production`.
- Production environment has required reviewers configured.

Latest verified checks on `main`:

- CI: passing
- Deploy to staging: passing
- Terraform Apply to staging: passing

### GitHub / AWS OIDC

Configured repository variables:

```text
AWS_DEPLOY_ROLE_ARN=arn:aws:iam::438465164125:role/github-actions-deploy
AWS_TERRAFORM_ROLE_ARN=arn:aws:iam::438465164125:role/github-actions-terraform
AWS_REGION=us-east-1
```

Created/confirmed AWS resources:

```text
OIDC provider: arn:aws:iam::438465164125:oidc-provider/token.actions.githubusercontent.com
Deploy role:   arn:aws:iam::438465164125:role/github-actions-deploy
TF role:       arn:aws:iam::438465164125:role/github-actions-terraform
```

GitHub environments:

```text
staging
production
```

Production has required reviewers configured.

### Terraform Remote State

Bootstrapped manually in AWS:

```text
S3 state bucket: network-survey-terraform-state-438465164125
DynamoDB table:  network-survey-terraform-locks
```

The current backend uses S3 state with S3 native lockfiles. The DynamoDB table exists as a compatibility fallback.

### Local AWS CLI

Local AWS CLI now uses IAM user `admin-cli`, not root, for normal operations.

## Staging Environment

Staging was created as an isolated Terraform workspace-backed environment.

### Staging Resources

```text
API:        https://staging.ona.api.bennetts.work
Dashboard:  https://staging.ona.dashboard.bennetts.work
Survey:     https://staging.ona.survey.bennetts.work
```

Terraform-created resources:

```text
API ALB DNS:          staging-main-alb-1483972898.us-east-1.elb.amazonaws.com
API instance:         i-0edf83aaa1eebee13
Artifact bucket:      ona-staging-artifacts-ztnzv6
Config bucket:        ona-staging-config-ztnzv6
Dashboard bucket:     ona-staging-dashboard-966c3626
Survey bucket:        ona-staging-survey-966c3626
Dashboard CloudFront: d3sh259vg3713j.cloudfront.net / E25BCX9GQEUQU7
Survey CloudFront:    d3cyla8o3xxdl5.cloudfront.net / EMB4Y0ICRHFCS
RDS endpoint:         terraform-20260710140507963100000001.cb4kmcse0a7d.us-east-1.rds.amazonaws.com:5432
DB username:          ona_admin
```

### Staging Validation Completed

- ACM certs validated.
- Name.com DNS configured.
- Terraform plan is clean.
- SSM instance is online.
- API artifact deploy through SSM succeeded.
- Liquibase migrations ran from the instance.
- PM2 started `ona-api` successfully.
- ALB target group is healthy.
- API health returns database ok.
- Dashboard and survey CloudFront routes return `200`.
- API register/login/check-auth smoke passed over staging domain.
- GitHub Deploy workflow successfully deploys staging from `main`.
- GitHub Terraform Apply workflow successfully ran against staging.

### Staging Secrets

Staging environment secrets are configured:

```text
TF_VAR_DB_PASSWORD
TF_VAR_SESSION_SECRET
TF_VAR_RESEND_API_KEY
```

The staging Resend key has been updated from the provided staging key.

## Production / Demo Environment

Decision: `demo.ona.*` remains production for now.

```text
API:        https://demo.ona.api.bennetts.work
Dashboard:  https://demo.ona.dashboard.bennetts.work
Survey:     https://demo.ona.survey.bennetts.work
```

Production goal changed from a full parallel `prod-v2` app stack to a **DB-only replacement**:

- Keep existing `demo.ona.*` application endpoints.
- Create a clean Terraform-managed replacement RDS database.
- Migrate production data into the new DB.
- Point production API at the new DB.
- Keep old production DB for rollback.

### Prod-v2 Cleanup Completed

The temporary full-stack prod-v2 direction was abandoned before creating app infrastructure.

Cleaned up:

- Destroyed pending prod-v2 ACM certificates.
- Removed prod-v2 workflow options.
- Removed `terraform/prod-v2.tfvars`.
- Deleted unused `prod-v2` Terraform workspace.

### Production Replacement DB

Terraform root:

```text
terraform/prod-db/
```

Created replacement DB:

```text
identifier:     network-survey-prod-postgres-v2
endpoint:       network-survey-prod-postgres-v2.cb4kmcse0a7d.us-east-1.rds.amazonaws.com:5432
database:       ONA
username:       DbAdmin
security group: sg-00d61e181de4cfb48
```

Desired settings now in place:

- `publicly_accessible = false`
- storage encryption enabled
- backup retention: 7 days
- deletion protection enabled
- parameter group: `default.postgres15`
- engine version: `15.18`
- access allowed from existing prod backend security group

### Production Data Migration Completed

Completed steps:

1. Created replacement DB with Terraform.
2. Launched temporary EC2 migration host in the existing prod VPC.
3. Installed PostgreSQL 15 client on the migration host.
4. Dumped current prod DB.
5. Restored dump into `network-survey-prod-postgres-v2`.
6. Smoke checked restored DB:

```sql
select count(*) from survey;
```

Result:

```text
9
```

7. Terminated the temporary migration EC2 instance.

### Production API Cutover Completed

Completed steps:

- Updated existing prod API runtime config:

```text
s3://my-config-bucket-1xo22t/configs/.env.prod
```

- Backup of previous config:

```text
s3://my-config-bucket-1xo22t/configs/.env.prod.pre-db-v2-20260711104125
```

- Updated config now points at:

```text
network-survey-prod-postgres-v2.cb4kmcse0a7d.us-east-1.rds.amazonaws.com
```

- Added DB SSL settings:

```text
DB_SSL=true
DB_SSL_CA=/opt/service/certs/rds-global-bundle.pem
```

- Uploaded current API artifact to production artifact/config bucket.
- Launched replacement prod API EC2 instance:

```text
i-0d6b0331e187e61a3
```

- Registered the instance with existing `backend-targets` target group.
- Deployed current API artifact to the prod API instance via SSM.
- Marked restored Liquibase changesets synchronized due to historical changeset identity differences.
- Redeployed API successfully after Liquibase sync.
- ALB target is healthy.

### Production Validation Completed

Verified:

```text
https://demo.ona.api.bennetts.work/health -> {"status":"ok","database":"ok"}
https://demo.ona.dashboard.bennetts.work/ -> 200
https://demo.ona.survey.bennetts.work    -> 200
```

User validated the production webapp and reported it looks good.

### Production Secrets

Production environment secrets are configured:

```text
TF_VAR_DB_PASSWORD
TF_VAR_SESSION_SECRET
TF_VAR_RESEND_API_KEY
```

Production Resend key was set from the provided production key.

## Rollback Notes

Old production DB remains intact for rollback.

Current old prod DB:

```text
terraform-2025041516063189290000000a.cb4kmcse0a7d.us-east-1.rds.amazonaws.com
```

Rollback would require:

1. Restore old prod API config from:

```text
s3://my-config-bucket-1xo22t/configs/.env.prod.pre-db-v2-20260711104125
```

2. Redeploy/restart production API.
3. Verify `demo.ona.*` health and app behavior.

Recommended rollback window: keep old DB for 2–4 weeks.

Estimated cost to keep old `db.t3.micro`/20GB RDS online:

```text
~$15–20/month
~$8–10 for two weeks
```

Before deleting old DB later, create a final snapshot.

## Remaining Future Work

### Near Term

1. **Browser validation**
   - dashboard login
   - existing surveys list
   - selected survey questions/respondents
   - results view
   - survey link flow
   - email send/test email

2. **Old production DB rollback window**
   - keep old DB running for 2–4 weeks
   - tag it clearly as legacy/rollback if not already tagged
   - create final snapshot before deletion
   - delete after rollback window if no issues

3. **Clean up obsolete compute/security**
   - identify any unused legacy EC2 instances
   - stop/terminate obsolete instances after validation
   - tighten old security groups, especially open SSH/API access

4. **Document production cutover runbook**
   - exact rollback command sequence
   - old/new DB endpoints
   - config backup path
   - validation checklist

### CI/CD Follow-ups

1. **Production Deploy workflow validation**
   - production deploy path is configured but should be tested carefully with approval gate
   - ensure it targets intended prod resources only

2. **Rollback workflow**
   - add a manual workflow to redeploy a selected API artifact SHA
   - optionally add frontend rollback via CloudFront/S3 versioned assets

3. **Terraform workflows**
   - keep Terraform Plan required on PRs
   - evaluate whether Terraform Apply should remain manual-only
   - consider separate deploy role vs infra apply role with tighter permissions

4. **Branch protection**
   - require CI and Terraform Plan before merging to `main`
   - require PR review for infrastructure changes

### Security / Hardening

1. **Secrets management**
   - move runtime secrets out of Terraform state and S3 `.env.prod`
   - use SSM Parameter Store SecureString or AWS Secrets Manager
   - update deploy script to fetch secrets at deploy time

2. **S3 hardening**
   - add explicit public access blocks for dashboard/survey buckets where missing
   - add bucket encryption/versioning/lifecycle rules across all buckets
   - add artifact bucket lifecycle cleanup

3. **CloudFront hardening**
   - add SPA fallback responses to `/index.html`
   - move from legacy `forwarded_values` to cache policies
   - enable compression/cache tuning

4. **ALB hardening**
   - add HTTP port 80 listener redirecting to HTTPS
   - ensure modern TLS policies everywhere
   - review health check thresholds/timeouts

5. **RDS hardening**
   - enable enhanced monitoring if desired
   - review backup windows/maintenance windows
   - verify final snapshots and retention policies
   - eventually delete old public prod DB after rollback window

6. **Network hardening**
   - move backend EC2 to private subnet later if desired
   - use VPC endpoints/NAT strategy if private backend needs outbound access
   - remove broad SSH access from legacy security groups
   - use SSM Session Manager only

### Terraform Refactor

Current Terraform still uses a transitional structure. Longer term:

```text
terraform/
  modules/
    network/
    database/
    backend_ec2/
    frontend_static/
    github_oidc/
  envs/
    staging/
    prod/
    dev/
```

Benefits:

- cleaner environment boundaries
- safer state isolation
- easier review
- less workspace foot-gun risk
- simpler GitHub Actions targeting

### Optional Dev Environment

Still open:

- whether to create a separate `dev` environment
- whether dev should be always-on or lower-cost/on-demand
- whether dev shares non-prod DB infra or gets fully isolated resources
