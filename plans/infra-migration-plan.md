# EC2 + SSM Infrastructure Migration Plan

## Status

Created working branch:

```text
infra/ec2-ssm-migration
```

Pulled the useful uncommitted work from:

```text
.claude/worktrees/compassionate-cannon-331abf
```

That worktree is now materialized on this branch as a real set of files/changes so it can be reviewed, refactored, committed, and iterated normally.

## Direction

We are intentionally choosing the **EC2 + SSM** path instead of ECS for now.

The target is:

- keep a simple EC2 backend server/runtime
- remove app deployment from cloud-init
- deploy API releases from GitHub Actions through SSM Run Command
- publish frontend builds from GitHub Actions to S3/CloudFront
- run database migrations during deploy from the backend instance, because RDS should not be publicly reachable
- create proper staging/prod separation first, then add dev once the pattern is stable

## Current Branch Contents Pulled From Prototype

### GitHub Actions

```text
.github/workflows/ci.yml
.github/workflows/deploy.yml
```

### Deploy Scripts

```text
scripts/ci/api-smoke.sh
scripts/deploy/remote-deploy.sh
```

### Terraform Additions

```text
terraform/github-oidc.tf
terraform/locals.tf
terraform/prod.tfvars
terraform/staging.tfvars
terraform/README.md
```

### Main Terraform/API Changes

- Adds environment-aware names/tags through Terraform locals.
- Adds staging/prod tfvars.
- Adds GitHub OIDC deploy role support.
- Adds S3 artifact bucket for API release tarballs.
- Adds SSM permissions to the backend EC2 role.
- Changes cloud-init to install runtime prerequisites only.
- Removes Terraform-managed frontend build uploads.
- Makes frontend publish happen from GitHub Actions.
- Makes RDS private to the backend security group.
- Restricts backend EC2 port 3000 to ALB security group only.
- Adds DB SSL support to the API.
- Removes local generated Liquibase scripts.
- Adds on-instance Liquibase migration during deploy.

## Final Target Architecture

### Runtime

```text
GitHub Actions
  ├─ build API artifact
  ├─ upload artifact to S3 artifacts bucket
  ├─ send SSM command to tagged EC2 backend instance
  │    └─ instance downloads artifact, installs deps, runs Liquibase, restarts PM2
  ├─ build dashboard
  ├─ sync dashboard/build to dashboard S3 bucket
  ├─ invalidate dashboard CloudFront
  ├─ build survey app
  ├─ sync network-survey/build to survey S3 bucket
  └─ invalidate survey CloudFront
```

### Backend EC2

- Provisioned by Terraform.
- Managed through SSM Session Manager and SSM Run Command.
- No public SSH by default.
- Runs API under PM2 for now.
- Pulls release artifacts from S3.
- Runs Liquibase migrations locally inside the VPC.
- Reads runtime configuration from a secure source.

### Database

- RDS Postgres 15 (`15.18` in us-east-1 as of staging rollout).
- Staging uses DB master username `ona_admin` because `admin` is reserved by the Postgres engine for new RDS creation.
- Not publicly accessible.
- Security group allows Postgres only from backend EC2 security group.
- TLS required.
- Production deletion protection enabled.
- Backups/snapshots/lifecycle hardened before final production cutover.

### Frontends

- Terraform creates buckets, bucket policies, OACs, and CloudFront distributions.
- GitHub Actions builds and publishes static assets.
- Terraform does not upload app build files.

## Environment Strategy

### Immediate Practical Step

The imported prototype uses Terraform workspaces:

| Workspace | Environment |
|---|---|
| `default` | prod/current demo stack |
| `staging` | staging |

This is useful as a migration bridge because it tries to preserve current prod resource names.

### Preferred Final Shape

After the SSM deployment flow is stabilized, refactor Terraform into explicit environment directories:

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
      main.tf
      backend.tf
      terraform.tfvars
    prod/
      main.tf
      backend.tf
      terraform.tfvars
    dev/
      main.tf
      backend.tf
      terraform.tfvars
```

Why this is preferred:

- safer state separation
- clearer review boundaries
- fewer accidental workspace mistakes
- easier GitHub Actions targeting
- easier per-env IAM and secrets policies

## Secrets Plan

The prototype improved secrets by removing hardcoded values from the template, but it still renders secrets into an S3 `.env.prod` object through Terraform. That means secrets can still appear in Terraform state.

### Final Recommendation

Move runtime secrets to **AWS SSM Parameter Store SecureString** or **AWS Secrets Manager**.

Suggested parameters/secrets per environment:

```text
/network-survey/staging/db/password
/network-survey/staging/session-secret
/network-survey/staging/resend-api-key
/network-survey/prod/db/password
/network-survey/prod/session-secret
/network-survey/prod/resend-api-key
```

Runtime config can be split:

- non-secret config from Terraform/SSM plain strings
- secret values from SSM SecureString/Secrets Manager

The deploy script can materialize `/opt/service/current/api/.env.prod` on the instance at deploy time, or the Node app can be changed to read directly from environment variables injected by a systemd/PM2 ecosystem file.

### Transitional Acceptable State

For the first staging implementation, S3-rendered `.env.prod` can be tolerated if:

- bucket is private
- access is tightly scoped
- secrets are not committed
- Terraform state is remote, encrypted, and access-controlled

But this should not be the final prod posture.

## AWS Account Bootstrap

Performed manually from the root-authenticated AWS CLI session, then switched local CLI default to `admin-cli`:

- Confirmed existing IAM admin user: `admin-cli`.
- Created/ensured IAM group: `Administrators`.
- Attached `AdministratorAccess` to `Administrators`.
- Added `admin-cli` to `Administrators`.
- Created GitHub OIDC provider:
  `arn:aws:iam::438465164125:oidc-provider/token.actions.githubusercontent.com`.
- Created GitHub deploy role:
  `arn:aws:iam::438465164125:role/github-actions-deploy`.
- Attached inline deployment policy matching the current EC2 + SSM deploy workflow.

Important: because these account-global GitHub OIDC resources were bootstrapped manually, `terraform/prod.tfvars` currently keeps `manage_github_oidc = false`. If we want Terraform to own them later, import the provider, role, and inline policy into Terraform state before enabling that flag.

### Terraform Remote State Bootstrap

Bootstrapped manually in AWS:

- S3 state bucket: `network-survey-terraform-state-438465164125`
- DynamoDB lock table: `network-survey-terraform-locks` (created as a compatibility fallback; current backend uses S3 native lockfiles)

The state bucket has versioning, SSE-S3 encryption, public access blocks, and S3 native lockfiles enabled. Terraform is configured in `terraform/backend.tf` with workspace-aware S3 state paths:

- default workspace: `terraform.tfstate`
- non-default workspaces: `env/<workspace>/terraform.tfstate`

## CI/CD Plan

### CI/CD Execution Status

Opened PR for the migration branch:

- https://github.com/CLAdvisors/network-survey/pull/1

GitHub Actions are now running on PR #1.

Current PR checks passing:

- API integration smoke test
- Dashboard build/test
- Survey build/test
- Terraform Plan

Fixes made while enabling CI/CD:

- moved Terraform fmt before generated `ci.auto.tfvars`
- granted the GitHub deploy role read access to Terraform remote state
- granted read-only discovery permissions needed by Terraform plan
- granted `rds:ListTagsForResource` for RDS subnet group refresh

The Deploy workflow cannot be triggered with `workflow_dispatch` until it exists on the repository default branch. The same deploy flow was validated manually against staging from this branch. After merge, manually run Deploy with `environment=staging` to validate the GitHub-hosted deploy path end-to-end.

### CI Workflow

Existing imported workflow:

```text
.github/workflows/ci.yml
```

Current behavior:

- starts Postgres service container
- runs Liquibase migrations
- installs API dependencies
- runs API smoke test
- builds dashboard
- builds survey app

Recommended additions:

- Terraform fmt/validate
- maybe `npm audit --audit-level=high` later, once dependency baseline is known
- separate frontend lint cleanup later; currently CRA warnings require `CI=false`

### GitHub Repository Configuration

Configured repository variables:

- `AWS_DEPLOY_ROLE_ARN=arn:aws:iam::438465164125:role/github-actions-deploy`
- `AWS_REGION=us-east-1`

Configured repository secrets for current staging Terraform planning/deploy bootstrap:

- `TF_VAR_DB_PASSWORD`
- `TF_VAR_SESSION_SECRET`
- `TF_VAR_RESEND_API_KEY` (currently staging placeholder unless replaced with a real Resend key)

Attempted to create GitHub Environments `staging` and `production`, but the authenticated GitHub user only has `WRITE` permission, not repository admin permission. Environment creation/protection returned `403`. A repo admin still needs to:

- create `staging`
- create `production`
- add required reviewers to `production`
- preferably move environment-specific Terraform secrets from repo-level secrets into environment-level secrets before production planning/apply workflows are enabled

### Deploy Workflow

Existing imported workflow:

```text
.github/workflows/deploy.yml
```

Current behavior:

- push to `main` deploys staging
- manual workflow dispatch deploys staging or production
- uses GitHub OIDC to assume AWS role
- resolves buckets/distributions/instance by tags
- packages API release
- uploads artifact to S3
- deploys API via SSM Run Command
- builds and publishes frontends

Recommended refactors:

- replace hardcoded hostnames in shell with GitHub Environment variables or Terraform outputs
- split staging and production deploy configuration more explicitly
- add a rollback workflow that redeploys a selected artifact SHA
- add concurrency per environment
- gate production through GitHub Environments reviewers

### Terraform Workflow

Still needed:

```text
.github/workflows/terraform-plan.yml
.github/workflows/terraform-apply.yml
```

Recommended behavior:

- PRs: run fmt/validate/plan
- main: allow staging apply
- production: manual approval using GitHub Environments
- use OIDC, not static AWS keys
- use remote state backend before CI applies are enabled

## Hardening Tasks

### Already Partially Addressed In Imported Prototype

- API port no longer public; only ALB can reach it.
- RDS no longer public.
- RDS SG only allows backend SG.
- SSH disabled by default.
- SSM instance management added.
- CloudFront viewer protocol changed to HTTPS redirect.
- ALB target group health check added.
- Modern-ish TLS policy added for ALB.

### Still Needed

- Add HTTP port 80 ALB listener that redirects to HTTPS.
- Add S3 public access blocks for dashboard/survey buckets.
- Add S3 bucket encryption and versioning for all buckets.
- Add artifact bucket lifecycle cleanup.
- Add CloudFront SPA fallback error responses to `/index.html`.
- Add CloudFront compression/cache policies instead of legacy `forwarded_values`.
- Add Route53-managed DNS records and ACM validation if DNS is in AWS.
- Tighten GitHub deploy IAM policy.
- Add rollback workflow.
- Add remote Terraform state.
- Move secrets out of Terraform state.
- Add RDS backup retention, storage encryption, monitoring, and deletion protection per environment.
- Decide whether backend EC2 should move to private subnet later.

## Migration/Cutover Plan

### Phase 1: Branch Stabilization

- Review imported prototype changes.
- Run format/validation locally where possible.
- Fix obvious Terraform syntax/style issues.
- Keep plan file updated as decisions are made.

### Phase 2: Staging First

Status: infrastructure is standing up successfully.

Created staging resources:

- API ALB DNS: `staging-main-alb-1483972898.us-east-1.elb.amazonaws.com`
- API instance: `i-0edf83aaa1eebee13`
- Artifact bucket: `ona-staging-artifacts-ztnzv6`
- Config bucket: `ona-staging-config-ztnzv6`
- Dashboard bucket: `ona-staging-dashboard-966c3626`
- Survey bucket: `ona-staging-survey-966c3626`
- Dashboard CloudFront: `d3sh259vg3713j.cloudfront.net` / `E25BCX9GQEUQU7`
- Survey CloudFront: `d3cyla8o3xxdl5.cloudfront.net` / `EMB4Y0ICRHFCS`
- RDS endpoint: `terraform-20260710140507963100000001.cb4kmcse0a7d.us-east-1.rds.amazonaws.com:5432`
- DB username: `ona_admin`

Validated:

- Terraform staging plan is clean.
- SSM instance is online.
- API artifact deploy through SSM succeeded.
- Liquibase migrations ran from the instance.
- PM2 started `ona-api` successfully.
- ALB target group is healthy.
- API health works with staging host/SNI: `/health` returns database ok.
- Dashboard and survey builds were synced to S3.
- CloudFront distributions return `200` for both frontend roots.

Remaining staging DNS records to add at Name.com:

- `staging.ona.api.bennetts.work` CNAME -> `staging-main-alb-1483972898.us-east-1.elb.amazonaws.com`
- `staging.ona.dashboard.bennetts.work` CNAME -> `d3sh259vg3713j.cloudfront.net`
- `staging.ona.survey.bennetts.work` CNAME -> `d3cyla8o3xxdl5.cloudfront.net`

DNS is live and responding:

- `https://staging.ona.api.bennetts.work/health` returns database ok.
- `https://staging.ona.dashboard.bennetts.work/` returns `200`.
- `https://staging.ona.survey.bennetts.work/` returns `200`.
- API register/login/check-auth smoke passed over the staging domain.

Still validate manually:

  - dashboard browser login/session behavior
  - email config behavior
  - survey submission

### Phase 3: CI/CD Hardening

- Add Terraform plan workflow.
- Configure GitHub OIDC.
- Configure GitHub Environments:
  - `staging`
  - `production`
- Add production approval gate.
- Add rollback workflow.

### Phase 4: Production Migration

Before first prod apply:

- rotate leaked Resend API key from historical `env.tmpl`
- decide whether `demo.ona.*` is real prod or demo/staging
- ensure remote encrypted Terraform state exists
- back up current RDS
- decide whether to recreate EC2 or bootstrap it manually with SSM
- remove old Terraform-managed frontend objects from state to avoid unwanted deletes, or schedule immediate deploy after apply
- verify SSM session access
- verify DNS/cert validation path

Then:

1. apply infra changes during maintenance window
2. run deploy workflow to publish API/frontends
3. verify health checks and login
4. verify survey link flow
5. verify email sending
6. lock down any temporary access

### Phase 5: Terraform Structure Refactor

Once staging/prod are stable:

- extract modules
- move from workspaces to env directories if still desired
- add dev environment
- remove legacy naming exceptions where possible

## Open Decisions

- Is `demo.ona.*` production, staging, or demo?
- Desired domains for dev/staging/prod?
- Should dev exist now or after staging/prod are stable?
- Do we manage DNS in Route53 or externally?
- Parameter Store or Secrets Manager for final secret storage?
- Keep PM2 or move to systemd service for API process management?
- Keep backend EC2 public with locked-down SG, or move to private subnet later?
