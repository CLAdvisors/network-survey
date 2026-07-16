# Infrastructure Cleanup and Production Hardening Plan

## Goal

Move `network-survey` from the current transitional EC2 + SSM setup to a production-ready, auditable, low-foot-gun infrastructure posture while keeping the existing app architecture unless/until a deliberate platform migration is chosen.

Current operating assumption: the hosted production/demo app is inactive during this refactor and users have been told it is not active. We can tolerate app endpoint disruption while iterating, but must protect the production database data for testing/validation and rollback confidence. The production DB is backed up; still avoid destructive DB operations unless a final snapshot/backup and rollback path are confirmed.

Target qualities:

- clear source of truth for each environment
- isolated Terraform state per environment
- secrets outside Terraform state and S3 env files
- private-by-default networking
- least-privilege IAM for CI/CD and instances
- encrypted, versioned, observable storage and compute
- repeatable deploys and rollback
- documented runbooks for normal and emergency operations

## Investigation Summary

Reviewed:

- `terraform/` root stack
- `terraform/envs/prod/` production DB root (moved from `terraform/prod-db/`)
- `.github/workflows/*`
- `scripts/deploy/remote-deploy.sh`
- `terraform/cloud-init-template.sh`
- project infra docs in `terraform/README.md` and `plans/infra-migration-plan.md`
- API startup/session/CORS configuration relevant to infra behavior

## Current Architecture Snapshot

- Staging is a Terraform workspace-backed full stack:
  - EC2 API instance behind ALB
  - RDS Postgres 15
  - S3 + CloudFront dashboard and survey apps
  - S3 config bucket and S3 artifact bucket
  - Deploy via GitHub Actions -> S3 artifact -> SSM Run Command -> PM2 reload
- Production/demo currently has transitional state:
  - public `demo.ona.*` endpoints remain production
  - replacement production RDS and deploy-glue buckets/IAM policies are managed by `terraform/envs/prod/` using the existing `prod-db/terraform.tfstate` backend key
  - CloudFront distributions, ALB, EC2, and VPC/subnets/routes remain transitional/manual and should be imported or replaced in later phases; ACM certificates are imported and preserved
- Runtime secrets currently flow through GitHub environment secrets into Terraform variables, then into Terraform state and S3 `.env.prod` objects.

## Current Status After PR #2

Completed baseline items:

- Added repo memory documenting inactive-production/refactor mode and DB data preservation priority.
- Added a production API config DB host override pointing at the replacement production DB while DB ownership is split.
- Added baseline S3 hardening for managed buckets: public access blocks where needed, encryption, versioning, and artifact noncurrent-version lifecycle.
- Added CloudFront compression and SPA fallback responses with zero error-cache TTL.
- Added ALB HTTP -> HTTPS redirect and configurable ALB deletion protection, enabled for prod tfvars.
- Removed SSH from new-instance cloud-init UFW defaults.
- Added external deploy smoke checks for API/dashboard/survey and built JS assets.
- Added the manual `Redeploy API Artifact` workflow for previous artifact SHA redeploys.
- Serialized deploy and previous-artifact redeploy workflows with a shared per-environment concurrency group.
- Made deploy/redeploy resource resolution fail unless exactly one tagged resource is found.

Additional status after PR #3:

- SSM SecureString parameters were created/updated for staging and prod under `/network-survey/{staging,prod}/...`.
- Staging Terraform apply completed successfully for the SSM runtime secret path and baseline hardening changes.
- Staging deploy was rerun successfully after apply, and API/dashboard/survey smoke checks passed.
- Production root `terraform/envs/prod` now owns the replacement production DB configuration, moved from `terraform/prod-db` while preserving the existing backend key and state. A prod DB apply completed with 0 changes, and the replacement DB still reports 9 surveys.
- Production deploy-glue resources that are safe to track independently are now in `terraform/envs/prod`: legacy config/artifacts bucket, dashboard/survey buckets, relevant S3 hardening resources, IAM inline policies for prod deploy/runtime SSM secret access, and imported ACM certificates with `prevent_destroy`. A prod env plan is clean after apply.
- Production deploy from GitHub Actions was run successfully against `main`; prod API/dashboard/survey smoke checks pass, and the replacement DB still reports 9 surveys.
- The old root `terraform/` `default` workspace currently has no state, and a prod plan there would create a new 60-resource stack rather than update the existing transitional prod app. Do not run root prod apply until existing prod app resources are imported/folded in or a replacement-prod migration is explicitly chosen.
- Old non-current release directories were removed from the staging and current prod API instances via SSM to reduce legacy `.env.prod` secret copies. Current releases still contain resolved runtime secrets because the Node API consumes an env file.
- `Redeploy API Artifact` was validated successfully in staging against the current main artifact.

Important caveats that remain:

- The DB host override is temporary and should be removed only after production DB ownership is folded into the primary prod Terraform root or explicitly kept separate by design.
- `Redeploy API Artifact` is not a database/schema/runtime-config/frontend rollback.
- Cloud-init SSH changes only affect new instances; existing instances need an SSM remediation step if UFW still allows SSH.
- Production is inactive for users, but production DB data remains valuable and must be protected.

## Issues and Edges Found

### 1. Terraform structure and state ownership

- The root `terraform/` stack uses workspaces for prod/staging. Workspaces make it easy to apply the wrong `*.tfvars` to the wrong workspace.
- Production is split between root `terraform/` and `terraform/envs/prod`; `terraform/envs/prod` manages the replacement DB, ACM certificates, and deploy-glue buckets/IAM, while remaining app/network ownership is still transitional/manual.
- It is not obvious which stack is the authoritative production source of truth for API/ALB/CloudFront/buckets versus only the replacement DB.
- `terraform/envs/prod/` may contain local-only operational artifacts in the working tree (`*.local.tfvars`, `*.tfplan`). They are ignored, but local secret material should still be kept out of shared logs and cleaned up when possible.
- Root `terraform/.terraform.lock.hcl` is ignored, while `terraform/envs/prod/.terraform.lock.hcl` is tracked. Provider lockfile policy is inconsistent.
- Terraform required version says `>= 1.4.0`, while workflows use `1.12.2`. This leaves local versions looser than CI.
- Some resources preserve legacy names in prod, increasing cognitive load and migration risk.

### 2. Secrets management

- Runtime API secrets are being moved to SSM Parameter Store SecureString.
- Terraform still needs `db_password` while it manages RDS, so the RDS master password can still appear in Terraform state until DB ownership/password management is refactored further.
- Runtime config is rendered into S3 as `configs/.env.prod`; after the SSM migration, this file should contain only non-secret config and SSM parameter names.
- Deploy-time scripts copy `.env.prod` to instance release directories, so old release directories may still contain historical secret values until cleaned.
- Local ignored tfvars files exist and contain secret material. They should be treated as sensitive local artifacts and not shared.
- Historical docs mention a previously committed Resend key; any related key should remain rotated and audited.
- DB passwords are consumed directly by Liquibase command-line flags, which can appear in process listings during deploy.

### 3. Networking and compute placement

- Backend EC2 instances are in public subnets with public IPs.
- Subnets are named `db_subnet_*` but are associated with an Internet Gateway route table; this is misleading and not private DB subnet design.
- RDS is not publicly accessible, but the subnets themselves are public-routed.
- Backend egress is `0.0.0.0/0`.
- Security group egress is wide open for backend, DB, and ALB.
- SSH is disabled by default, but cloud-init still enables UFW allow rules for SSH and API port. Security groups are the real boundary, but host firewall rules should align with the no-SSH posture.
- There are no VPC endpoints for SSM/S3/CloudWatch; moving EC2 private would currently require NAT or endpoints.

### 4. ALB/API edge hardening

- ALB only has an HTTPS listener. There is no explicit port 80 redirect listener.
- ALB deletion protection is disabled.
- No ALB access logs are configured.
- No WAF/rate limiting exists at ALB or CloudFront.
- Health check is simple `/health`; good for baseline, but no deployment-level smoke check is tied to ALB target health after SSM deploy beyond localhost check.
- API runs directly on port 3000 behind ALB; no process supervisor config file is versioned beyond PM2 commands.

### 5. CloudFront/S3 frontend hardening

- CloudFront distributions still use legacy `forwarded_values` instead of managed cache/origin request policies.
- No custom error responses are configured for SPA fallback to `/index.html`.
- Compression/cache policy tuning is limited.
- S3 dashboard/survey buckets do not have explicit public access block resources in the current root stack.
- S3 dashboard/survey buckets do not have versioning/encryption/lifecycle rules defined.
- Artifact bucket has versioning, but no lifecycle cleanup.
- Config bucket has public access block but no versioning/encryption/lifecycle explicitly defined.
- No CloudFront access logs or standard logs are configured.

### 6. RDS hardening and operations

- Root stack RDS does not explicitly enable storage encryption.
- Staging has `db_deletion_protection = false`, which is acceptable for disposable staging but should be an explicit policy decision.
- Production DB replacement enables encryption, backups, and deletion protection, but it is separate from the main stack.
- No enhanced monitoring or Performance Insights are configured.
- Backup/maintenance windows are not explicitly set.
- Final snapshot identifiers in root may be static and can collide on repeated destroy attempts.
- Old production DB is intentionally retained for rollback, but cleanup/final snapshot process needs a hard deadline and runbook.

### 7. IAM and CI/CD permissions

- GitHub OIDC resources are documented as manually bootstrapped, while Terraform has optional resources for them. Ownership is unclear.
- Deploy role policy in Terraform includes broad read permissions and broad S3 prefixes (`react-*`, `ona-*`).
- Terraform plan workflow currently assumes `AWS_DEPLOY_ROLE_ARN`; apply uses `AWS_TERRAFORM_ROLE_ARN`. This may be intentional, but least-privilege boundaries should be reviewed.
- SSM `SendCommand` is tag-scoped for instances, but document resource is broad for `AWS-RunShellScript`.
- Instance role can read the whole config and artifact buckets; acceptable baseline, but can be narrowed by environment/prefix.
- No explicit permissions boundary or separate roles per environment.

### 8. Deployment and rollback

- Deploys upload immutable SHA artifacts and update `latest.tar.gz` after success; this is good.
- There is no first-class rollback workflow to redeploy a selected previous artifact.
- Frontend rollback depends on S3/CloudFront state and is not automated.
- Remote deploy runs migrations before app restart; rollback after forward migrations is not defined.
- Deploy health check only checks `localhost:3000/health` from the instance. It does not verify ALB/CloudFront externally post-deploy.
- Production deploy workflow is documented as needing careful validation.

### 9. Observability and audit

- No CloudWatch log shipping for API/PM2 logs is defined.
- No ALB access logs.
- No CloudFront logs.
- No RDS enhanced monitoring.
- No alarms for API health, ALB target health, 5xx rates, RDS CPU/storage/connections, CloudFront error rates, or deploy failures.
- No budget/anomaly alarms are visible in Terraform.
- No AWS Config/Security Hub/GuardDuty posture is represented in Terraform.

### 10. Application-adjacent infra concerns

- API has an open `/api/register` endpoint. This is operationally risky for production unless gated elsewhere.
- API does not appear to use security headers middleware such as Helmet.
- Session cookie domain is `.bennetts.work` in production; this supports cross-subdomain behavior but broadens cookie scope.
- CORS allowlist is env-driven and appears reasonable, but should be covered by smoke tests for staging/prod origins.

## Production-Ready Target Architecture

Recommended near-term target keeps EC2 + SSM but hardens it:

- `terraform/envs/staging` and `terraform/envs/prod` with separate backend keys, not workspaces
- shared modules under `terraform/modules/*`
- EC2 API instances in private subnets
- ALB in public subnets
- RDS in private isolated DB subnets
- VPC endpoints for SSM, EC2 Messages, SSM Messages, S3, CloudWatch Logs, and Secrets Manager/SSM Parameter Store
- runtime secrets in SSM Parameter Store SecureString or Secrets Manager
- S3 config bucket either removed or used only for non-secret config
- S3 buckets encrypted, versioned where useful, public access blocked, lifecycle-managed
- CloudFront OAC, managed policies, SPA fallback, logging, compression, tuned TTLs
- ALB HTTP->HTTPS redirect, deletion protection, access logs, optional WAF
- CloudWatch agent for API logs and alarms
- rollback workflow for API artifact SHA and frontend versions

Longer-term optional target:

- ECS/Fargate or App Runner for API if operational complexity justifies migration
- RDS Proxy if connection pooling or credential rotation requires it
- Blue/green API deployments if zero-risk rollback is needed

## Migration Plan

### Phase 0 — Safety freeze and inventory

1. Confirm current AWS resources for staging and production:
   - EC2 instances, target groups, ALBs, CloudFront distributions, S3 buckets, RDS DBs, security groups, IAM roles.
2. Export/tag inventory with `Project=network-survey`, `Environment`, `App`, and ownership notes.
3. Decide source of truth for production app stack:
   - either import/adopt into Terraform, or explicitly mark legacy/manual resources until replaced.
4. Remove local `*.tfplan` files and move local secret tfvars outside the repo directory.
5. Establish lockfile policy and commit root `.terraform.lock.hcl` if using standard Terraform practice.
6. Set branch protection for infra changes if not already enforced.

Deliverable: `docs/infra-inventory.md` or updated `plans/infra-migration-plan.md` with live resource IDs and ownership.

### Phase 1 — Secrets cleanup

Decision: use SSM Parameter Store SecureString. Terraform manages parameter names and read permissions, not secret values.

1. Create per-environment secret paths, for example:
   - `/network-survey/staging/db/password`
   - `/network-survey/staging/api/session-secret`
   - `/network-survey/staging/api/resend-api-key`
   - `/network-survey/prod/...`
2. Update Terraform so API runtime secret values are not required as normal variables for app runtime config.
3. Update `remote-deploy.sh` to fetch secrets on instance at deploy time.
4. Remove secret values from S3 `.env.prod`; keep only non-secret config and SSM parameter names.
5. Rotate secrets currently present in Terraform state/S3/local tfvars if exposure risk is unacceptable.
6. Scrub old release directories on EC2 that contain copied `.env.prod` files, retaining only required current config.

Deliverable: deploys work with secrets pulled from AWS secret storage, not Terraform-rendered S3 env files.

### Phase 2 — Terraform refactor and state separation

1. Create module structure:

   ```text
   terraform/
     modules/
       network/
       database/
       backend_ec2/
       frontend_static/
       alb/
       iam_github_oidc/
       observability/
     envs/
       staging/
       prod/
   ```

2. Move away from workspaces to separate backend keys:
   - `staging/terraform.tfstate`
   - `prod/terraform.tfstate`
3. Migrate state carefully with `terraform state mv` / `terraform import` plans.
4. Expand `terraform/envs/prod` beyond the replacement DB only after prod app resource ownership/import is planned.
5. Pin Terraform version to match CI.
6. Add `terraform fmt`, `validate`, and plan for both environments in PR checks.

Deliverable: clean environment roots with no workspace dependency.

### Phase 3 — Network hardening

1. Define proper subnet tiers:
   - public subnets for ALB/NAT only
   - private app subnets for EC2
   - private DB subnets for RDS
2. Move backend EC2 to private subnet.
3. Add VPC endpoints needed for private instance operations:
   - SSM
   - SSMMessages
   - EC2Messages
   - S3 gateway endpoint
   - CloudWatch Logs
   - Secrets Manager or SSM Parameter Store
4. Remove public IP from backend EC2.
5. Remove SSH host firewall allow rule and keep no SSH ingress by default.
6. Tighten security group egress where practical.
7. Verify SSM Session Manager access without public IP.

Deliverable: API instance is private and managed entirely by SSM.

### Phase 4 — Edge and storage hardening

1. ALB:
   - add HTTP port 80 listener redirecting to HTTPS
   - enable deletion protection for prod
   - enable access logs to a dedicated logs bucket
   - review TLS policy and health check settings
2. CloudFront:
   - replace `forwarded_values` with managed cache/origin request policies
   - add SPA fallback custom error responses
   - enable compression
   - add standard logs or real-time logs if needed
   - consider AWS WAF managed rules
3. S3:
   - add public access blocks to dashboard/survey buckets
   - add bucket encryption everywhere
   - add versioning where useful
   - add lifecycle policies for artifacts/logs
   - keep OAC-only access for frontend buckets
4. RDS:
   - ensure storage encryption in all envs
   - define backup retention, backup window, maintenance window
   - evaluate Performance Insights/enhanced monitoring
   - use unique final snapshot identifiers

Deliverable: storage/edge resources meet baseline production controls.

### Phase 5 — IAM least privilege

1. Decide whether Terraform owns GitHub OIDC. If yes, import existing provider/roles and manage them in one place.
2. Split roles by responsibility:
   - deploy staging
   - deploy production
   - terraform plan read-only
   - terraform apply admin/infra
3. Scope deploy S3 permissions to exact environment buckets or tags.
4. Scope SSM SendCommand to environment-specific tagged instances and approved document usage.
5. Scope instance role to only required secret paths and bucket prefixes.
6. Add IAM Access Analyzer review where possible.

Deliverable: CI/CD and instance IAM policies are environment-scoped and auditable.

### Phase 6 — Observability and operations

1. Install/configure CloudWatch Agent or PM2 log shipping.
2. Add dashboards and alarms:
   - ALB 5xx and unhealthy target count
   - API health check failure
   - EC2 CPU/disk/memory if available
   - RDS CPU/storage/connections/freeable memory
   - CloudFront 4xx/5xx
   - deploy workflow failure notifications
3. Enable ALB/CloudFront/S3 access logging as needed.
4. Add AWS budget/anomaly alert.
5. Write runbooks:
   - production deploy
   - rollback API artifact
   - frontend rollback
   - DB restore
   - SSM access
   - incident checklist

Deliverable: actionable alerts and documented operational procedures.

### Phase 7 — Deployment and rollback maturity

1. Add manual rollback workflow for API artifact SHA.
2. Add frontend rollback strategy:
   - S3 versioning-based restore, or
   - publish versioned build prefixes and flip CloudFront origin/path.
3. Add post-deploy external smoke tests:
   - API `/health` through ALB domain
   - dashboard and survey HTTP 200
   - auth smoke in staging
4. Add migration safety policy:
   - classify reversible/irreversible migrations
   - require backup/snapshot before risky prod migrations
5. Validate production deploy path with approval gate.

Deliverable: production deploys are reversible and externally verified.

### Phase 8 — Production cleanup

1. Complete old production DB rollback window.
2. Create final snapshot of old DB.
3. Delete old DB and obsolete security groups/instances after validation.
4. Expand `terraform/envs/prod` to own the intended prod app resources or archive legacy migration-only code after import/migration.
5. Remove stale docs and update the canonical infra README.

Deliverable: no unmanaged legacy production resources remain except explicitly documented external dependencies.

## Suggested Execution Order

1. Inventory and source-of-truth decision.
2. Secrets migration.
3. Observability baseline and rollback workflow.
4. S3/CloudFront/ALB hardening that can be applied in place.
5. Terraform refactor/state separation.
6. Network private-subnet migration.
7. IAM least privilege tightening.
8. Legacy production cleanup.

This order reduces blast radius: first understand and secure secrets, then improve rollback/visibility, then make structural network changes.

## Work That Can Proceed Without More Product Decisions

These are safe next implementation tracks under the current assumption that prod/demo is inactive but prod DB data must be preserved:

1. **Resolve production Terraform source of truth before prod apply**
   - SSM params exist for prod, but root `default` workspace has no state.
   - Do not run root prod apply until existing prod resources are imported/folded in or a replacement-prod migration is explicitly chosen.
   - Keep `api_config_db_host_override` until replacement DB ownership is folded into the primary prod root.

2. **Current-release secret handling**
   - Historical release dirs were cleaned, but the active release still contains resolved secrets in `.env.prod` for API compatibility.
   - Future improvement: switch the service startup model to load secrets without persisting them in release directories, or write the env file outside versioned release dirs with strict permissions and rotation cleanup.

3. **Observability baseline**
   - Add CloudWatch log group/agent setup for API logs.
   - Add ALB access log bucket/prefix and lifecycle.
   - Add basic CloudWatch alarms for ALB unhealthy targets/5xx and RDS storage/CPU/connections.
   - Add deploy failure visibility documentation.

4. **Runbooks and safety checks**
   - Add runbooks for Terraform apply, API artifact redeploy, DB snapshot/restore, and SSM access.
   - Add a production apply checklist that verifies the intended DB endpoint before apply.
   - Add SSM remediation doc/script for existing-instance UFW SSH cleanup.

5. **Terraform hygiene that does not require state surgery**
   - Pin Terraform version to the CI version.
   - Standardize provider lockfile policy.
   - Remove local tfplan/tfvars artifacts from repo working directories.
   - Add variable validations and comments around transitional prod settings.

6. **Staging and production deploy validations**
   - Staging `Redeploy API Artifact` has been validated.
   - Add staging smoke coverage for login/check-auth and a minimal survey flow.
   - Production artifact redeploy remains untested and should wait until prod resource ownership/tagging is fully inventoried.

## Decisions Recorded

1. **Secrets backend**
   - Decision: use SSM Parameter Store SecureString.
   - Implementation note: Terraform should manage parameter names/permissions, not secret values. Secret values are created/rotated outside Terraform to avoid writing them into Terraform state.

2. **Production DB ownership**
   - Decision: fold `terraform/prod-db` into the main prod Terraform source of truth.
   - Status: initial move completed by relocating the DB root to `terraform/envs/prod` while preserving the existing `prod-db/terraform.tfstate` backend key and DB data.
   - Remaining: fold/import or replace CloudFront, ALB, EC2, and VPC/subnet/route resources after observability and source-of-truth planning. ACM certs are imported/preserved.

3. **Terraform refactor strategy**
   - Decision: migrate away from workspaces to `terraform/envs/{staging,prod}` after secrets and observability.

4. **Private networking strategy**
   - Decision: use VPC endpoints for now. Add NAT only if required by app/runtime outbound dependencies.

5. **Old production DB retirement window**
   - Decision: retain the old production DB for 4 weeks, then create/confirm final snapshot and delete after validation.

6. **IAM/OIDC ownership**
   - Decision: leave existing GitHub OIDC/deploy/Terraform roles manually managed for now.
   - Follow-up: revisit import/Terraform management after the main Terraform refactor and role split planning.

7. **WAF/rate limiting**
   - Decision: defer until closer to production reactivation unless public abuse is observed.

8. **Private networking and API HA path**
   - Decision: prefer ASG + EC2 over ECS/Fargate for the next backend architecture step because it is likely cheaper for this small always-on API.
   - Roadmap: see `plans/private-networking-and-ha-roadmap.md`.
   - Initial target: ASG-managed EC2 with desired capacity `1` for self-healing.
   - Hardened target: API instances in private subnets with no public IPs.
   - HA target: ASG desired capacity `2` across AZs when production uptime requirements justify the additional EC2 cost.


## Acceptance Criteria

- No runtime secrets in Terraform state or S3 env files.
- Production and staging have separate Terraform roots/states.
- Production backend EC2 has no public IP and no SSH ingress.
- RDS is private, encrypted, backed up, deletion-protected in prod, and monitored.
- ALB redirects HTTP to HTTPS, logs access, has deletion protection in prod, and alarms on unhealthy targets/5xx.
- S3 frontend buckets are private, encrypted, public-access-blocked, and CloudFront OAC-only.
- Artifact/log buckets have lifecycle policies.
- CI/CD roles are environment-scoped and least-privilege enough to review.
- Production deploy and rollback are documented and tested.
- Old production DB and obsolete compute/security resources are removed after final snapshot.
