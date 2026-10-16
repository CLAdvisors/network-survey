# Staging secure-runtime boundary

Status: **delivered in tranche 2** (code only, unmerged/unapplied). The
inclusion boundary below is implemented; the pre-start and later-effect gates
still apply. It is not provisioning, secret-creation or host-start approval.

## Delivered in tranche 2 (commit `d04494c`+)

- `api/runtime-secrets.js` loads `SESSION_SECRET` (and gated Resend references)
  from SSM SecureStrings into process memory after PM2 spawn; fail-closed and
  sanitized. `api/secure-runtime.js` starts the API, email and webhook workers
  through it (`server.js`/`email-worker.js`/`webhook-worker.js` expose
  `startServer`/`main`). No optional analysis worker.
- The secure identity is the explicit `SECURE_RUNTIME_ENABLED` flag stamped by
  the target Terraform into `deploy.env` and the runtime config. Only
  `terraform/envs/staging-target` sets it; the retained source staging is a
  separate root/module and keeps its existing path.
- `scripts/deploy/remote-deploy.sh` validates exact SSM/Secrets references,
  streams a reference-only config through `runtime-config-check.js` before any
  file is written, passes the Liquibase password via `LIQUIBASE_COMMAND_PASSWORD`
  (never argv), bootstraps through the managed-DB callback
  (`read-managed-password.js`), and never repopulates `api/.env.prod`. Staging
  now takes the same host deploy lock and the `/live` capability/health floor as
  prod-secondary, and never prunes old releases.
- Ordinary and previous-artifact rollback start only a capability-verified
  secure artifact (`secure-artifact-check.js`); an insecure previous release is
  refused and the host is left out of service. Deploy-invoked migration/
  control/heartbeat tooling uses the managed callback (`runtime-pool.js`).
- Focused tests live in `api/test/`.

# Original boundary map (first tranche)

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
