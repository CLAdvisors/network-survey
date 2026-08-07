# Survey email worker rollout and control

This runbook covers Phase 1 dispatch. After Phase 2 webhook registration or suppression activation, `docs/runbooks/resend-webhook-operations.md` supplies the stricter capability-aware deploy and rollback procedure and takes precedence.

Durable launch rows may be created only when `SURVEY_DELIVERY_V2_ENABLED=true`. Provider dispatch is independently controlled by `email_worker_control.claiming_enabled`; migrations seed hosted environments with claiming disabled.

## Deployment order

1. Take or confirm the final database snapshot.
2. Apply Liquibase migrations.
3. Deploy the API and `ona-email-worker` from the same release artifact.
4. Confirm `/health`, worker heartbeat freshness, readiness output, and the release revision while both rollout gates remain disabled.
5. Set the staging Terraform `survey_delivery_v2_enabled` input to true and apply; keep legacy start and claiming disabled. Redeploy the current API artifact so it downloads the updated S3 runtime config, then verify the flag in `/opt/service/current/api/.env.prod`.
6. Enable claiming with the fenced operator command below, then immediately launch a controlled one-recipient staging survey.
7. Inspect its durable delivery/attempt rows and watch acceptance/failure counts, worker heartbeat, and provider logs before production enablement.

The hosted `.env.prod` must explicitly set:

- `EMAIL_WORKER_ENV=staging` or `EMAIL_WORKER_ENV=prod`
- `SURVEY_DELIVERY_V2_ENABLED=false` until that environment's controlled rollout
- `LEGACY_START_ENABLED=false` (the compatibility bulk-start adapter remains disabled)
- `EMAIL_RATE_PER_SECOND=1` in staging and at most `4` in production; their independent databases therefore sum to the approved five-request provider-account budget
- `EMAIL_RATE_BUDGET_ENV` equal to the environment so synchronous and worker sends share that environment's allocation

## Enable or disable claiming

Run through AWS Systems Manager Session Manager on the target instance. Enabling is revision-fenced and fails unless the matching worker has a fresh heartbeat.

```bash
cd /opt/service/current/api
REVISION=$(cat /opt/service/current/REVISION)
EMAIL_WORKER_ENV=staging EXPECTED_RELEASE_REVISION="$REVISION" NODE_ENV=prod \
  node ../deploy/set-email-claiming.js true controlled-rollout
```

Emergency stop (does not require a healthy worker):

```bash
cd /opt/service/current/api
EMAIL_WORKER_ENV=staging NODE_ENV=prod \
  node ../deploy/set-email-claiming.js false emergency-stop
```

Use `prod` only on the production instance. Never update the control row manually; the script locks the row, validates the namespace, and records the reason.

## Rollback

Before Phase 2 activation, the rollback workflow validates the target artifact before disabling claiming. Once webhook registration or suppression is active, only a capability-compatible artifact is allowed: pause projection, keep ingestion and suppression active, verify both worker heartbeats, and follow `resend-webhook-operations.md`. A Phase 1 artifact must never be restored after that floor is raised.

## Ambiguous provider calls

A leased attempt recovered inside the configured provider-idempotency window reuses its durable provider key. Once that boundary has expired, the worker marks the delivery `uncertain` rather than risking a duplicate send. Do not manually retry uncertain deliveries in Phase 1.
