# Phase 2 Resend Webhook and Suppression Investigation

Status: implementation planning complete; staging registration authorized; Resend upgrade required before production registration  
Parent plan: `docs/plan/survey-lifecycle-email-delivery.md`  
Scope: provider delivery truth, durable webhook ingestion/projection, suppression, reconciliation, dashboard presentation, and operations. Open/click engagement tracking is excluded.

## 1. Executive conclusion

The Phase 1 design is a suitable foundation for Phase 2. It already provides stable delivery UUIDs, unique provider message IDs, independent provider-outcome timestamps, durable worker patterns, dispatch/provider separation, and provider-boundary fencing.

Phase 2 can proceed additively. It must not reinterpret `accepted` as `delivered`, alter dispatch progress arithmetic, resend mail while replaying a webhook, or make the webhook signing secret a prerequisite for Phase 1 operation.

A secure API inspection confirmed that staging and production use distinct API keys belonging to the same Resend team (both keys return the same API-key set) and that the team currently has zero webhook registrations. No secret values or identifiers were printed or retained. The team is currently on Resend Free, which permits one webhook endpoint. The approved decision is to use that endpoint for staging validation, then upgrade before production so staging and production can retain separate endpoints and secrets.

## 2. Verified provider contracts

### Delivery guarantees

Resend documents:

- HTTPS JSON webhook requests.
- At-least-once delivery; duplicates are possible.
- `svix-id` is the durable deduplication identity.
- Delivery order is not guaranteed.
- Event `created_at` should be used for event ordering, not arrival time.
- Automatic attempts occur immediately, then after 5 seconds, 5 minutes, 30 minutes, 2 hours, 5 hours, 10 hours, and another 10 hours.
- Failed and successful messages can be manually replayed from the Resend dashboard.
- Continued endpoint failures can cause Resend to disable the endpoint.

Therefore the receiver must acknowledge only after a verified event is durably inserted. A valid duplicate returns `200`. A database failure returns non-2xx so Resend retries.

### Signature verification

Resend requires the exact raw payload and these headers:

- `svix-id`
- `svix-timestamp`
- `svix-signature`

The repository pins `resend` 6.18.1. Its documented `resend.webhooks.verify()` implementation uses `standardwebhooks` 1.0.0, the same underlying verifier used by the current Svix package. The standard verifier rejects timestamps more than five minutes in the past or future.

Decision:

- Use the pinned Resend SDK's public `webhooks.verify()` API.
- Do not add the broader `svix` client solely for verification.
- Contract-test valid, mutated, stale, future, missing-header, and wrong-secret fixtures.
- Mount `express.raw({ type: 'application/json', limit: '256kb' })` for the webhook route before the global `express.json()` middleware. Resend publishes no maximum; 256 KiB is a conservative local bound for the selected metadata-only events and must be validated against captured staging payloads before production.
- Never log raw payloads, signing headers, full recipient addresses, or secrets.

### Selected event set

Subscribe only to:

1. `email.sent`
2. `email.delivered`
3. `email.delivery_delayed`
4. `email.bounced`
5. `email.complained`
6. `email.failed`
7. `email.suppressed`
8. `suppression.added`
9. `suppression.removed`

Do not subscribe to `email.opened`, `email.clicked`, inbound-email, contact, domain, or scheduled-email events.

`email.sent` is useful even though Phase 1 records API acceptance: it can reconcile a delivery whose local provider call ended as uncertain. `email.failed` is a provider failure outcome associated with an email but does not itself prove prior API acceptance; it must not trigger an automatic resend.

### Payload and correlation

Outbound email events include:

- top-level `type` and `created_at`
- `data.email_id`, which corresponds to the Resend send result ID
- `data.to`
- event-specific details
- optional `data.tags` as an object; legacy and non-survey sends may have no tags

Send-time tags are an array of `{ name, value }`; webhook tags are returned as an object. Resend permits up to 75 tags, with names and values restricted to ASCII letters, numbers, underscores, and dashes and bounded to 256 characters.

Decision: add these non-secret tags to every Phase 2 survey delivery:

- `app=network_survey`
- `environment=<bounded environment>`
- `delivery_id=<delivery UUID>`

Correlation order:

1. `data.email_id` to unique `survey_email_deliveries.provider_message_id`
2. `data.tags.delivery_id` to delivery UUID
3. otherwise retain as unmatched for reconciliation

Never correlate by recipient, subject, RFC message ID, or timestamps. Validate that a tag-correlated delivery belongs to the expected application/environment and that the provider email ID does not conflict with another delivery.

Staging and production endpoints on a shared Resend team may receive the same account-level event stream. Environment tags allow an endpoint to durably acknowledge but ignore foreign-environment survey email events. Account-level `suppression.added` events must still be applied in every sending environment that shares the provider suppression list. This behavior must be confirmed with a real shared-team staging registration.

## 3. State model and event semantics

### Dispatch remains separate

The existing mutually exclusive dispatch dimension remains:

- pending
- leased/sending
- retrying
- accepted
- failed
- uncertain
- cancelled

Provider projections are an independent dimension. They never enter the dispatch-progress denominator or sum.

Acceptance evidence is event-specific. A correlated `email.sent` explicitly proves that the API request succeeded. Correlated delivered, delayed, bounced, complained, or email-suppressed events prove that Resend processed that specific email far enough to establish acceptance. `email.failed` does not safely prove API acceptance because Resend documents API-key, domain, recipient, and quota causes; it records provider failure but leaves a locally uncertain dispatch uncertain. Account-level `suppression.added` and `suppression.removed` never prove anything about a delivery. When acceptance is proven, append-only attempt history preserves the earlier local uncertainty.

### Provider occurrence timestamps

Keep each provider fact independently. For repeated events, store the earliest verified provider occurrence with `LEAST(existing, event_created_at)`. Preserve `received_at` in the inbox separately. Never erase a provider fact because an older or lower-precedence event arrives later.

Recommended effective presentation precedence:

1. complained
2. bounced
3. suppressed
4. provider failed
5. delivered
6. delayed
7. sent/dispatch accepted
8. current dispatch state

Precedence is presentation only; all timestamps remain queryable. A complaint may legitimately coexist with delivered because complaint occurs after delivery.

### Event-specific effects

- `email.sent`: prove provider acceptance; no delivery claim.
- `email.delivered`: set delivered occurrence.
- `email.delivery_delayed`: set delayed occurrence; later delivery remains visible as delivered.
- `email.bounced`: set bounce occurrence and activate local permanent-bounce suppression.
- `email.complained`: set complaint occurrence and activate local complaint suppression.
- `email.failed`: set provider-failed occurrence; preserve an already accepted dispatch, leave an uncertain dispatch uncertain, and do not automatically resend.
- `email.suppressed`: set provider-suppressed occurrence and activate local provider suppression.
- `suppression.added`: activate account-level local suppression using `data.email`, `origin`, `source_id`, and event time.
- `suppression.removed`: record provider removal, but remain locally fail-closed until an audited platform-operator override. This prevents an out-of-order or accidental provider removal from silently re-enabling mail.

Unknown verified event types or additive fields are durably stored and acknowledged, then marked ignored. A malformed known event is dead-lettered rather than causing provider retries forever after durable receipt.

## 4. Additive database design

Create a new changelog after v1.6; never modify the already-deployable v1.6 changeset.

### `email_webhook_events`

Required fields:

- provider account scope and receiving environment
- unique `svix_id`
- event type and provider event time
- provider message ID and delivery tag when available
- bounded raw JSON payload, received time, and `payload_expires_at`
- status: pending, leased, retry_wait, processed, unmatched, ignored, dead_letter
- processing attempt count and next attempt
- lease owner, random lease token, lease expiry
- bounded error code/message
- correlated delivery ID when found
- processed/dead-letter timestamps
- replay count, last replayed time, and audited replay actor where applicable

Required constraints/indexes:

- unique provider + `svix_id`
- due-work and expired-lease partial indexes
- provider-message-ID and delivery-tag reconciliation indexes
- retention deadline index
- state/lease consistency checks
- bounded diagnostic columns

### `email_suppressions`

Suppression is provider-account/address scoped, not organization scoped, because a shared Resend team suppresses the address for all sends.

Store independent live causes keyed by `(provider_account_scope, normalized_address, reason)`, where reason is permanent bounce, complaint, or provider suppression. Effective suppression is `EXISTS` any active, non-overridden cause; one cause can never clear another.

Required fields per cause:

- stable provider-account scope identifier, configured identically in every environment sharing the Resend team; receiving environment is audit metadata, not suppression identity
- normalized address and reason
- provider-active state
- source webhook event/provider suppression ID
- source occurrence time
- last add/remove occurrence time and event ID
- locally overridden time, cause-version, and platform-operator actor
- created/updated timestamps

Use event occurrence time to prevent an older out-of-order event from replacing newer state for the same cause; at equal timestamps, adverse add wins over removal and event ID breaks ties between equal event types. Every newer adverse event clears an override for that cause. A provider removal changes only the provider-suppression cause and records provider-active=false; permanent-bounce and complaint causes remain blocked. Local enforcement for a removed cause remains active until a platform operator overrides that exact latest cause version; an override is rejected while provider-active=true and is automatically invalidated by a later adverse event. Preserve immutable suppression audit history in a companion history table or append-only audit table.

Address normalization must match delivery normalization used by Phase 1: trim and lowercase. Do not attempt correlation or suppression from unverified arbitrary recipient data.

### Existing delivery changes

The Phase 1 table already has provider timestamps. Add only what is needed for precise projection, such as a provider-sent occurrence if retained and indexes for provider outcome aggregation. Do not overwrite old accepted deliveries that have null provider outcomes; present them as accepted/unverified.

## 5. Processing and reconciliation

### Ingress transaction

1. Enforce the ingestion gate. Before registration, disabled returns `503`; after registration, ingestion is treated as an always-on compatibility capability and the endpoint must be disabled/removed at Resend before this gate is turned off.
2. Read the raw body with the 256 KiB limit.
3. Verify signature and five-minute timestamp tolerance.
4. Validate bounded top-level metadata without rejecting additive unknown fields.
5. Insert by `svix-id` in one short transaction.
6. Return `200` after insertion or when the verified ID already exists.
7. Return `400` for invalid signatures/headers, `413` for oversized input, and `503` for database unavailability.

The HTTP handler performs no delivery projection and no provider call.

### Fenced projector

Use the existing delivery-worker pattern:

1. Claim due inbox rows with `FOR UPDATE SKIP LOCKED`.
2. Assign owner, random lease token, expiry, and increment attempt count.
3. Commit before processing.
4. Correlate by provider ID then delivery tag.
5. Project under a delivery row lock, fenced by current event lease token.
6. When event-specific evidence proves acceptance, transition any pending/retry/uncertain/failed/cancelled delivery to accepted, preserve cancellation evidence, set provider ID and dispatch acceptance, clear retry/lease fields, and dual-write `Respondent.email_sent`. For a leased delivery, finish an in-progress attempt as accepted only when `provider_started_at` is set; otherwise finish that pre-boundary attempt as cancelled with `provider_acceptance_reconciled`. The sender's later lease-token finalizer then safely affects zero rows. `email.failed` alone performs no such transition.
7. Mark processed only in the same transaction as projection and the respondent dual-write.
8. A stale worker cannot project or finalize after lease loss.

Recommendation: run a dedicated `ona-email-webhook-worker` PM2 process with its own control and heartbeat namespace. This isolates projection from provider-send latency and permits pausing webhook projection without stopping Phase 1 dispatch. Deployment and rollback must verify both worker heartbeats once Phase 2 is enabled.

### Unmatched events

Unmatched is not immediately a processing failure:

- Retry with bounded exponential backoff and jitter.
- Wake likely matches when the delivery worker stores a provider message ID.
- Retry for seven days, then move to dead letter.
- Never correlate by PII heuristics.
- Foreign-environment events with explicit valid tags are processed as ignored, not unmatched.
- Keep dead-letter metadata after raw payload expiry.

Recommended transient processing policy: maximum 12 attempts or 72 hours for ordinary projector failures. Unmatched correlation uses the separate seven-day horizon.

### Replay

Provider replay may deliver the same `svix-id`, so it tests ingress durability and deduplication but does not force a second projection. Local replay is an audited operator action that resets processing state for the original stored event and creates a new processing attempt. Replay never creates a delivery or sends an email.

Initially expose replay as a platform-operator command, not a tenant-facing HTTP endpoint.

## 6. Suppression/send race fencing

A plain suppression query immediately before send is insufficient: suppression can commit between that query and provider invocation.

Add a deterministic address-level advisory boundary lock shared by suppression projection and the delivery worker.

Universal sender/projector lock order:

1. delivery-worker global provider-boundary lock when crossing a send boundary
2. worker control row when sending
3. Survey provider-boundary advisory lock when sending
4. Survey row when sending
5. delivery row
6. normalized-address advisory lock when suppression state is read or changed
7. suppression check
8. provider-boundary marker commit
9. provider invocation

A projector that already holds a delivery row may then acquire the address lock. No path may hold an address lock and then acquire a delivery, Survey, control, or global-boundary lock. The sender uses session-scoped `pg_advisory_lock` for the address on the same retained connection, commits the provider-boundary marker while retaining that lock, invokes `provider.send()` so network I/O has begun, then explicitly unlocks in `finally`. A transaction-scoped address lock is forbidden because commit would reopen the suppression-check/send race.

Suppression upsert acquires only the normalized-address lock, writes suppression, and commits. It must not hold that lock while later acquiring Survey/global locks. This avoids reverse-order deadlocks.

Linearization:

- If suppression obtains the address lock first, a later worker sees suppression and does not send.
- If the worker obtains it first, the provider boundary commits first; the message is honestly recorded as already crossed when suppression arrives.

For a correlated delivery event such as bounce, complaint, or email suppression, delivery outcome projection, the reason-keyed suppression upsert, event lease fencing, and event completion commit atomically under delivery-row then address-lock order. For account-level `suppression.added`/`removed` events without a delivery, the event transaction acquires only the address lock and commits the cause plus event completion. It never acquires a delivery afterward.

After an account-level suppression commit, or in a separate post-commit reconciliation pass for correlated events, reconciliation:

- cancels pending/retry-wait work for the address
- marks leased pre-call work cancellation-requested so its final check cancels it
- sets the suppression provider projection
- never rewrites accepted/uncertain evidence as unsent

Launch readiness should report suppressed recipients separately. A launch with no eligible recipients returns `422` and creates no launch. Partially suppressed audiences require an explicit product decision before Phase 3; for Phase 2 initial-launch compatibility, readiness should block rather than silently change the immutable audience.

## 7. API and dashboard contract

Add fields without renaming existing dispatch fields:

- provider outcome counts on launch/history/latest-launch responses
- provider occurrence timestamps and effective provider outcome on delivery details
- separate `dispatchStatus` and `providerOutcome` on targets
- retain legacy `emailStatus` temporarily for compatibility

Dashboard behavior:

- dispatch progress remains unchanged
- show delivered, delayed, bounced, complained, suppressed, and provider-failed as a separate summary
- never label accepted as delivered
- use text/icons as well as color
- continue low-frequency terminal polling for a documented reconciliation horizon, then require manual refresh
- display old null-outcome rows as accepted/unverified

Freeze the current launch replay contract: a newly created launch returns `202`; an exact replay returns `200` with the existing launch.

## 8. Configuration, infrastructure, and rollout

### Independent gates

Add three exact-true, default-off controls; do not reuse `SURVEY_DELIVERY_V2_ENABLED`:

1. `RESEND_WEBHOOK_INGEST_ENABLED` is release configuration. Disabled returns `503`, never `2xx`. It may be false before registration, but after registration it is an always-on compatibility capability: disable/remove the Resend endpoint first, then turn it off by redeploying.
2. `RESEND_WEBHOOK_PROCESSING_ENABLED` is stored in a new `email_webhook_worker_control` row and changed by a revision-fenced audited operator script. Processing may pause while ingestion continues.
3. `EMAIL_SUPPRESSION_ENFORCEMENT_ENABLED` is a database latch with activation time/actor/release. Before first activation it may be false. After activation it cannot be cleared by normal tooling while any application mail path remains enabled; compatible releases must continue enforcing known suppression.

Add dedicated webhook control and heartbeat tables containing environment, claiming/processing state, minimum release, release revision, worker instance, freshness, bounded last error, update actor/reason, and startup time. Deployment health requires a fresh heartbeat for the exact deployment instance even when processing is intentionally paused. Operator changes use the same revision/fresh-heartbeat safeguards as Phase 1 claiming control.

Also add one audited environment-wide `EMAIL_SENDING_ENABLED` database control checked by the delivery worker and every synchronous demo/account/invite/reset provider path under the shared provider-boundary fence. It defaults off in hosted environments until explicitly enabled. Break-glass can therefore stop all application-originated provider calls, not only survey delivery claiming.

### Secrets and IAM

Add per-environment `RESEND_WEBHOOK_SECRET_PARAMETER` and optional `RESEND_WEBHOOK_PREVIOUS_SECRET_PARAMETER` paths and permit the EC2 role to read only those environment-specific SSM parameters. Do not expose secret values through Terraform state, workflow output, logs, or chat. The verifier tries the primary secret and then the previous secret; it emits only a bounded `verified_with_previous` metric.

Rotation procedure:

1. copy the current primary secret to the previous-secret SSM parameter in process memory without printing it;
2. create the replacement registration, immediately set it disabled, and recover its secret through the documented retrieve/list API if the script is interrupted;
3. write the replacement secret to primary SSM, deploy, and prove fixtures for both loaded secrets;
4. enable the replacement endpoint while leaving the old endpoint enabled for a 36-hour overlap, exceeding Resend's documented automatic retry schedule;
5. disable/delete the old endpoint, clear previous-secret SSM, and redeploy.

Creation uses the real endpoint while ingestion returns non-2xx until the secret is loaded, so a narrow create/disable race is retryable rather than silently acknowledged.

If Resend supports an in-place signing-secret rotation by implementation time, the same primary/previous overlap applies without a second endpoint. Endpoint-count limits make provider-plan confirmation necessary first.

### Registration ownership

Implement a dedicated idempotent operator script, rather than a Terraform resource that could store the signing secret in Terraform state. The script:

- requires explicit environment, expected public URL, provider-account scope, and exact event-set hash;
- snapshots the complete pre-operation endpoint-ID set and records it with an operation ID before provider creation;
- creates only the selected environment registration, immediately disables it during bootstrap, and retrieves its signing secret through the documented get/list API on recovery;
- on recovery, computes the post-minus-pre endpoint set and accepts exactly one matching newly created endpoint; if multiple candidates exist it disables all candidates and requires an audited operator selection rather than guessing;
- writes the signing secret directly to SSM and never stdout/stderr, then reconciles provider registration, SSM version, and control record on every rerun; crash-point tests cover every boundary from pre-snapshot through final control commit;
- stores non-secret endpoint ID, URL hash, event-set hash, provider-account scope, actor, and update time in an audited control record;
- supports status, disable, and delete as separate confirmation-required operations;
- refuses deletion while unprocessed inbox events remain unless break-glass is explicitly audited.

Provider endpoint ID is non-secret; the signing secret exists only in SSM/runtime memory.

### Payload retention

Recommended default:

- raw webhook payload: 30 days, configurable
- processed/dead-letter metadata and provider projections: retained with survey delivery history
- a daily webhook-worker maintenance task claims batches of at most 100 expired rows with `FOR UPDATE SKIP LOCKED`; nonterminal expired rows are first dead-lettered with `payload_expired`, then raw payload is nulled in the same transaction
- purge clears raw payload for every expired row; it never deletes deduplication identity, audit metadata, or projections; failures retry on the next maintenance pass and raise an alarm

Resend pricing currently advertises 30-day provider data retention on Free/Pro/Scale, but does not document a guaranteed webhook replay window. Local retention must therefore be authoritative for the configured period.

### Monitoring

Phase 2 adds CloudWatch log groups/retention and the CloudWatch agent on the API host. Every 60 seconds the webhook worker queries current gauges and emits CloudWatch Embedded Metric Format records with stable Environment-only alarm dimensions; release revision is a non-dimension diagnostic property and may also be emitted in a separate non-alarm metric stream. The agent forwards them. Missing heartbeat/gauge data is treated as breaching. API/workers also emit bounded counter records. No address, subject, raw payload, signature, or secret appears in these records.

Initial alarm defaults:

- webhook heartbeat absent for two consecutive 60-second periods: alarm
- oldest pending/retry event over 5 minutes for two periods: alarm
- unmatched event over 1 hour for two periods: warning; over 24 hours for one period: alarm
- dead-letter count at least 1 for one period: alarm
- invalid-signature count over 10 in 5 minutes: alarm
- suppression reconciliation or purge failure at least 1 for one period: alarm
- existing uncertain delivery count at least 1 and quota-triggered claiming disable for one period: alarm
- controlled provider canary absent for 18 hours: alarm

Use an environment-specific SNS topic supplied by Terraform variable for notification routing. Staging may initially use an operations email subscription; production routing must be explicitly approved before production enablement.

Organic webhook silence is not meaningful for a low-volume application. A webhook-worker-owned database singleton schedules and leases one canary every 6 hours per environment, reserves shared provider rate, and sends to `delivered+webhook-canary-<environment>@resend.dev` with app/environment/canary tags. The correlated real event completes the canary row; lease/send/project failures emit the canary metric. A locally signed fixture tests only local verification and is not a registration/routing canary.

### Rollout order

1. Apply additive schema.
2. Deploy route, projector, tags, controls, and suppression checks with Phase 2 gates off; startup does not require a webhook secret while ingestion is off.
3. Verify API and both worker heartbeats.
4. Use the currently available Free-plan endpoint for registration bootstrap: create the staging endpoint, immediately disable it, write its secret to SSM, and reconcile the control record.
5. Redeploy with the secret parameter and ingestion gate enabled; verify secret readability with a local signed fixture.
6. Enable the Resend endpoint only after step 5 passes.
7. Test signed ingress, duplicate IDs, mutation, stale timestamp, oversize, and DB failure.
8. Enable projection and test provider-ID/tag correlation, out-of-order events, and unmatched reconciliation.
9. Enable suppression enforcement and run the suppression-boundary race test.
10. Exercise dead-letter, local replay, raw-payload purge, and rollback.
11. Use Resend test recipients (`delivered@resend.dev`, `bounced@resend.dev`, `complained@resend.dev`, and `suppressed@resend.dev`) for controlled staging evidence.
12. Repeat for production only after endpoint capacity, alarms, and rollback floor are confirmed.

Every Phase 2 artifact includes `deploy/CAPABILITIES.json` with `webhook_ingest`, `webhook_projection`, `suppression_enforcement`, and schema capability versions. Deployment records the minimum compatible capability/release in webhook control when registration or suppression is enabled. Remote deploy and rollback validate the marker and database minimum before changing the `current` symlink.

After registration, normal rollback may target only an artifact with compatible raw ingestion. After suppression activation, normal rollback may target only an artifact with compatible suppression enforcement. A Phase 1 artifact is rejected even if its files happen to exist. Ordered rollback is: pause projection, leave ingestion and suppression active, deploy a compatible artifact, verify exact-release API and webhook-worker heartbeat, then restore prior processing state. If no compatible artifact exists, break-glass atomically sets `EMAIL_SENDING_ENABLED=false` under the global provider-boundary fence, waits for all environment provider-boundary locks/in-flight calls to drain within a bounded timeout, verifies all worker and synchronous sends are fenced, disables the provider endpoint, and then stops API/workers. It does not run an unsafe Phase 1 binary. Additive schema is never reversed.

## 9. Required acceptance tests

### Ingress

- valid exact-byte signature accepted
- one-byte mutation rejected
- stale/future timestamp rejected
- missing and malformed headers rejected
- wrong environment secret rejected
- payload over 256 KiB rejected
- duplicate `svix-id` returns 200 and creates one row
- database failure returns non-2xx and retry later succeeds

### Projector

- distinct workers claim distinct events
- expired lease reclaim and stale-token fencing
- provider-ID correlation
- webhook-before-provider-ID persistence correlation by delivery tag
- foreign-environment tag ignored safely
- duplicate and out-of-order events preserve all facts and precedence
- malformed known event dead-letters without corrupting delivery state
- only correlated sent/delivered/delayed/bounced/complained/email-suppressed evidence resolves uncertain dispatch; email.failed and account suppression events do not
- provider outcomes never alter dispatch progress arithmetic

### Suppression

- bounce, complaint, email suppression, and suppression.added activate suppression
- older add/remove cannot replace newer state
- suppression.removed remains locally blocked pending audited override
- suppression committed before the address boundary prevents provider invocation
- boundary crossed before suppression is recorded honestly
- pending/retry work cancels; stale workers cannot overwrite cancellation
- all-targets-suppressed launch creates no work
- staging and production/shared-account behavior is explicitly exercised

### Operations/UI

- dead-letter and audited replay
- raw payload purged while metadata/projection remains
- worker restart/reclaim
- processing pause does not stop durable ingestion
- suppression remains enforced during safe rollback
- separate provider summary is accessible and never calls accepted delivered

## 10. Remaining decisions and external confirmations

No policy confirmation remains before local implementation or staging registration. The user authorized the controlled staging test, and the Free plan's single currently unused endpoint is sufficient for it.

Required before production enablement:

1. Upgrade the shared Resend team from Free to a tier supporting at least two endpoints.
2. With staging registered, create the production endpoint disabled, then temporarily enable both to observe whether both same-team endpoints receive every matching event and validate environment-tag routing/account-level suppression behavior.
3. Finalize platform-operator principals authorized for replay and suppression override. Account emails and GitHub identities may be supplied later.

Approved decisions:

- Initial operational alert subscription: `bgarcia2324@gmail.com`.
- Alert recipients are Terraform/SNS configuration, allowing a different alert service later.
- Infrastructure alerts remain platform-operator notifications. Future survey-level delivery summaries may separately notify organization owners/site administrators after account email coverage and notification preferences are designed; shared infrastructure alarms must not disclose platform state to tenant owners.
- Raw webhook payload retention: 30 days.
- Controlled Resend staging routing/test-recipient activity: authorized.
- Resend endpoint strategy: staging on the current Free endpoint; upgrade before production to preserve separate staging/production endpoints.

Recommended defaults if no contrary requirement is supplied:

- existing Resend SDK verifier
- selected nine-event subscription
- 256 KiB raw body limit
- dedicated webhook worker
- three independent default-off gates
- 30-day raw payload retention
- 12 attempts/72 hours for processor failures
- seven-day unmatched horizon
- fail-closed suppression removal with platform-operator override
- separate staging/production endpoints and SSM secrets

## 11. Primary sources

- Resend webhook introduction and guarantees: https://resend.com/docs/webhooks/introduction
- Signature verification: https://resend.com/docs/webhooks/verify-webhooks-requests
- Retries and replay: https://resend.com/docs/webhooks/retries-and-replays
- Event types: https://resend.com/docs/webhooks/event-types
- Email bounce payload: https://resend.com/docs/webhooks/emails/bounced
- Email suppression payload: https://resend.com/docs/webhooks/emails/suppressed
- Suppression added: https://resend.com/docs/webhooks/suppressions/added
- Suppression removed: https://resend.com/docs/webhooks/suppressions/removed
- Tags and webhook tag projection: https://resend.com/docs/dashboard/emails/tags
- Webhook creation API: https://resend.com/docs/api-reference/webhooks/create-webhook
- Safe test recipients: https://resend.com/docs/knowledge-base/what-email-addresses-to-use-for-testing
- Resend endpoint limits/data retention: https://resend.com/pricing
- Svix verification/timestamp behavior: https://www.svix.com/guides/receiving/receive-webhooks-with-javascript-nodejs/
