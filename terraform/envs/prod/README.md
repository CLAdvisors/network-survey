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
  validation records and remain protected in state.
- An additive survey certificate for the canonical survey hostname plus every
  retained legacy alias. Its validation and application CNAMEs remain externally
  managed.

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

## Canonical survey domain rollout

`survey_certificate_domain` fixes the primary identity of the additive
certificate. The complete alias set consists of that domain, `survey_domain`,
and `additional_survey_domains`; it remains attached to CloudFront and allowed
by API CORS regardless of which alias is active. `survey_link_domain` controls
only the hostname used for newly generated respondent and demo links and must be
one of those retained aliases. Changing it must not replace a certificate,
remove an alias, or invalidate a previously issued tokenized link.

ACM validation DNS and application routing DNS are separate. ACM's validation
CNAME only proves domain ownership. The application CNAME must also point
`survey.cladvisorsurveys.com` to the `survey_cloudfront_domain` output before
canonical links are enabled.

The checked-in default deliberately keeps new links on the legacy hostname.
For a first-time cutover, retain that persisted value through the certificate,
alias, and application-DNS phases:

```sh
export TF_VAR_db_password=...
terraform -chdir=terraform/envs/prod init

# Request only the additive certificate. Review and apply the same saved plan.
terraform -chdir=terraform/envs/prod plan \
  -target=aws_acm_certificate.prod_survey_canonical \
  -out=survey-certificate.tfplan
terraform -chdir=terraform/envs/prod apply survey-certificate.tfplan

# Publish every record from this output through the approved external DNS process.
terraform -chdir=terraform/envs/prod output survey_certificate_validation_records

# After the validation records resolve, wait for ACM to issue the certificate.
terraform -chdir=terraform/envs/prod plan \
  -target=aws_acm_certificate_validation.prod_survey_canonical \
  -out=survey-validation.tfplan
terraform -chdir=terraform/envs/prod apply survey-validation.tfplan

# Attach all aliases while link generation remains on the legacy hostname.
terraform -chdir=terraform/envs/prod plan -out=survey-aliases.tfplan
terraform -chdir=terraform/envs/prod apply survey-aliases.tfplan
terraform -chdir=terraform/envs/prod output -raw survey_cloudfront_domain
```

Create the externally managed application CNAME for
`survey.cladvisorsurveys.com` using that CloudFront output. Wait for public DNS
propagation, then verify canonical and legacy hostnames serve the same frontend,
TLS is valid, and API CORS accepts both origins. Do not put respondent tokens in
DNS or HTTP verification logs.

Only after those checks pass, activate canonical link generation through a
separate reviewed configuration change. Persist `survey_link_domain =
survey.cladvisorsurveys.com` in the approved production variable source (for
this repository, update its checked-in default); do not rely on a temporary
shell override that later automation would silently undo. Then apply the saved
plan and run the current coordinated deployment workflow so the API and fenced
delivery/webhook workers load the updated runtime configuration:

```sh
terraform -chdir=terraform/envs/prod plan -out=survey-link-cutover.tfplan
terraform -chdir=terraform/envs/prod apply survey-link-cutover.tfplan
# Run the approved current deployment workflow, then verify newly generated links.
```

Verify the generated hostname without recording a respondent token. A Terraform
apply updates the versioned runtime-config object but does not reload the running
processes, so the deployment step is mandatory.

The cutover plan must retain the distribution, bucket, OAC, complete alias set,
`aws_acm_certificate.prod_survey`, and
`aws_acm_certificate.prod_survey_canonical`. It must not replace or destroy API,
dashboard, worker, database, network, or certificate resources.

To roll back only new-link generation, persist
`survey_link_domain=demo.ona.survey.bennetts.work`, repeat the saved-plan
workflow, and run the same coordinated deployment workflow. Reject the rollback
plan if it changes ACM or CloudFront aliases. Existing canonical and legacy
links must continue to work. Keep every alias and validation/application CNAME
until an explicit issued-link retirement is approved.

Saved plan files can contain sensitive values. Restrict their permissions and
delete them after the reviewed apply. Do not run `terraform apply` without the
reviewed plan filename, because that creates a new, unreviewed plan.

Do not use the historical emergency hotfix packaging or remote-deploy scripts;
current deployment tooling must continue to release and fence the API, delivery
worker, and webhook worker together.

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
