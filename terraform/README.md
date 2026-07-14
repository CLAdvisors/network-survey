# Infrastructure

One Terraform configuration, deployed per environment with **workspaces**:

| Workspace | Environment | Domains | tfvars |
|---|---|---|---|
| `default` | prod (the original "demo" stack) | `demo.ona.{api,dashboard,survey}.bennetts.work` | `prod.tfvars` |
| `staging` | staging | `staging.ona.{api,dashboard,survey}.bennetts.work` | `staging.tfvars` |

The default workspace keeps the resource names that already exist in prod state, so
adopting workspaces required no state surgery. Non-default workspaces prefix
resource names with the workspace name (e.g. `staging-backend-security-group`).

## What each environment contains

- **API**: EC2 instance (pm2) behind an HTTPS ALB. App code is installed from
  release artifacts in S3 via SSM Run Command (see
  [deploy.yml](../.github/workflows/deploy.yml)) — never by re-running cloud-init.
- **Database**: RDS Postgres 15, **not** publicly accessible, TLS enforced,
  reachable only from the backend security group. Migrations run *on the
  instance* (Liquibase is installed by cloud-init) during deploys.
- **Frontends**: two S3 + CloudFront distributions (dashboard, survey), synced by CI.
- **Buckets**: `config` (runtime `.env.prod`, rendered from `templates/env.tmpl`)
  and `artifacts` (versioned API release tarballs). Buckets are private;
  frontend buckets are CloudFront OAC-only, and managed buckets define baseline
  public-access blocks/encryption/versioning where appropriate.
- **Access**: no SSH by default — use SSM Session Manager
  (`aws ssm start-session --target <instance-id>`). To open SSH anyway, set
  `ssh_allowed_cidrs` to your IP.

## Secrets

`db_password` is still required by Terraform because Terraform currently manages
RDS. Supply it via an environment variable or an untracked `*.local.tfvars` file
passed explicitly with `-var-file`:

```sh
export TF_VAR_db_password=...
```

API runtime secrets now come from SSM Parameter Store SecureString values, not
Terraform-rendered S3 config. Create these parameters before deploying an
environment:

```sh
aws ssm put-parameter --type SecureString --overwrite \
  --name /network-survey/staging/db/password --value '...'
aws ssm put-parameter --type SecureString --overwrite \
  --name /network-survey/staging/api/session-secret --value '...'
aws ssm put-parameter --type SecureString --overwrite \
  --name /network-survey/staging/api/resend-api-key --value '...'
```

Use `/network-survey/prod/...` for prod. **Never commit secret values** — the old
`env.tmpl` contained a live Resend key; that key should be rotated in the Resend
dashboard since it lives in git history. Avoid local `*.auto.tfvars` for
environment-specific secrets because Terraform loads them for every workspace.

## Applying

```sh
# prod (default workspace)
terraform workspace select default
terraform apply -var-file=prod.tfvars

# staging
terraform workspace new staging      # first time only
terraform workspace select staging
terraform apply -var-file=staging.tfvars
```

Standing up a **new** environment needs two passes, because the
`aws_acm_certificate_validation` resources block until the DNS validation
records exist:

1. Create just the certificates:
   `terraform apply -var-file=staging.tfvars -target=aws_acm_certificate.ssl_cert -target=aws_acm_certificate.ssl_cert_dashboard -target=aws_acm_certificate.ssl_cert_survey`
2. Create DNS CNAMEs for the validation records (`terraform output ssl_cert_validation_records` etc.).
3. Run the full `terraform apply -var-file=staging.tfvars`.
4. Point the three domains at their targets: API domain → `alb_dns_name`,
   dashboard/survey domains → `dashboard_cloudfront_domain` / `survey_cloudfront_domain`.
5. Run the **Deploy** GitHub workflow for that environment — the instance boots
   without app code until the first artifact deploy.
6. Bootstrap an admin user (temporary until self-serve admin management):
   `POST /api/register` against the API.

## CI/CD wiring (one-time GitHub setup)

1. GitHub OIDC/deploy role is currently bootstrapped manually in AWS:
   `arn:aws:iam::438465164125:role/github-actions-deploy`.
   If Terraform should manage it later, import the existing OIDC provider and
   role/policy before setting `manage_github_oidc = true`.
2. In the GitHub repo, set **repository variables**:
   - `AWS_DEPLOY_ROLE_ARN` = `arn:aws:iam::438465164125:role/github-actions-deploy`
   - `AWS_TERRAFORM_ROLE_ARN` = `arn:aws:iam::438465164125:role/github-actions-terraform`
   - `AWS_REGION` = `us-east-1` (optional; workflows default to it)
3. Create **environments** `staging` and `production` under repo Settings →
   Environments; add required reviewers to `production` to gate prod deploys.

Deploy workflow behavior: every push to `main` deploys to staging; production
deploys are manual (`workflow_dispatch`). The workflow resolves buckets,
distributions, and the instance by tags (`Environment` + `App`), so no
per-environment IDs need to be configured in GitHub. After deploy, it performs
external smoke checks against the API, dashboard, and survey domains.

Previous-artifact redeploy behavior: `Redeploy API Artifact` is manual and
redeploys a previously published API artifact SHA through the same SSM path.
Leave `mark_latest=true` when the redeployed artifact should become the instance
bootstrap artifact for future replacement instances. This is not a database,
schema, runtime-config, or frontend rollback.

Terraform apply behavior: `.github/workflows/terraform-apply.yml` is manual and
uses the `AWS_TERRAFORM_ROLE_ARN` role. The `production` environment should have
required reviewers configured before production applies are allowed. Store
`TF_VAR_DB_PASSWORD` as an environment-level secret for each environment.
Runtime app secrets are stored in SSM Parameter Store instead.

## Migrating the existing prod stack to this config

The security fixes change live resources. Checklist for the first prod apply:

- **Rotate the leaked Resend API key first** (it was hardcoded in `env.tmpl`).
- Terraform now expects `TF_VAR_DB_PASSWORD`. Use the *existing* DB password for
  `db_password` — RDS passwords are only changed if the value differs.
- During the current inactive-production infra refactor, `prod.tfvars` sets
  `api_config_db_host_override` so a root prod apply keeps the API runtime
  config pointed at the replacement DB managed in `terraform/envs/prod`. Remove
  that override only after prod DB ownership is folded into the primary prod
  Terraform root.
- The removed `aws_s3_object.react_dashboard_files` / `react_survey_files`
  resources will otherwise **delete the live frontend files** on apply. Either
  drop them from state first (`terraform state rm 'aws_s3_object.react_dashboard_files' 'aws_s3_object.react_survey_files'`)
  or run the Deploy workflow immediately after apply to re-publish.
- The removed `local_file.*` resources delete the generated
  `db/liquibase-prod.sh(.ps1)` and `api/.env.prod` files on your machine — these
  embedded the DB password and are replaced by on-instance migrations.
- The old config attached the instance's S3 policy twice
  (`attach_s3_policy` + `ec2_s3_policy` — same attachment). Destroying the
  removed duplicate would detach the policy from the live role, so drop it from
  state first: `terraform state rm aws_iam_role_policy_attachment.attach_s3_policy`.
- `user_data` changed: AWS stops/starts the instance to update it (brief API
  outage, new public IP — harmless behind the ALB). Cloud-init does **not**
  re-run on an existing instance, so install the new runtime pieces once via SSM
  or recreate the instance (`terraform taint aws_instance.backend`) — recreating
  is cleaner and the deploy pipeline repopulates it.
- RDS changes: `publicly_accessible=false`, new dedicated security group, and
  the default parameter group (SSL required, replacing `postgres-no-ssl`, which
  is deleted). Requires a reboot to fully take effect; plan a short window.
  After SSL is enforced, only the new code path (API `DB_SSL=true`, deploy-time
  Liquibase with `sslmode=verify-full`) can connect — local `liquibase-prod.sh`
  runs stop working by design.
- SSH ingress is removed. Confirm you can reach the instance via
  `aws ssm start-session` (requires the instance to have picked up the new IAM
  policy and SSM agent — Ubuntu ships it by default).
- `db_deletion_protection = true` in prod also disables `skip_final_snapshot`.
