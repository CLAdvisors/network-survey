# Per-survey email history

## Contract and invariants

`GET /api/surveys/:surveyId/email-history?limit=25&cursor=…` is an authenticated, read-only message history. The stable survey UUID is authoritative. Every page first re-authorizes the current user as an analyst-or-higher member (or platform administrator), then scopes the delivery query by both `survey_id` and the authorized `organization_id`. Invalid/missing/unauthorized survey IDs all return `survey_not_found` (404).

Pages default to 50 records and are capped at 100. The query fetches `limit + 1` rows ordered by `(created_at DESC, id DESC)`. `pageInfo.hasMore` and a non-null `pageInfo.nextCursor` are returned only when the extra row exists. The HMAC-signed, base64url cursor binds its version, survey, tenant, exact PostgreSQL timestamp in microseconds, and delivery UUID. Cursor parsing is length/schema/signature bounded; bad or cross-survey cursors return 400 only after survey authorization. All SQL values are parameters.

Response shape:

```json
{
  "surveyId": "uuid",
  "messages": [{
    "messageType": "invitation | reminder",
    "campaign": { "launchId": "uuid", "kind": "initial | reminder | retry_failed | unknown", "queuedAt": "timestamp|null" },
    "recipient": { "displayName": "string|null", "address": "string|null" },
    "status": { "code": "string", "label": "string", "explanation": "string", "occurredAt": "timestamp|null" },
    "attempts": 1,
    "timestamps": {
      "queuedAt": "timestamp|null", "firstAttemptedAt": "timestamp|null",
      "lastAttemptedAt": "timestamp|null", "providerAcceptedAt": "timestamp|null",
      "deliveredAt": "timestamp|null", "lastUpdatedAt": "timestamp|null"
    }
  }],
  "pageInfo": { "limit": 25, "hasMore": false, "nextCursor": null }
}
```

Recipient name/address come from the immutable delivery snapshot, not the current respondent row. Renames therefore do not rewrite history, and history does not require a respondent join. Null/partial records use explicit unavailable/unknown UI states. Attempt count is the greater of the durable delivery counter and recorded attempt rows, accommodating partially migrated or retried records.

## Status precedence

Webhook-projected occurrences are authoritative and can overlap. The displayed current outcome uses this explicit precedence:

1. complaint reported
2. bounced
3. suppressed
4. provider delivery failed
5. delivered (recipient mail-server confirmation)
6. delayed
7. provider accepted (`provider_sent_at`, dispatch acceptance, or accepted durable state)
8. local sending failed
9. uncertain/unknown provider result
10. skipped (cancelled before any attempt)
11. cancelled after an attempt
12. processing/retry wait
13. queued
14. unknown legacy/incomplete state

Adverse webhook truth intentionally remains visible even if another positive occurrence also exists. Opens are never queried or interpreted. “Provider accepted” is not recipient delivery; only “Delivered” represents recipient mail-server confirmation.

## Privacy boundary

The API deliberately omits respondent tokens, tokenized URLs, subjects/bodies/templates, render inputs, payload hashes, provider IDs/payloads/webhook bodies, raw error codes/messages, suppression evidence, credentials, lease/claim data, and infrastructure/state data. The compatibility `/deliveries` URL returns the same redacted contract. Responses use `Cache-Control: no-store`.

The dashboard renders the section only for roles already permitted to view the survey roster. It uses an accessible desktop table and narrow-screen cards, explicit refresh, bounded next/previous pages, humane empty/loading/error states, and abort-plus-generation fencing. Loaded data is keyed by session, survey, page, and cursor so switching any of them cannot display a prior response. It does not poll or add resend, retry, export, search, or body preview.

## Migration and rollout

`v1_11_survey_email_history_pagination.sql` adds only the concurrent `(survey_id, organization_id, created_at DESC, id DESC)` pagination index with lock/statement timeouts and interrupted-build self-healing. It is appended to the universal master changelog and intentionally absent from the historical CLA cutover root, so the cutover-to-master pending set remains ordered and additive. No delivery data is rewritten or deleted.
