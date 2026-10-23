'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { launchReminder } = require('../lifecycle');

const surveyId = '11111111-1111-4111-8111-111111111111';
const organizationId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const launchId = '22222222-2222-4222-8222-222222222222';
const key = '33333333-3333-4333-8333-333333333333';
const config = { NODE_ENV: 'test', SURVEY_URL: 'https://survey.example.test', RESEND_PROVIDER_ACCOUNT_SCOPE: 'test-account', RESEND_API_KEY: 'fake' };
function fixture({ role = 'admin', eligible = [1, 2], replay = false, initialPending = false } = {}) {
  const calls = [];
  let fingerprint;
  const client = { release() {}, async query(sql, values = []) {
    calls.push({ sql, values });
    if (/SELECT \* FROM email_worker_control/.test(sql)) return { rows: [{}], rowCount: 1 };
    if (/SELECT \* FROM email_sending_control/.test(sql)) return { rows: [{ sending_enabled: true }], rowCount: 1 };
    if (/SELECT s\.\*, om\.role/.test(sql)) return { rows: role ? [{ id: surveyId, name: 'Team', organization_id: organizationId, role, lifecycle_status: 'active' }] : [] };
    if (/SELECT id,request_fingerprint/.test(sql)) {
      fingerprint = values.length && calls.find(value => /INSERT INTO survey_launches/.test(value.sql))?.values[3];
      return { rows: replay ? [{ id: launchId, request_fingerprint: fingerprint }] : [], rowCount: replay ? 1 : 0 };
    }
    if (/SELECT 1 FROM survey_launches l JOIN/.test(sql)) return { rows: [], rowCount: 0 };
    if (/SELECT 1 FROM survey_email_deliveries d JOIN survey_launches l/.test(sql)) return { rows: initialPending ? [{}] : [], rowCount: initialPending ? 1 : 0 };
    if (/SELECT r\.respondent_id,r\.name,r\.contact_info/.test(sql)) return { rows: eligible.map(id => ({ respondent_id: id, name: `Person ${id}`, contact_info: `p${id}@example.test`, uuid: `token-${id}`, lang: 'English' })) };
    if (/FROM survey_reminder_templates/.test(sql)) return { rows: [{ language: 'english', subject: 'Reminder', body_text: 'Please complete.', configuration_version: 1 }] };
    if (/FROM email_worker_control c JOIN/.test(sql)) return { rows: [{}], rowCount: 1 };
    if (/INSERT INTO survey_launches/.test(sql)) return { rows: [{ id: launchId, created_at: new Date() }], rowCount: 1 };
    if (/WHERE l\.id=\$1/.test(sql)) return { rows: [{ id: launchId }] };
    return { rows: [{ count: 0 }], rowCount: 1 };
  }};
  return { pool: { connect: async () => client }, calls };
}

test('targeted resend creates exactly one durable reminder and redacted audit, with idempotency key', async () => {
  const { pool, calls } = fixture();
  const result = await launchReminder(pool, { id: 4 }, surveyId, { respondentId: '2', idempotencyKey: key }, config);
  assert.equal(result.target_count, 1);
  const deliveries = calls.filter(call => /INSERT INTO survey_email_deliveries/.test(call.sql));
  assert.equal(deliveries.length, 1);
  assert.equal(deliveries[0].values[4], 2);
  assert.equal(deliveries[0].values.at(-1), 'survey-delivery-' + deliveries[0].values[0]);
  assert.match(deliveries[0].sql, /'reminder_pending'/);
  const audit = calls.find(call => /INSERT INTO audit_events/.test(call.sql));
  assert.equal(audit.values[3], 'survey.targeted_resend_requested');
  assert.equal(JSON.stringify(audit).includes('token-2'), false);
  assert.equal(calls.at(-1).sql, 'COMMIT');
});

test('denies unprivileged, cross-survey/ineligible respondents and invalid identity', async () => {
  for (const role of ['editor', null]) {
    const { pool, calls } = fixture({ role });
    await assert.rejects(() => launchReminder(pool, { id: 4 }, surveyId, { respondentId: 2, idempotencyKey: key }, config), error => error.status === 404);
    assert.equal(calls.some(call => /INSERT INTO survey_email_deliveries/.test(call.sql)), false);
  }
  const { pool } = fixture({ eligible: [1] });
  await assert.rejects(() => launchReminder(pool, { id: 4 }, surveyId, { respondentId: 2, idempotencyKey: key }, config), error => error.status === 404);
  await assert.rejects(() => launchReminder(pool, { id: 4 }, surveyId, { respondentId: '2x', idempotencyKey: key }, config), error => error.status === 404);
  const pending = fixture({ initialPending: true });
  await assert.rejects(() => launchReminder(pending.pool, { id: 4 }, surveyId, { respondentId: 2, idempotencyKey: key }, config), error => error.status === 409 && error.code === 'initial_in_progress');
  assert.equal(pending.calls.some(call => /INSERT INTO survey_email_deliveries/.test(call.sql)), false);
});
