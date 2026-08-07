# Resend webhook operations

Phase 2 is additive. Provider acceptance remains distinct from provider delivery truth. Never disable ingestion before disabling/removing the provider endpoint, never roll back schema, and never use replay to send email.

## Capabilities and controls

Every artifact must contain `deploy/CAPABILITIES.json` with versioned `webhook_ingest`, `webhook_projection`, `suppression_enforcement`, and schema capabilities. Deploy and rollback reject artifacts without the marker and require fresh exact-deployment heartbeats from both workers.

The controls are independent and default off:

1. `RESEND_WEBHOOK_INGEST_ENABLED` is Terraform release configuration. Disabled returns `503`. After registration, disable the Resend endpoint before deploying this false.
2. `email_webhook_worker_control.processing_enabled` pauses projection while ingestion remains durable. Change it only with `set-webhook-processing.js`.
3. `email_suppression_control.enforcement_enabled` is a one-way normal-operations latch. Activate it only with `activate-suppression-enforcement.js`.
4. `email_sending_control.sending_enabled` fences all application-originated provider calls. Hosted rows start false. Use `set-email-sending.js` for controlled enable or break-glass stop.

Read the current `control_revision` first. All mutating commands require that expected revision and record actor/reason audit data.

## Staging registration bootstrap

Production registration is blocked until the shared Resend team supports two endpoints. Use the currently available endpoint for staging first.

1. Apply Terraform with `resend_webhook_ingest_enabled=false`. Confirm the SNS subscription and CloudWatch Agent/log groups.
2. Deploy the Phase 2 artifact and verify API, delivery-worker, and webhook-worker exact-deployment heartbeats.
3. Obtain the selected event-set hash without printing any secret:

   ```bash
   cd /opt/service/current/api
   node ../deploy/manage-resend-webhook.js event-hash
   ```

4. Assume a separately authenticated platform-operator AWS identity with narrowly scoped SSM write permission; the EC2 runtime role is read-only for secrets. Run bootstrap with the canonical public webhook URL, stable shared provider scope, exact hash, and operator actor. The script snapshots all endpoint IDs before create, creates only the requested endpoint, immediately disables it, writes the signing secret directly to the environment-specific SSM SecureString, and reconciles the audited registration row. It never prints the signing secret.

   ```bash
   node ../deploy/manage-resend-webhook.js bootstrap \
     --environment staging \
     --url https://staging.ona.api.bennetts.work/api/webhooks/resend \
     --account-scope network-survey-resend-team \
     --event-set-hash <exact-hash> \
     --actor <platform-operator>
   ```

   Rerun the same command after interruption. If more than one post-snapshot candidate matches, the script disables candidates and refuses to guess.

5. Inspect non-secret state with the same arguments and the `status` command.
6. Apply Terraform with ingestion enabled and redeploy. Prove primary and previous-secret signed fixtures locally. The previous SSM parameter is optional and may be absent outside rotation.
7. Enable the provider endpoint only after signed ingress, duplicate, stale/future timestamp, oversize, and database-failure behavior pass:

   ```bash
   REVISION=$(cat /opt/service/current/REVISION)
   node ../deploy/manage-resend-webhook.js enable <common-options> \
     --confirm <endpoint-id> --expected-release "$REVISION"
   ```

8. Enable projection using the exact release/deployment and control revision:

   ```bash
   REVISION=$(cat /opt/service/current/REVISION)
   # DEPLOYMENT_ID is visible in the exact worker heartbeat row.
   EXPECTED_RELEASE_REVISION="$REVISION" EXPECTED_DEPLOYMENT_ID=<deployment-id> \
     node ../deploy/set-webhook-processing.js true <control-revision> <actor> controlled-staging-rollout
   ```

9. Activate suppression only after boundary-race tests pass:

   ```bash
   EXPECTED_RELEASE_REVISION="$REVISION" \
     node ../deploy/activate-suppression-enforcement.js <control-revision> <actor> controlled-staging-activation
   ```

10. Enable all application-originated mail only after suppression is active and the exact release is healthy:

   ```bash
   EXPECTED_RELEASE_REVISION="$REVISION" \
     node ../deploy/set-email-sending.js true <control-revision> <actor> controlled-staging-email-enable
   ```

## Rotation

Never print or export secret values in an interactive shell.

Endpoint-count and provider-plan capacity must be confirmed first. Under the separate platform-operator AWS identity, run crash-recoverable rotation bootstrap with the same common options used for registration:

```bash
node ../deploy/manage-resend-webhook.js rotate <common-options>
```

The command copies primary to previous in process memory, creates/reconciles the replacement disabled, writes its secret to primary, and durably retains the old endpoint ID. Deploy and prove fixtures signed by both loaded secrets, then enable the replacement with its exact ID/release. Keep both endpoints and both secrets for at least 36 hours. Finally retire the exact old endpoint and redeploy without the previous secret:

```bash
node ../deploy/manage-resend-webhook.js retire-previous <common-options> --confirm <old-endpoint-id>
```

The retirement command disables the old endpoint and clears the previous SecureString; deletion of the already-disabled old endpoint can follow after provider-state verification.

## Suppression override, replay, and endpoint removal

A provider removal remains fail-closed. Override only the exact latest inactive cause version after an audited platform decision; the address is accepted as input but never printed:

```bash
node ../deploy/override-email-suppression.js <address> <reason> <cause-version> <platform-operator-actor> <audit-reason>
```

The command rejects provider-active causes, stale versions, and duplicate overrides. A newer adverse event automatically invalidates the override.

Local replay resets only the original durable inbox event; it never sends email:

```bash
node ../deploy/replay-webhook-event.js <event-id> <platform-operator-actor> <audit-reason>
```

Disable/delete require exact endpoint-ID confirmation. Delete refuses while inbox work is nonterminal unless a nonempty audited break-glass reason is provided:

```bash
node ../deploy/manage-resend-webhook.js disable <common-options> --confirm <endpoint-id>
node ../deploy/manage-resend-webhook.js delete <common-options> --confirm <endpoint-id>
```

## Monitoring

Confirm the SNS email subscription. Environment-only alarm dimensions cover heartbeat, oldest pending/retry, one-hour and 24-hour unmatched age, dead letters, invalid signatures, suppression reconciliation, payload purge, uncertain-plus-quota-disable, and the 18-hour provider canary. Missing gauge data breaches. Logs/EMF must never contain addresses, subjects, payloads, signing headers, or secrets.

## Compatible rollback

Normal order:

1. Record whether processing is enabled, then disable it with the revision-fenced script.
2. Leave ingestion and suppression enforcement active.
3. Redeploy only an artifact whose capability marker passes.
4. Verify exact-release API and both worker heartbeats.
5. Restore the prior processing state against the new release/control revision.

If no compatible artifact exists, do **not** start a Phase 1 binary. Use `set-email-sending.js false <control-revision> <actor> <reason>` to acquire the global provider boundary and durably disable application mail, wait for in-flight provider calls to drain, verify every worker and synchronous sender is fenced, disable the provider endpoint, then stop API/workers. Additive schema remains in place.
