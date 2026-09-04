# Survey lifecycle and reliable email delivery plan

**Status:** Proposed implementation plan
**Branch:** `plan/survey-lifecycle-email-delivery`
**Scope:** API, PostgreSQL/Liquibase, background worker, dashboard UX, deployment, and operations

## 1. Outcome

Replace the current meaning of “Start Survey” (fire asynchronous email calls and immediately report success) with two explicit, durable concepts:

1. **Survey lifecycle** — a survey is `draft`, `active`, or `closed`; archive remains a separate soft-delete state.
2. **Survey launch and delivery history** — every initial launch, reminder, recipient, provider attempt, and known outcome has a durable record.

The API will return `202 Accepted` after it atomically creates a launch and delivery rows. It will not claim that email was delivered. A PostgreSQL-backed worker will send queued messages, survive process restarts, retry transient failures, and expose progress to the dashboard.

## 2. Current-state findings

### Backend and data

- `POST /api/startSurvey` calls `startSurvey()` and returns `200 "Survey started successfully"`.
- `startSurvey()` calls `sendMail()` inside `respondents.forEach()` without awaiting those promises. The HTTP response can therefore precede all provider results.
- The process-global `emailQueue` is not durable. An API restart loses queued work.
- The database client opened by `startSurvey()` is not released.
- The Resend SDK returns `{ data, error }`; bulk survey sending treats any resolved promise as success and does not consistently inspect `error`.
- Application-only `surveyName` metadata is mixed into the object submitted to Resend instead of being kept locally or sent through documented provider tags.
- Missing language templates can throw only after earlier recipients have already been queued, producing a partial launch.
- Repeated starts resend to every eligible respondent. There is no idempotency key, initial-launch uniqueness, or concurrent-launch guard.
- `Respondent.email_sent` is a single boolean updated by recipient address and legacy survey name. It has no attempt time, provider ID, failure, retry, delivery, bounce, or complaint semantics.
- The current source-regex test for `email_sent` does not test asynchronous correctness.

### Lifecycle

- `Survey` has creation and archive timestamps but no draft/active/closed state, starter, start time, closer, or close time.
- Respondent tokens can load/submit without a lifecycle gate; archiving is the only survey-level availability concept.
- Questions, recipients, and templates remain mutable after invitations may have been sent.

### Dashboard

- `SurveyTableMenuCell` shows a simple confirmation and success/error Snackbar.
- There is no readiness preview, duplicate-click protection, queued/sending progress, partial-failure state, launch history, or retry flow.
- `RespondentTable.status` is response completion only; there is no independent email status.
- “Send Reminder” uses `/api/testEmail`, browser `alert()`, and has no durable history.

### Deployment

- The app is one Node API process under PM2 on one EC2 instance, with private RDS PostgreSQL.
- Liquibase runs before PM2 activation. Existing changelog file paths are migration identities and must not change.
- PostgreSQL is the lowest-risk durable queue: it permits transactional launch creation without adding Redis/SQS. SQS would still require a transactional outbox to bridge the database commit.

## 3. Product semantics

### Survey lifecycle

Lifecycle and archive are separate:

| State | Meaning | Allowed respondent behavior | Admin behavior |
|---|---|---|---|
| `draft` | Configuration is not live | Public respondent token denied | Questions, templates, recipients editable; initial launch allowed |
| `active` | Respondent collection is open | Load and submit allowed | Definition/configuration locked; reminders and retries allowed; close/archive allowed |
| `closed` | Collection intentionally ended | New loads/submissions rejected | Results/history readable; reopen or archive allowed |
| archived (`archived_at`) | Soft-deleted overlay | Rejected | Existing archive authorization remains; data/history retained |

MVP transitions:

- `draft -> active`: only through a successful **transactional enqueue** of the one initial launch.
- `active -> closed`: editor-or-higher explicit close action. In the same transaction, cancel all `pending`/`retry_wait` deliveries and request cancellation of leased work.
- `closed -> active`: explicit admin/owner reopen action with audit event. Cancelled launch work is never silently resumed.
- Any non-archived state may be archived under existing admin/owner rules. Archive uses the same delivery-cancellation behavior as close.

The survey becomes `active` when the launch transaction commits—not when all mail is delivered. Respondent links are then valid while delivery progresses. If all sends ultimately fail, the survey remains active and the dashboard shows the launch failure truthfully.

An already accepted provider request cannot always be recalled. Close/archive stops unclaimed work, sets `cancellation_requested_at` on leased rows, and makes the worker recheck immediately before provider I/O. A request already crossing the provider boundary is recorded honestly; its link will be unusable after close/archive.

### Mutation and locking policy

For MVP, questions, email templates, respondent identity/address/language, and token-bearing identity are locked while active or closed. This preserves the meaning of the launched survey and its response keys. Automatic delivery retries use immutable launch snapshots.

Every configuration mutation (`/updateEmails`, `/updateTarget`, `/updateTargets`, `/updateQuestions`, `DELETE /user`, `DELETE /question`, and survey-editor save paths), launch, close, reopen, and archive operation must use a transaction, lock the Survey row `FOR UPDATE` in one documented lock order, then check lifecycle/archive state before writing. This prevents a mutation that began while draft from committing after activation. All rejected mutation paths return stable `409 survey_not_editable` responses.

Respondent submission performs token lookup, lifecycle check, schema validation, and response write in one transaction while holding a Survey `FOR SHARE` lock; close/reopen/archive use `FOR UPDATE`. Two-connection integration tests prove close cannot race a response into a closed survey.

Adding or changing live recipients/configuration later requires explicit versioning and is deferred. Reminders do not mutate the launched audience; when added in Phase 3, they create a new reminder launch for selected existing respondents.

### Email terms

Use precise labels:

- **Queued:** committed locally and awaiting a worker.
- **Accepted:** Resend accepted the API request and returned a provider message ID.
- **Delivered:** Resend reported mail-server delivery through a verified webhook.
- **Failed:** a permanent provider/application failure or exhausted retries.
- **Uncertain:** provider acceptance may have occurred, but the result could not be reconciled safely.

Never label `accepted` as `delivered` or show “survey started successfully” as proof of email delivery.

## 4. Additive data model

Create `db/changelogs/v1_6_survey_lifecycle_email_delivery.sql` and append it to `master-changelog.xml`. Do not edit prior changelogs or rename their recorded paths.

### Survey additions

- `lifecycle_status TEXT NOT NULL DEFAULT 'draft'` with check: `draft | active | closed`
- `started_at TIMESTAMPTZ NULL`
- `started_by_user_id INTEGER NULL REFERENCES users(id)`
- `closed_at TIMESTAMPTZ NULL`
- `closed_by_user_id INTEGER NULL REFERENCES users(id)`
- `lifecycle_version INTEGER NOT NULL DEFAULT 0` for optimistic transition checks

Before new FKs target `Survey.id`, promote it from a nullable column with a partial unique index to a stable key in separate Liquibase changesets:

1. preflight/backfill null IDs and fail on duplicates/orphaned `survey_id` values;
2. add `CHECK (id IS NOT NULL) NOT VALID`, then validate it;
3. build a non-partial unique index with `CREATE UNIQUE INDEX CONCURRENTLY` in a `runInTransaction:false` changeset;
4. in a brief-lock changeset with explicit `lock_timeout`/`statement_timeout`, set `NOT NULL`, attach a unique constraint using that index, and then remove the temporary check/obsolete partial index.

Document cleanup for a failed concurrent index. Liquibase's changelog lock does not block application writes, so this sequence must be tested under concurrent traffic against a production-shaped database. Do not drop `Survey.name` or legacy name columns.

Promote/validate `Survey.organization_id` and `Respondent.survey_id` before enforcing tenant FKs. New tables use `RESTRICT` history retention and composite integrity so IDs cannot cross tenants: launches reference `(Survey.id, organization_id)`, deliveries reference `(launch_id, survey_id, organization_id)`, and deliveries reference `(Respondent.respondent_id, survey_id)`. Quarantine/report legacy orphans rather than silently deleting them.

### `survey_launches`

One durable campaign/run:

- `id UUID PRIMARY KEY DEFAULT gen_random_uuid()`
- `survey_id UUID NOT NULL`
- `organization_id UUID NOT NULL REFERENCES organizations(id)`
- `kind TEXT NOT NULL`: `initial | reminder | retry_failed`
- `parent_launch_id UUID NULL REFERENCES survey_launches(id)`
- `idempotency_key TEXT NOT NULL`
- `request_fingerprint TEXT NOT NULL`, computed from canonical organization ID, survey ID, kind, parent launch ID, and sorted target IDs
- `requested_by_user_id INTEGER NOT NULL REFERENCES users(id)`
- `created_at`, `cancelled_at` as `TIMESTAMPTZ`

Launch status, counts, first-attempt `startedAt`, and terminal `finishedAt` are **not correctness-critical cached columns**. Status APIs derive them authoritatively in SQL from indexed delivery/attempt rows. This avoids delivery -> launch lock reversal and a separate projector failure mode. Phase-2 provider outcomes are a separate aggregate dimension and are never summed into dispatch progress. If volume later requires materialization, add it only as a disposable cache with freshness monitoring.

Dispatch invariant:

`target = pending + leased + retry_wait + accepted + failed + uncertain + cancelled`.

Launch status is derived in this ordered, mutually exclusive sequence:

1. `queued`: every delivery is pending and no attempt has started;
2. `processing`: nonterminal work remains and at least one attempt has started;
3. `cancelled`: all deliveries are cancelled;
4. `completed`: all deliveries are accepted;
5. `failed`: all are terminal, none accepted, and at least one is failed or uncertain;
6. `completed_with_errors`: every other all-terminal combination (accepted mixed with failed/uncertain/cancelled).

Zero-target launches are forbidden. The status endpoint/list query applies these rules directly to delivery rows, so no stale projector can strand a launch.

Constraints/indexes:

- `Survey UNIQUE (id, organization_id)` supports `survey_launches (survey_id, organization_id) REFERENCES Survey(id, organization_id) ON DELETE RESTRICT`
- `survey_launches UNIQUE (id, survey_id, organization_id)` supports tenant-scoped delivery and parent references
- parent linkage is composite: `(parent_launch_id, survey_id, organization_id) REFERENCES survey_launches(id, survey_id, organization_id) ON DELETE RESTRICT`
- unique `(organization_id, idempotency_key)`; after authorizing the requested survey, an exact fingerprint replay returns the existing launch while a mismatch returns `409`
- unique initial launch per survey
- for future reminder/retry launches, the common Survey `FOR UPDATE` transaction checks authoritative delivery-derived status and rejects a second nonterminal run; no partial index depends on cached status
- indexes on `(survey_id, created_at DESC)` and `(organization_id, created_at DESC)`

### `survey_launch_templates`

Immutable template snapshot per launch/language:

- `launch_id UUID NOT NULL REFERENCES survey_launches(id) ON DELETE RESTRICT`, normalized `language`, `subject`, `body_text`, optional `template_hash`
- primary key `(launch_id, language)`

This prevents edits or retries from changing the launch payload. The initial subject may remain the current fixed subject until editable invitation subjects are implemented.

### `survey_email_deliveries` (transactional outbox)

One row per launch/respondent:

- IDs: `id UUID PRIMARY KEY`, `launch_id`, `survey_id`, `organization_id`, `respondent_id`
- immutable snapshots: normalized `to_address`, recipient display name, normalized language, sender, subject, template/version references, `survey_base_url`, `renderer_version`, and non-secret render inputs
- do **not** persist rendered HTML containing the raw bearer respondent UUID; resolve the locked respondent token only at send time. Rendering is deterministic. At enqueue, store a non-reversible hash of the exact expected provider payload; every retry reconstructs and compares it, refusing/marking uncertain on mismatch. Never return/log tokens, rendered bodies, provider payloads, or full addresses in aggregate APIs/logs.
- dispatch state: `pending | leased | retry_wait | accepted | failed | uncertain | cancelled`
- `provider_message_id`, deterministic `provider_idempotency_key`
- `attempt_count`, `next_attempt_at`, `lease_owner`, unique `lease_token`, `lease_expires_at`, `cancellation_requested_at`
- Phase-1 timestamps: `dispatch_accepted_at`, `dispatch_failed_at`
- independent Phase-2 provider timestamps: `provider_delivered_at`, `provider_delayed_at`, `provider_bounced_at`, `provider_complained_at`, `provider_suppressed_at`, `provider_failed_at`
- bounded/sanitized `last_error_code`, `last_error_message`
- `created_at`, `updated_at`

Constraints/indexes:

- `Respondent UNIQUE (respondent_id, survey_id)` supports `(respondent_id, survey_id) REFERENCES Respondent(respondent_id, survey_id) ON DELETE RESTRICT`
- `(launch_id, survey_id, organization_id) REFERENCES survey_launches(id, survey_id, organization_id) ON DELETE RESTRICT`
- unique `(launch_id, respondent_id)`
- unique provider message ID when non-null
- partial due-work index on `(next_attempt_at)` for `pending`/`retry_wait`
- partial reclaim index on `(lease_expires_at)` where status is `leased`
- history indexes `(survey_id, created_at DESC)` and `(respondent_id, created_at DESC)`

Provider outcomes are independent timestamps rather than a single monotonic state because webhooks are at-least-once and may arrive out of order. API presentation uses precedence such as complaint/bounce/suppression over delivered, then accepted.

### `survey_email_attempts`

Append-only diagnostics per provider call:

- `delivery_id UUID NOT NULL REFERENCES survey_email_deliveries(id) ON DELETE RESTRICT`, attempt number, lease token, started/finished time
- outcome (`in_progress | accepted | transient_failure | permanent_failure | uncertain | cancelled`)
- provider HTTP/error code and sanitized message
- provider message ID when known

The claim transaction increments/allocates the attempt and commits an `in_progress` row **before** network I/O. Finalization is fenced by delivery ID + current lease token. An expired unfinished attempt drives same-key reconciliation or an `uncertain` outcome rather than disappearing from history. Unique `(delivery_id, attempt_number)`. Do not store API keys, raw authorization headers, or unbounded exception payloads.

### Worker control and heartbeat

- `email_worker_control`: environment primary key, `claiming_enabled`, minimum allowed release, updated time/actor/reason. Launch readiness/enqueue rejects with `503 worker_unavailable` when claiming is disabled or no fresh compatible heartbeat exists.
- `email_worker_heartbeats`: environment + worker instance primary key, release revision, enabled/claiming state, `heartbeat_at`, bounded last error, startup time.

The worker updates heartbeat on a fixed interval; deployment requires a compatible heartbeat newer than the configured threshold. An operator script atomically changes the control row. Launch enqueue locks the environment control row `FOR SHARE` inside its transaction before locking the Survey; disabling claims takes `FOR UPDATE`, so no launch can commit after a completed disable operation. Global lock order is control -> Survey -> launch -> delivery. API and worker use least-required DB access where deployment permits; control changes are restricted and audited.

### Webhook and suppression tables (Phase 2)

- `email_webhook_events`: unique provider/Svix event ID, verified received time, event type, provider message ID, bounded raw payload with retention deadline; processing state, attempt count, next attempt, lease owner/token/expiry, bounded error, processed/dead-letter timestamps; due/reclaim indexes.
- `email_suppressions`: normalized address, reason (`permanent_bounce | complaint | provider_suppression`), source event, created/overridden timestamps and audited override actor.

### Legacy compatibility

- Keep `Respondent.email_sent` during rollout.
- Dual-write it to true only after provider acceptance, by stable respondent and survey IDs.
- Do not backfill new delivery rows from `email_sent`; historical detail cannot be reconstructed. Label it “legacy assumed accepted.”
- Retire the boolean only after all dashboard/API consumers use delivery records and a later migration is approved.

### Existing-survey backfill

Run and retain a pre-migration report. Recommended deterministic backfill:

- archived surveys -> `closed`
- non-archived surveys with any response or `email_sent=true` -> `active`
- other non-archived surveys -> `draft`

Before production rollout, review ambiguous rows. A compatibility override may mark selected legacy surveys active if links were distributed outside the system. This avoids inventing delivery history while preserving known live surveys.

## 5. Launch transaction and readiness

### Readiness checks

`GET /api/surveys/:surveyId/launch-readiness` (editor+) returns:

- lifecycle and archive status
- eligible/excluded recipient counts
- normalized languages and template coverage
- blockers and warnings with stable codes
- `canLaunch` capability

Block initial launch when:

- survey is not draft or is archived
- questions are absent/invalid
- there are no eligible `can_respond=true` recipients
- an eligible recipient has invalid email, missing UUID, or unsupported language
- two eligible respondent identities normalize to the same email (avoid sending conflicting respondent links)
- any used language lacks exactly one nonempty template
- survey URL, sender, Resend key, or required worker configuration is absent
- another launch is queued/processing

### Transactional enqueue

`POST /api/surveys/:surveyId/launches`, editor+, with `Idempotency-Key: <UUID>` and `{ "kind": "initial" }`:

1. Begin transaction; lock the environment `email_worker_control` row `FOR SHARE` without yet rejecting on availability, then lock the Survey row `FOR UPDATE`—in the declared global order.
2. Resolve organization authorization again inside the operation, preserving the current explicit platform-admin-as-owner override even when no membership row exists.
3. Canonicalize the request, compute its fingerprint, and resolve idempotency. An exact authorized replay returns the existing launch regardless of current worker health; a mismatch returns `409`.
4. Only for new work, validate claiming is enabled plus a fresh compatible heartbeat, then re-run readiness against locked/current data.
5. Create the launch and template snapshots.
6. Bulk-create one pending delivery per eligible respondent.
7. Transition survey `draft -> active`, set starter/time, increment version.
8. Insert `survey.launch_requested` and `survey.lifecycle_changed` audit events using a strict audit function that accepts this transaction's `pg` client; audit failure aborts the transaction. The existing best-effort `logAuditEvent()` is not used for lifecycle operations.
9. Commit; make no provider call inside the transaction.
10. Return `202 Accepted`, `Location` header, lifecycle status, launch ID, and counts.

Concurrent starts are prevented by the common Survey-row lock, initial-launch constraint, active-run partial index, and idempotency constraint. Database constraint errors are translated to stable `409` responses.

The dashboard persists the generated key across timeout/ambiguous errors instead of generating a new key on retry. If an initial launch already exists, an authorized request receives its ID/Location rather than an opaque conflict. Retain `POST /api/startSurvey` temporarily as a deprecated adapter: because old clients provide no key, it returns the authorized existing initial launch or creates one with a server-derived initial-launch business key. It must return `202` and the launch payload, not its current false completion response.

Add `Idempotency-Key` to CORS allowed headers, add `PATCH` to allowed methods for existing/new patch routes, and cover browser preflight. Apply configured dashboard `Origin`/CSRF enforcement to **all authenticated state-changing admin routes**, including lifecycle, questions, templates, targets, deletes, membership, invite, and reset operations; public respondent/demo-token routes use their separate token/rate-limit policy. Change production API sessions from `Domain=.bennetts.work` to a host-only secure cookie so sibling static hosts never receive the API session cookie. Rotate `SESSION_COOKIE_NAME`, explicitly expire the old cookie with the old `.bennetts.work` domain/path attributes, do not accept it, and require a controlled one-time re-login; test requests containing both old and new cookies plus dashboard/API cross-origin credentials.

## 6. Worker and Resend behavior

### Process model

Add a separate `ona-email-worker` PM2 process, sharing the release, environment, database pool utilities, and delivery-domain modules with the API. Refactor reusable mail/render/provider code out of `server.js` so importing worker code cannot start the HTTP server.

Pin and contract-test a Resend SDK version that demonstrably supports send idempotency (the current `^0.16.0` does not), or send the documented HTTP idempotency header directly. Add a maintained Svix-compatible verifier dependency for Phase 2; do not hand-roll signatures.

Use one PM2 ecosystem definition for API and worker. Update `scripts/deploy/remote-deploy.sh`, `.github/workflows/rollback-api.yml`, and local development scripts to install, start/restart, verify, stop, and save both processes. A deploy is not healthy merely because PM2 says online: the worker writes a fresh DB heartbeat with enabled/claiming state, release revision, and last error; deployment verifies it. Local scripts/documentation support starting API and worker together.

### Claim/send/update loop

1. Before every claim, check the database/runtime claiming kill switch.
2. In a short transaction, claim due rows using `FOR UPDATE SKIP LOCKED`; set owner, a new random fencing `lease_token`, bounded lease expiry, increment attempt count, and insert an `in_progress` attempt; then commit.
3. Acquire an environment-wide rate reservation shared with existing API/demo/account mail (a PostgreSQL-backed sliding-window reservation serialized by advisory lock), at its configured budget. If the budget is full, cancel and release the pre-provider worker attempt, durably defer that delivery to the database-computed next availability (or a bounded fallback if that availability is invalid or anomalously distant), release all provider/control locks, and only then pause the worker claim loop for the same bounded interval. This process-level backpressure prevents a continuously due backlog from turning one full rate window into per-delivery lease/attempt churn; the final transactional reservation remains authoritative across processes. If staging and production share one Resend team, configure fixed per-environment budgets whose total—including synchronous mail headroom—stays below the team limit, or use provider accounts with independent limits; separate environment databases alone cannot coordinate a team-wide quota.
4. Immediately before provider I/O, recheck the kill switch, current lease token, cancellation, survey active/non-archived state, launch state, and—after Phase 2—current suppression. Honour a strict provider timeout shorter than the remaining lease (or renew safely). Final-check outcomes are explicit:
   - kill switch/temporary worker disable: finish the pre-call attempt with outcome `cancelled` and bounded reason `worker_disabled_before_send`, release the lease to pending/retry-wait, and do not send;
   - close/archive/cancellation request: finalize dispatch as cancelled;
   - stale lease token: make no delivery/projection mutation;
   - current suppression: finalize the attempt and dispatch as cancelled with bounded reason `suppressed`, set `provider_suppressed_at`, and update both dispatch/provider projections.
5. Perform network I/O outside the transaction using deterministic provider idempotency key `survey-delivery/<delivery UUID>` and documented non-secret provider tags.
6. Explicitly inspect both Resend `{ data, error }`; require the provider message ID before marking accepted.
7. Finalize attempt/delivery only with `WHERE id=? AND status='leased' AND lease_token=?`; stale workers cannot overwrite reclaimed work. Finalization never locks/updates the parent launch; launch APIs derive authoritative aggregates from committed delivery rows. Finalization locks/reads `cancellation_requested_at`: when cancellation was requested, an accepted or genuinely uncertain boundary result is recorded, while a non-acceptance becomes `cancelled` and can never transition to `retry_wait`. Without a cancellation request, ordinary transient failures follow the retry policy and transition to `retry_wait`.
8. Reclaim expired leases using the dedicated partial index. Unfinished attempts remain visible and are reconciled with the same provider key or marked uncertain.

### Retry classification

- Retry: timeouts/resets, Resend 5xx, per-second 429, and safe concurrent-idempotency responses.
- Pause/operator action: plan quota exhaustion or provider outage.
- Permanent failure: invalid address/payload, unverified sender, invalid API key, authorization/security rejection, idempotency payload conflict.
- Never auto-resend after bounce, complaint, or suppression.

Use bounded exponential backoff with full jitter, honor `Retry-After`, cap attempts/age, and mark exhaustion failed. If the worker may have crossed the provider-acceptance boundary and cannot reconcile within Resend's idempotency window, mark `uncertain` rather than risk a duplicate invitation.

Exactly-once mailbox delivery is not promised. The design provides durable at-least-once processing with local and provider idempotency, and explicitly represents the unavoidable uncertain crash window.

## 7. Provider webhooks (Phase 2)

Add `POST /api/webhooks/resend` before JSON parsing for that route, using `express.raw({ type: 'application/json', limit: <small documented limit> })`:

- capture and verify the exact raw bytes with a supported verifier
- verify `svix-id`, bounded timestamp tolerance, and signature with an environment-specific SSM SecureString secret; never log signatures/raw payloads
- atomically insert with unique `svix-id` before returning success; valid duplicates return `200`
- return non-2xx when PostgreSQL is unavailable so Resend retries
- process projections asynchronously using the same fenced lease/retry pattern as delivery work, with bounded retention and a dead-letter/replay state

Correlate primarily by provider message ID and secondarily by a non-secret delivery-ID tag. Keep unmatched events for reconciliation because a webhook can arrive before the worker saves the provider ID. Track delivered, delayed, bounced, complained, and suppressed independently. Engagement events (open/click) are outside MVP unless explicitly requested.

Provision separate staging/production webhook endpoints and secrets. Add local suppression enforcement before future launches, with audited manual override. In Phase 2 the worker checks suppression again immediately before every provider call; newly suppressed unsent work atomically finalizes its in-progress attempt and dispatch as cancelled (reason `suppressed`), sets `provider_suppressed_at`, and updates both mutually exclusive dispatch and separate provider-outcome aggregates. Reconciliation and all-targets-suppressed tests cover this case.

## 8. API surface and authorization

Stable-ID, organization-scoped endpoints:

- `GET /api/surveys/:surveyId/launch-readiness` — editor+
- `POST /api/surveys/:surveyId/launches` — editor+
- `GET /api/surveys/:surveyId/launches` — viewer+ aggregate history
- `GET /api/surveys/:surveyId/launches/:launchId` — viewer+ aggregates; analyst+ recipient details
- `GET /api/surveys/:surveyId/deliveries?...` — analyst+, cursor pagination/filtering
- `POST /api/surveys/:surveyId/close` — editor+
- `POST /api/surveys/:surveyId/reopen` — admin/owner

Phase-3 additions (not exposed in Phase-1 UI):

- `POST /api/surveys/:surveyId/launches/:launchId/retry-failed` — editor+; creates immutable child launch
- `POST /api/surveys/:surveyId/reminders` — editor+, selected respondent IDs and new idempotency key

Cross-organization or unknown IDs return `404` to avoid existence disclosure. Server authorization is authoritative; frontend capabilities only mirror it. Preserve the current platform-admin override as owner-equivalent across the API and dashboard; tests cover platform admins without membership rows as well as normal organization roles.

Extend `GET /api/surveys` with lifecycle status and compact latest-launch aggregates. Extend `/targets` with separate `responseStatus`, latest `emailStatus`, and last attempt time. Do not combine response completion and email delivery.

Gate respondent question, status, lazy-choice, and submission routes on active/non-archived lifecycle. Submission uses the single locked transaction defined above—not an unprotected second read—to serialize against close/archive. Demo-token routes remain available for authorized demos of drafts and continue to avoid respondent results.

All configuration endpoint implementations listed in the locking policy move behind shared lifecycle-aware domain services; route handlers cannot call `insertUsers`, `insertEmails`, `insertQuestions`, or response writes outside those transactions. Archive also moves to this service so its audit insertion and queued-work cancellation commit atomically.

## 9. Dashboard MVP UX

Follow existing MUI/DataGrid/Dialog/Snackbar patterns rather than introducing a new design system.

### Survey table

- Add a compact lifecycle chip: Draft, Active, Closed.
- Add latest invitation summary such as `38 accepted / 42` and failed count.
- Menu action is lifecycle-aware:
  - Draft: **Launch Survey**
  - Active (Phase 1): **View Delivery Status**, **Close Survey**
  - Active (Phase 3): additionally **Send Reminder** and **Retry Failed**
  - Closed: **View History**, admin-only **Reopen Survey**
- Keep **Send Email Demo** separate; it does not affect lifecycle.

### `StartSurveyDialog` (new)

- Fetch readiness on open.
- Show exact eligible/excluded counts, language/template coverage, blockers, and the warning that real respondent links will be sent.
- Disable confirm for blockers/loading/submitting.
- Generate one stable idempotency key per launch intent; retain it across timeout/network/ambiguous errors and double-clicks. A deliberate fresh intent gets a new key.
- On `202` or an authorized existing-initial replay, say **Invitation launch queued** and navigate/show its status—never “emails delivered.”
- Keep provider/API errors visible and actionable.

### `SurveyLifecyclePanel` (new)

Render for the selected survey near the existing table/details:

- lifecycle chip and starter/start time
- latest launch status and text counts
- Phase-1 linear dispatch progress `(accepted + failed + uncertain + cancelled) / target`; provider outcomes are displayed separately in Phase 2 and never double-counted
- persistent partial-failure/uncertain/cancelled alert
- refresh action; editor retry-failed appears only in Phase 3
- compact prior-launch history table

Poll every 2–5 seconds only while queued/processing, using completion-triggered `setTimeout` (no overlapping requests). Cancel when selection changes/unmounts and stop at terminal status. Use text/icons in addition to color and an `aria-live="polite"` progress summary.

### Respondent table

- Rename current `Status` to **Response status**.
- Add **Email status** and **Last email attempt**.
- Remove/disable the current `/testEmail` **Send Reminder** action in Phase 1 so it cannot bypass durable history.
- In Phase 3, use Snackbar/Alert feedback and distinguish **Send reminder** from **Retry failed delivery**.
- Recipient-level errors/details require analyst+; future send/retry requires editor+.

### Accessibility/error states

- Label action buttons with survey/respondent context.
- Dialogs use descriptions, controlled focus, `aria-busy`, and visible `Alert` blockers.
- Never rely only on chip color.
- Show `409` duplicate/concurrent launch, `422` readiness, `429` throttling/quota, and `500/503` service errors distinctly.
- After every launch/close/reopen and each panel refresh, replace the selected survey object by stable ID from the latest `/surveys` response. Ignore stale poll responses after selection changes. Feed the same lifecycle/capability object to `SurveyTableMenuCell`, `QuestionTable`, `RespondentTable`, `EmailNotificationEditor`, and `SurveyEditor`; active/closed editor surfaces are read-only with an explanatory Alert.

## 10. Observability and operations

Before enabling production sending:

- structured logs keyed by environment, survey ID, launch ID, delivery ID, attempt, and provider ID; redact addresses/error payloads where possible
- dashboard/API visibility for oldest pending age, retry backlog, failed/uncertain count, and worker heartbeat
- alarms/runbook for worker offline, queue age, dead/uncertain deliveries, invalid key/sender, quota errors, and webhook silence
- integrity query/command that validates the dispatch invariant and authoritative derived launch statuses from delivery rows
- audited cancellation/retry/suppression override operations
- explicit retention: no rendered bearer-token HTML is persisted; redact template snapshots/recipient PII after the approved operational window, and purge bounded raw webhook payloads on a fixed configured deadline while retaining aggregate/attempt metadata

Confirm before production:

- `survey@cladvisors.com` domain verification and SPF/DKIM/DMARC ownership
- Resend plan quotas and whether staging/production share the team-level rate limit
- before Phase-2 production enablement, separate webhook registrations/secrets in SSM
- final snapshot/rollback path per repository data-preservation policy

## 11. Delivery phases

### Phase 0 — immediate correctness hardening

- Normalize Resend result checking across existing paths.
- Remove application-only properties from provider payloads.
- Replace/bypass the current queue with per-item completion promises for bounded test/reminder paths: each `sendMail` promise settles only after the provider result and legacy DB update. Merely awaiting the existing `rateLimitedSend()` is insufficient because it resolves immediately while another batch is processing.
- Always release DB clients and stop describing provider API acceptance as delivery.
- Add a server-enforced legacy-start kill switch. In staging/production, disable bulk `/startSurvey` before the lifecycle migration; do not hold an HTTP request open for an unbounded campaign or permit ambiguous client retries to resend everyone. Durable Phase 1 re-enables launch through the new adapter.
- Correct invitation rendering before reuse: remove Stripe/lorem-ipsum placeholders, use approved privacy/contact copy, escape stored template text under a plain-text/newline policy (or a separately approved allowlist sanitizer), and generate equivalent HTML and complete plain-text bodies containing the link. Test document language, meaningful logo alt text, descriptive link text, and token appearance only in the intended URL.
- Document `email_sent` as unreliable legacy state.

This ships as a separate safety release and becomes the minimum rollback release before schema activation.

### Phase 1 — lifecycle and durable launch MVP

- Add migration, lifecycle/domain service, template snapshots, delivery outbox, pre-call attempts, atomic audit events, request fingerprints, readiness, and authoritative SQL dispatch/status derivation.
- Add separate PostgreSQL worker, fenced leases, claiming kill switch, local/provider idempotency, automatic classified retries, global rate limiting, PM2 deployment, and DB heartbeat.
- Upgrade/pin and contract-test the Resend integration; add CORS idempotency and mutation Origin/CSRF handling.
- Replace `/startSurvey` with the launch service and return `202`.
- Gate respondent routes and lock every active-survey mutation/submission/lifecycle transition.
- Atomically cancel unsent work on close/archive.
- Add dashboard lifecycle/readiness/Phase-1 dispatch progress/history and separate respondent email status. Manual retries/reminders and suppression are not shown yet.
- Dual-write legacy `email_sent` only on provider acceptance.

### Phase 2 — delivery truth

- Add verified, fenced Resend webhook inbox/projection.
- Show delivered/delayed/bounced/complained states as a separate provider-outcome dimension.
- Enforce suppression, add `suppressed` presentation/outcome counts, and add reconciliation/replay runbooks.
- Phase-2 production enablement has its own webhook/signing/suppression gate; it does not block Phase-1 accepted/failed/uncertain production rollout.

### Phase 3 — reminders and broader mail consolidation

- Add selected reminders and immutable manual retry launches, their endpoints, dashboard actions, audit events, and phase-specific acceptance tests.
- Move demo, organization invite, and password reset mail onto the same durable service where transaction boundaries allow.
- Account for queue delay when issuing expiring demo/invite/reset tokens.

### Phase 4 — lifecycle versioning and cleanup

- Add versioned survey definitions/audiences if live editing after launch is required.
- Replace long-lived raw respondent tokens with hashed, revocable/expiring invitations.
- Complete stable-ID-only joins/FKs and retire legacy name joins and `email_sent` after validated adoption.

## 12. Rollout and rollback

1. Ship Phase 0 first, disable the legacy bulk-start route in staging/production, and establish it as the minimum rollback release. Verify old UI/API calls cannot send during maintenance.
2. Put launch/configuration mutations into maintenance-blocked mode, test migration against fresh and production-shaped database copies, and capture pre/post counts and ambiguous lifecycle report.
3. Only then deploy additive schema and dormant lifecycle code. No binary predating the Phase-0 kill switch may serve traffic once migration/backfill starts.
4. Deploy worker disabled by default; validate claim/retry behavior in staging with controlled addresses.
5. Enable v2 launch endpoint/dashboard behind `SURVEY_DELIVERY_V2_ENABLED` in staging.
6. Exercise restart, provider rejection, missing template, duplicate click, partial failure, fenced lease recovery, mutation/launch races, and close-during-submit/send cases.
7. Take/confirm final production snapshot, deploy Phase-1 schema/code, then enable accepted/failed/uncertain tracking. Signed webhooks are a separate Phase-2 staging/production gate.
8. After lifecycle enablement, raise the minimum rollback release to the first lifecycle-aware API/worker release. Do **not** roll back to binaries that ignore lifecycle.
9. Operational rollback first flips the control-table kill switch checked before claims and provider calls, disables new launch creation, waits/bounds in-flight calls, and stops `ona-email-worker` through updated rollback workflow logic independent of the selected artifact. Pending rows remain durable for resume. Do not destructively reverse the migration.

## 13. Test strategy and acceptance criteria

### Migration/data

- fresh migration and production-shaped upgrade
- explicit concurrent-index/constraint promotion sequence, timeouts, failed-index cleanup, and stable Survey ID constraint preflight
- composite candidate-key/FK enforcement (including parent/template/attempt history), mismatched-tenant rejection, orphan validation, and lifecycle backfill report/counts
- no loss or fabricated delivery history
- old API compatibility with additive schema

### API/security

- complete role matrix and tenant isolation for readiness/launch/history/details/retry/close/reopen, including platform admin without membership
- cross-org IDs return 404
- readiness validates every recipient/template before enqueue
- concurrent launches and idempotency replays create exactly one launch/delivery per respondent
- changed payload with reused key returns 409
- audit rows commit atomically with lifecycle/launch
- draft/closed/archived respondent links denied; active accepted; submission/close two-connection lock race is deterministic
- every listed active mutation route rejected consistently; launch/configuration two-connection races preserve immutable snapshots
- close/archive cancels pending work, requests leased cancellation, and atomically records strict audit events
- CORS preflight accepts Idempotency-Key; all authenticated admin mutations reject untrusted Origin/CSRF; host-only session cookie still supports dashboard/API credentials
- control-row disable/enqueue race proves no launch commits after disable completes

### Worker/provider

- resolved `{ error }` is failure; returned provider ID required for acceptance
- pending work survives API/worker restart
- fenced lease expiry/reclaim, stale-worker rejection, dedicated indexes, provider timeout, and `SKIP LOCKED` concurrency
- an `in_progress` attempt exists before provider I/O and unfinished attempts reconcile visibly
- transient/permanent/quota classification, global limiter, `Retry-After`, max attempts/age
- deterministic renderer snapshots base URL/version and verifies provider-payload hash before every retry
- pinned-SDK/API contract proves idempotency transmission, `{data,error}` handling, provider ID requirement, crash-window behavior, and uncertain terminal state
- same email across surveys cannot cross-attribute status
- mutually exclusive dispatch invariant and launch terminal statuses derive correctly from delivery rows after worker/database failures
- PostgreSQL integration suite uses multiple real connections plus fake provider/clock; source-regex mocks are not accepted for concurrency guarantees

### Webhook

- bounded exact raw-body signature verification using supported library
- invalid/stale signature rejection, fenced inbox retries, dead-letter/replay, and retention
- duplicate `svix-id` idempotence
- out-of-order and unmatched event handling
- bounce/complaint precedence, send-time suppression, terminal cancelled dispatch projection, and all-targets-suppressed reconciliation

### Dashboard

- readiness counts/blockers and accessible dialog
- double-click submits one idempotent request
- truthful queued/progress/partial-failure/completed labels
- polling starts/stops/cancels correctly
- lifecycle actions and role visibility, including lifecycle-read-only editor/table surfaces
- refreshed selected-survey state by stable ID, polling cancellation, and stale-response suppression
- response status remains separate from email status; Phase-1 reminder bypass is absent
- automated accessibility assertions for contextual labels, focus restoration, `aria-busy`, and `aria-live`
- visible actionable errors; no browser `alert()`
- invitation HTML/plain text have approved copy, escaped/sanitized template content, language/accessibility checks, and no unintended token disclosure

### MVP acceptance

- Launching a ready draft atomically activates it and returns a durable launch ID within the HTTP request, without waiting on Resend.
- A restart loses no committed delivery and causes no duplicate within provider idempotency guarantees.
- The Phase-1 dashboard shows mutually exclusive pending, processing, retrying, accepted, failed, uncertain, and cancelled dispatch counts and never equates acceptance with delivery. Delivered/bounced/complained/suppressed outcomes appear only after Phase 2.
- Every recipient attempt is attributable to one organization, survey, launch, and respondent.
- Missing templates or invalid recipients cause zero launch emails, not partial sends.
- Initial launch is idempotent by key plus canonical request fingerprint. Automatic transient retries are durable/auditable in Phase 1; manual retries/reminders become explicit and auditable in Phase 3.
- Draft/closed/archived surveys cannot accept real respondent traffic.
- Existing survey/response data and legacy identifiers remain preserved throughout rollout.
