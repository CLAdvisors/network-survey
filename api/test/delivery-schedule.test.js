'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const schedules = require('../delivery-schedule');
const lifecycle = require('../lifecycle');
const { DeliveryWorker } = require('../email-worker');

const due = { id: '11111111-1111-4111-8111-111111111111', survey_id: '22222222-2222-4222-8222-222222222222', occurrence: 0, next_kind: 'initial', next_local: '2026-10-31T09:00', next_due_at: '2026-10-31T13:00:00Z', close_at: '2026-11-05T14:00:00Z', timezone: 'America/New_York', reminder_every_days: 1, version: 3, lease_token: 'claim-token', updated_by_user_id: 9 };

test('scheduler telemetry emits only environment/process gauges and error count, without survey identifiers', async t => {
  const original = console.log;
  const records = [];
  console.log = value => records.push(JSON.parse(value));
  t.after(() => { console.log = original; });
  const pool = { query: async sql => {
    assert.match(sql, /status='active' AND next_due_at<=now\(\)/);
    return { rows: [{ due_count: 2, oldest_age_seconds: 190 }] };
  }};
  const worker = new DeliveryWorker({ pool, provider: {}, env: { EMAIL_WORKER_ENV: 'test', RUNTIME_METRIC_NAMESPACE: 'NetworkSurvey/Runtime' } });
  worker.scheduleErrorCount = 3;
  await worker.scheduleTelemetry();
  assert.equal(records.length, 1);
  assert.equal(records[0].Environment, 'test');
  assert.equal(records[0].Process, 'email-worker');
  assert.equal(records[0].OldestDueScheduleAgeSeconds, 190);
  assert.equal(records[0].DueActiveScheduleCount, 2);
  assert.equal(records[0].ScheduleErrorCount, 3);
  assert.equal(worker.scheduleErrorCount, 0);
  assert.equal(JSON.stringify(records).includes('surveyId'), false);
});

test('due claim is database-serialized, restart-stable key; next occurrence advances only after durable launch', async t => {
  const calls = [];
  const original = lifecycle.launchSurvey;
  t.after(() => { lifecycle.launchSurvey = original; });
  lifecycle.launchSurvey = async (pool, user, surveyId, options) => {
    assert.equal(user.id, 9);
    assert.equal(surveyId, due.survey_id);
    assert.equal(options.scheduleVersion, 3);
    assert.equal(options.idempotencyKey, schedules.scheduledKey(due));
    return { id: '33333333-3333-4333-8333-333333333333' };
  };
  const pool = { async query(sql, values) {
    calls.push({ sql, values });
    if (/RETURNING \*/.test(sql)) return { rows: [due] };
    return { rowCount: 1, rows: [] };
  }};
  const result = await schedules.runDue(pool, { SURVEY_DELIVERY_V2_ENABLED: 'true' });
  assert.equal(result.kind, 'initial');
  assert.equal(calls.length, 2);
  assert.match(calls[0].sql, /FOR UPDATE SKIP LOCKED LIMIT 1/);
  assert.match(calls[0].sql, /lease_expires_at<=now\(\)/);
  assert.match(calls[1].sql, /lease_token=\$2 AND version=\$7 AND status='active'/);
  assert.equal(calls[1].values[4], 'reminder');
  assert.equal(calls[1].values[3].toISOString(), '2026-11-01T14:00:00.000Z');
  assert.equal(schedules.scheduledKey(due), schedules.scheduledKey({ ...due }));
});

test('failed launch keeps occurrence due and releases claim for idempotent restart', async t => {
  const original = lifecycle.launchSurvey;
  t.after(() => { lifecycle.launchSurvey = original; });
  lifecycle.launchSurvey = async () => { throw new Error('database unavailable'); };
  const calls = [];
  const pool = { async query(sql, values) {
    calls.push({ sql, values });
    if (/RETURNING \*/.test(sql)) return { rows: [due] };
    return { rowCount: 1, rows: [] };
  }};
  await assert.rejects(() => schedules.runDue(pool), /database unavailable/);
  assert.match(calls.at(-1).sql, /SET lease_token=NULL,lease_expires_at=NULL WHERE id=\$1 AND lease_token=\$2/);
  assert.equal(calls.some(call => /occurrence=occurrence\+1/.test(call.sql)), false);
});

test('overdue reminder skips send and advances close; overdue draft completes without launch', async t => {
  const original = lifecycle.launchReminder;
  t.after(() => { lifecycle.launchReminder = original; });
  lifecycle.launchReminder = async () => { throw new Error('must not launch after close'); };
  for (const kind of ['reminder', 'initial']) {
    const calls = [];
    const pool = { async query(sql, values) {
      calls.push({ sql, values });
      if (/RETURNING \*/.test(sql)) return { rows: [{ ...due, next_kind: kind, close_at: '2020-01-01T00:00:00Z' }] };
      return { rows: [], rowCount: 1 };
    }};
    const result = await schedules.runDue(pool);
    assert.equal(result.kind, 'expired');
    assert.equal(calls.length, 2);
    assert.match(calls[1].sql, /next_kind='close'/);
    assert.match(calls[1].sql, /WHEN \$3='initial' THEN 'completed'/);
  }
});

test('empty reminder occurrence advances once without sending and close remains due', async t => {
  const original = lifecycle.launchReminder;
  t.after(() => { lifecycle.launchReminder = original; });
  lifecycle.launchReminder = async () => { throw new lifecycle.LifecycleError(422, 'survey_not_ready', 'No recipients', { blockers: [{ code: 'recipients_missing' }] }); };
  const calls = [];
  const pool = { async query(sql, values) {
    calls.push({ sql, values });
    if (/RETURNING \*/.test(sql)) return { rows: [{ ...due, next_kind: 'reminder', next_local: '2026-11-04T09:00', occurrence: 4 }] };
    return { rows: [], rowCount: 1 };
  }};
  const result = await schedules.runDue(pool);
  assert.equal(result.launchId, null);
  assert.equal(calls.at(-1).values[4], 'close');
  assert.equal(calls.at(-1).values[3], due.close_at);
});

test('schedule API never exposes lease or worker actor; cancellation fences queued/leased work', async () => {
  const safe = schedules.publicSchedule({ ...due, status: 'active', start_local: due.next_local, close_local: '2026-11-05T09:00', start_at: due.next_due_at, reminder_every_days: 1 });
  assert.equal(safe.surveyId, due.survey_id);
  assert.equal(JSON.stringify(safe).includes('claim-token'), false);
  assert.equal(JSON.stringify(safe).includes('updated_by_user_id'), false);
  const calls = [];
  const client = { release() {}, async query(sql, values) {
    calls.push({ sql, values });
    if (/SELECT s\.\*, om\.role/.test(sql)) return { rows: [{ id: due.survey_id, organization_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', role: 'admin' }] };
    if (/SELECT \* FROM survey_delivery_schedules WHERE survey_id/.test(sql)) return { rows: [{ ...due, status: 'active' }] };
    return { rows: [], rowCount: 1 };
  }};
  await schedules.cancel({ connect: async () => client }, { id: 9 }, due.survey_id, 3);
  assert.match(calls.find(call => /UPDATE survey_email_deliveries/.test(call.sql)).sql, /cancellation_requested_at=now\(\)/);
  assert.equal(calls.at(-2).sql.includes('INSERT INTO audit_events'), true);
  assert.equal(calls.at(-1).sql, 'COMMIT');
});
