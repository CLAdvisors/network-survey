'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  LifecycleError, decodeEmailHistoryCursor, emailHistoryItem, emailHistoryOutcome,
  encodeEmailHistoryCursor, listEmailHistory,
} = require('../lifecycle');

const SURVEY_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_SURVEY_ID = '22222222-2222-4222-8222-222222222222';
const ORG_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const SECRET = { SESSION_SECRET: 'synthetic-test-cursor-secret' };

const baseRow = (overrides = {}) => ({
  id: '30000000-0000-4000-8000-000000000001',
  launch_id: '40000000-0000-4000-8000-000000000001',
  kind: 'initial',
  launch_created_at: '2026-08-01T09:59:00.000Z',
  recipient_display_name: 'Original Target Name',
  to_address: 'target@example.test',
  status: 'pending',
  attempt_count: 0,
  provider_attempt_count: 0,
  created_at: '2026-08-01T10:00:00.000Z',
  created_at_cursor: '2026-08-01T10:00:00.000000Z',
  updated_at: '2026-08-01T10:00:00.000Z',
  first_attempt_at: null,
  last_attempt_at: null,
  dispatch_accepted_at: null,
  dispatch_failed_at: null,
  provider_sent_at: null,
  provider_delivered_at: null,
  provider_delayed_at: null,
  provider_bounced_at: null,
  provider_complained_at: null,
  provider_suppressed_at: null,
  provider_failed_at: null,
  ...overrides,
});

function historyPool(rows, { role = 'analyst', surveyId = SURVEY_ID, organizationId = ORG_ID } = {}) {
  const calls = [];
  const client = {
    release() {},
    async query(sql, values = []) {
      calls.push({ sql, values });
      if (/SELECT s\.\*, om\.role/.test(sql)) {
        return { rows: role ? [{ id: surveyId, organization_id: organizationId, role }] : [] };
      }
      if (/FROM survey_email_deliveries d/.test(sql)) return { rows };
      throw new Error(`Unexpected query: ${sql}`);
    },
  };
  return { pool: { connect: async () => client }, calls };
}

test('opaque cursors are encrypted, authenticated, bounded, and scoped to the exact survey and tenant', () => {
  const input = { surveyId: SURVEY_ID, organizationId: ORG_ID, createdAt: '2026-08-01T10:00:00.123456Z', id: baseRow().id };
  const cursor = encodeEmailHistoryCursor(input, SECRET);
  assert.equal(cursor.includes(SURVEY_ID), false, 'cursor does not disclose its survey UUID');
  assert.equal(cursor.includes(baseRow().id), false, 'cursor does not disclose its delivery UUID');
  assert.notEqual(cursor, encodeEmailHistoryCursor(input, SECRET), 'a random nonce prevents equality leakage');
  assert.deepEqual(decodeEmailHistoryCursor(cursor, { id: SURVEY_ID, organization_id: ORG_ID }, SECRET), {
    createdAt: '2026-08-01T10:00:00.123456Z', id: baseRow().id,
  });
  assert.throws(() => decodeEmailHistoryCursor(`${cursor.slice(0, -1)}x`, { id: SURVEY_ID, organization_id: ORG_ID }, SECRET), error => error instanceof LifecycleError && error.code === 'email_history_cursor_invalid');
  const parts = cursor.split('.');
  const tamperedCiphertext = [parts[0], parts[1], `${parts[2].slice(0, -1)}${parts[2].at(-1) === 'A' ? 'B' : 'A'}`, parts[3]].join('.');
  assert.throws(() => decodeEmailHistoryCursor(tamperedCiphertext, { id: SURVEY_ID, organization_id: ORG_ID }, SECRET), error => error.code === 'email_history_cursor_invalid');
  assert.throws(() => decodeEmailHistoryCursor(cursor, { id: OTHER_SURVEY_ID, organization_id: ORG_ID }, SECRET), error => error.status === 400);
  assert.throws(() => decodeEmailHistoryCursor('x'.repeat(1025), { id: SURVEY_ID, organization_id: ORG_ID }, SECRET), error => error.status === 400);
});

test('status precedence preserves adverse webhook truth, delivery, delay, acceptance, and dispatch states', () => {
  const timestamp = (name) => ({ [name]: `2026-08-02T0${Object.keys(baseRow()).indexOf(name) % 9}:00:00.000Z` });
  const all = baseRow({
    status: 'accepted',
    ...timestamp('provider_sent_at'), ...timestamp('provider_delivered_at'), ...timestamp('provider_delayed_at'),
    ...timestamp('provider_bounced_at'), ...timestamp('provider_complained_at'), ...timestamp('provider_suppressed_at'), ...timestamp('provider_failed_at'),
  });
  assert.equal(emailHistoryOutcome(all).code, 'complained');
  assert.equal(emailHistoryOutcome({ ...all, provider_complained_at: null }).code, 'bounced');
  assert.equal(emailHistoryOutcome({ ...all, provider_complained_at: null, provider_bounced_at: null }).code, 'suppressed');
  assert.equal(emailHistoryOutcome({ ...all, provider_complained_at: null, provider_bounced_at: null, provider_suppressed_at: null }).code, 'provider_failed');
  assert.equal(emailHistoryOutcome({ ...all, provider_complained_at: null, provider_bounced_at: null, provider_suppressed_at: null, provider_failed_at: null }).code, 'delivered');
  assert.equal(emailHistoryOutcome(baseRow({ provider_delayed_at: '2026-08-02T00:00:00Z' })).code, 'delayed');
  assert.equal(emailHistoryOutcome(baseRow({ status: 'accepted' })).code, 'provider_accepted');
  assert.equal(emailHistoryOutcome(baseRow({ status: 'reminder_retry_wait', attempt_count: 2 })).code, 'processing');
  assert.equal(emailHistoryOutcome(baseRow({ status: 'failed' })).code, 'failed');
  assert.equal(emailHistoryOutcome(baseRow({ status: 'uncertain' })).code, 'unknown');
  assert.equal(emailHistoryOutcome(baseRow({ status: 'uncertain', provider_suppressed_at: '2026-08-02T00:00:00Z' })).code, 'unknown', 'local suppression must not erase an unresolved provider request');
  assert.equal(emailHistoryOutcome(baseRow({ status: 'leased', provider_suppressed_at: '2026-08-02T00:00:00Z' })).code, 'processing', 'leased local suppression remains non-definitive');
  assert.equal(emailHistoryOutcome(baseRow({ status: 'cancelled' })).code, 'skipped');
  assert.equal(emailHistoryOutcome(baseRow({ status: 'cancelled', attempt_count: 1 })).code, 'cancelled');
  assert.equal(emailHistoryOutcome(baseRow()).code, 'queued');
  assert.equal(emailHistoryOutcome(baseRow({ status: null })).code, 'unknown');
});

test('history projection distinguishes invitations/reminders and omits all operational and secret fields', () => {
  const invitation = emailHistoryItem(baseRow({
    status: 'accepted', attempt_count: 3, provider_attempt_count: 1, dispatch_accepted_at: '2026-08-01T10:01:00Z',
    respondent_token: 'never-return-this', provider_message_id: 'provider-secret',
    last_error_message: 'raw provider failure', body_text: 'private body', lease_token: 'lease-secret',
  }));
  const reminder = emailHistoryItem(baseRow({ kind: 'reminder', recipient_display_name: null, status: 'cancelled' }));
  assert.equal(invitation.messageType, 'invitation');
  assert.equal(invitation.attempts, 3, 'worker claim diagnostics remain available');
  assert.equal(invitation.providerAttempts, 1, 'provider attempts count only provider boundary crossings');
  assert.equal(reminder.messageType, 'reminder');
  assert.equal(reminder.recipient.displayName, null, 'partial historical snapshots remain humane and unmisattributed');
  const serialized = JSON.stringify([invitation, reminder]);
  for (const forbidden of ['never-return-this', 'provider-secret', 'raw provider failure', 'private body', 'lease-secret', 'providerMessageId', 'lastError']) {
    assert.equal(serialized.includes(forbidden), false);
  }
});

test('history authorizes before querying identities and non-enumerates viewer, missing, and malformed survey IDs', async () => {
  for (const role of ['viewer', null]) {
    const { pool, calls } = historyPool([], { role });
    await assert.rejects(() => listEmailHistory(pool, { id: 7 }, SURVEY_ID, {}, SECRET), error => error.code === 'survey_not_found' && error.status === 404);
    assert.equal(calls.length, 1);
    assert.equal(calls.some(({ sql }) => /survey_email_deliveries/.test(sql)), false);
  }
  const malformed = historyPool([]);
  await assert.rejects(() => listEmailHistory(malformed.pool, { id: 7 }, 'not-a-uuid', {}, SECRET), error => error.status === 404);
  assert.equal(malformed.calls.length, 0);
});

test('history uses tenant-bound deterministic keyset SQL, max page size, and a limit-plus-one next contract', async () => {
  const rows = Array.from({ length: 101 }, (_, index) => baseRow({
    id: `30000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
    created_at: '2026-08-01T10:00:00.000Z',
  }));
  const first = historyPool(rows);
  const response = await listEmailHistory(first.pool, { id: 7 }, SURVEY_ID, { limit: '9999' }, SECRET);
  assert.equal(response.messages.length, 100);
  assert.deepEqual(response.pageInfo, { limit: 100, hasMore: true, nextCursor: response.pageInfo.nextCursor });
  assert.ok(response.pageInfo.nextCursor);
  const query = first.calls.at(-1);
  assert.match(query.sql, /d\.survey_id=\$1 AND d\.organization_id=\$2/);
  assert.match(query.sql, /ORDER BY d\.created_at DESC,d\.id DESC/);
  assert.match(query.sql, /LIMIT \$3/);
  assert.match(query.sql, /JOIN survey_launches l ON l\.id=d\.launch_id AND l\.survey_id=d\.survey_id AND l\.organization_id=d\.organization_id/);
  assert.match(query.sql, /count\(provider_started_at\)::int AS provider_attempt_count/);
  assert.doesNotMatch(query.sql, /JOIN respondent|provider_message_id|last_error|render_inputs|body_text|lease_token/i);
  assert.deepEqual(query.values, [SURVEY_ID, ORG_ID, 101]);

  const second = historyPool([]);
  await listEmailHistory(second.pool, { id: 7 }, SURVEY_ID, { cursor: response.pageInfo.nextCursor, limit: '100' }, SECRET);
  const secondQuery = second.calls.at(-1);
  assert.match(secondQuery.sql, /\(d\.created_at,d\.id\) < \(\$3::timestamptz,\$4::uuid\)/);
  assert.equal(secondQuery.values[2], rows[99].created_at_cursor, 'cursor preserves PostgreSQL microsecond precision without JavaScript date conversion');
  assert.equal(secondQuery.values[3], rows[99].id, 'equal timestamps advance with the unique UUID tie-breaker');
  assert.equal(secondQuery.values[4], 101);
});

test('zero history and legacy/null snapshots return a stable bounded contract', async () => {
  const empty = historyPool([]);
  assert.deepEqual(await listEmailHistory(empty.pool, { id: 7 }, SURVEY_ID, {}, SECRET), {
    surveyId: SURVEY_ID, messages: [], pageInfo: { limit: 50, hasMore: false, nextCursor: null },
  });
  const legacy = historyPool([baseRow({ kind: null, recipient_display_name: null, status: null, updated_at: null })]);
  const response = await listEmailHistory(legacy.pool, { id: 7 }, SURVEY_ID, {}, SECRET);
  assert.equal(response.messages[0].messageType, 'invitation');
  assert.equal(response.messages[0].status.code, 'unknown');
  assert.equal(response.messages[0].recipient.displayName, null);
  await assert.rejects(() => listEmailHistory(empty.pool, { id: 7 }, SURVEY_ID, { limit: '0' }, SECRET), error => error.code === 'email_history_limit_invalid');
  await assert.rejects(() => listEmailHistory(empty.pool, { id: 7 }, SURVEY_ID, { status: 'failed' }, SECRET), error => error.code === 'email_history_parameter_invalid');
});

test('history route is authenticated/no-store and v1_11 is additive in the master pending set', () => {
  const server = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
  const migration = fs.readFileSync(path.join(__dirname, '../../db/changelogs/v1_11_survey_email_history_pagination.sql'), 'utf8');
  const master = fs.readFileSync(path.join(__dirname, '../../db/changelogs/master-changelog.xml'), 'utf8');
  const cutover = fs.readFileSync(path.join(__dirname, '../../db/changelogs/cla-production-cutover.xml'), 'utf8');
  const ci = fs.readFileSync(path.join(__dirname, '../../.github/workflows/ci.yml'), 'utf8');
  assert.match(server, /\/api\/surveys\/:surveyId\/email-history', requireAuth, sendEmailHistory/);
  assert.match(server, /sendEmailHistory[\s\S]+Cache-Control', 'no-store'/);
  assert.match(master, /v1_10_editable_survey_instructions\.sql[\s\S]+v1_11_survey_email_history_pagination\.sql/);
  assert.doesNotMatch(cutover, /v1_11_survey_email_history/);
  assert.match(migration, /runInTransaction:false/);
  assert.match(migration, /SET lock_timeout = '5s'/);
  assert.match(migration, /SET statement_timeout = '5min'/);
  assert.match(migration, /DROP INDEX CONCURRENTLY IF EXISTS delivery_survey_history_page/);
  assert.match(migration, /CREATE INDEX CONCURRENTLY delivery_survey_history_page[\s\S]+survey_id, organization_id, created_at DESC, id DESC/);
  assert.doesNotMatch(migration, /DELETE|TRUNCATE|DROP TABLE|DROP COLUMN/i);
  assert.match(ci, /db-pre-lifecycle[\s\S]+v1_11_survey_email_history_pagination\.sql\/d/);
  assert.match(ci, /db-capability1[\s\S]+v1_11_survey_email_history_pagination\.sql\/d/);
  assert.match(ci, /email history pagination index missing, invalid, or incorrectly defined/);
  assert.match(ci, /CREATE INDEX delivery_survey_history_page ON survey_email_deliveries\(id\)/);
});
