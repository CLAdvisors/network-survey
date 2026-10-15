# Staging secure-runtime boundary (mandatory later work)

Status: boundary map only. **No secure-runtime integration is implemented in the
first code-only tranche.** This document records what the later staging runtime
change must cover so the boundary is not dropped or quietly widened.

## What the first tranche does

The first tranche only shapes infrastructure and identity:

- target root `terraform/envs/staging-target` (account 710054969994, key
  `envs/staging-target/terraform.tfstate`), logical environment `staging`;
- one NAT gateway, interface VPC endpoints disabled, S3 gateway retained;
- ASG `min = desired = max = 0` (stage 0), all provider/sending/webhook/
  bootstrap/delivery gates off;
- environment-derived names/branches and state-safe, prod-secondary-owned
  account-global moves;
- a candidate fail-closed route guard and checklist.

It does **not** make a host bootable, and `start_staging_app` must stay `false`.

## Why a secure-runtime gate is mandatory before any host starts

`main`'s `scripts/deploy/remote-deploy.sh` persists decrypted DB/session secrets
into an on-host `.env` and exits 1 for any `EMAIL_WORKER_ENV` other than
`prod-secondary` when `RESEND_API_KEY_PARAMETER` is empty. Staging is
intentionally credentials-disabled, so the current `main` deploy path is not a
usable staging bootstrap. A plaintext fallback is **not** authorized.

## Inclusion boundary (must be covered by the later change)

Adapt only the proven seams from the unmerged prototype (`38e35eb`):

- transient secret loading for `staging` (no decrypted values in files, logs,
  process args, PM2 state or receipts);
- allow staging with Resend disabled/absent (no provider key required);
- cover the API, the **email worker** and the **webhook worker**, and the
  migration/admin/control tools that deploy and rollback actually invoke;
- artifact capability validation and the `/live` capability floor;
- ordinary **and previous-artifact (rollback)** deploys;
- preserve the same-environment host lock, CI serialization, and RDS
  managed-secret rotation;
- AWS-only operator creation of SecureStrings; runtime stores references only.

## Exclusion boundary (must not be pulled in)

- the prototype optional `ona-analysis-worker` / `ANALYSIS_WORKER_ENABLED`
  expansion;
- new delivery features and the old Release1 analytics/delivery/security
  roadmap;
- any unrelated feature lane or respondent UI change.

## Pre-start gate

No stage-2 host may start until: the runtime integration is reviewed, the
session SecureString exists (name only recorded), one reviewed capability-verified
artifact is published, and a rollback artifact is retained. Enabling
`start_staging_app = true` is a separate, approved effect.

## Unrun checks (honest limits)

- No live Terraform plan or state read was performed in this tranche; backend
  init, state and locking were not run.
- `terraform fmt`/`validate` were run offline against cached providers only,
  with the backend disabled and no downloads.
- A read-only `prod-secondary` plan proving only expected state-address/attribute
  effects, and the historical `DB_SECRET_TIMEOUT_MS=2000` drift isolation, remain
  unrun and are required before any apply.
- No provisioning, restore, smoke, DNS or CI-setting change was performed.
