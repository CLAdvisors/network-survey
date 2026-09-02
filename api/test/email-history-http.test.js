'use strict';

process.env.NODE_ENV = 'test';
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'email-history-http-secret';

const test = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcrypt');
const request = require('supertest');
const { app, pool } = require('../server');

const SURVEY_ID = '11111111-1111-4111-8111-111111111111';
const ORG_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

test('email history HTTP routes enforce roster authorization, no-store redaction, and strict parameters', async (t) => {
  const originalQuery = pool.query;
  const originalConnect = pool.connect;
  t.after(() => {
    pool.query = originalQuery;
    pool.connect = originalConnect;
  });

  const password = await bcrypt.hash('password123', 4);
  pool.query = async (sql) => {
    if (/SELECT \* FROM users WHERE username = \$1/.test(sql)) return { rows: [{ id: 91, username: 'history-user', password, status: 'active' }] };
    if (/SELECT \* FROM users WHERE id = \$1/.test(sql)) return { rows: [{ id: 91, username: 'history-user', status: 'active' }] };
    if (/information_schema\.columns/.test(sql)) return { rows: [] };
    if (/SELECT[\s\S]+sess[\s\S]+FROM[\s\S]+sessions/i.test(sql)) return { rows: [{ sess: { cookie: {}, userId: 91, username: 'history-user' } }], rowCount: 1 };
    if (/sessions/i.test(sql)) return { rows: [], rowCount: 1 };
    if (/FROM organization_memberships om/.test(sql)) return { rows: [] };
    return { rows: [], rowCount: 0 };
  };

  const agent = request.agent(app);
  assert.equal((await agent.post('/api/login').send({ username: 'history-user', password: 'password123' })).status, 200);

  let role = 'analyst';
  let historyQueries = 0;
  pool.connect = async () => ({
    release() {},
    async query(sql) {
      if (/SELECT s\.\*, om\.role/.test(sql)) return { rows: [{ id: SURVEY_ID, organization_id: ORG_ID, role }] };
      if (/FROM survey_email_deliveries d/.test(sql)) {
        historyQueries += 1;
        return { rows: [{
          id: '30000000-0000-4000-8000-000000000001', launch_id: '40000000-0000-4000-8000-000000000001',
          kind: 'initial', launch_created_at: '2026-08-01T09:59:00Z', recipient_display_name: 'Synthetic Recipient',
          to_address: 'recipient@example.test', status: 'accepted', attempt_count: 1,
          dispatch_accepted_at: '2026-08-01T10:01:00Z', dispatch_failed_at: null, provider_sent_at: null,
          provider_delivered_at: null, provider_delayed_at: null, provider_bounced_at: null,
          provider_complained_at: null, provider_suppressed_at: null, provider_failed_at: null,
          created_at: '2026-08-01T10:00:00Z', updated_at: '2026-08-01T10:01:00Z',
          created_at_cursor: '2026-08-01T10:00:00.000000Z', first_attempt_at: '2026-08-01T10:00:30Z',
          last_attempt_at: '2026-08-01T10:00:30Z', provider_message_id: 'must-not-leak',
          last_error_message: 'must-not-leak', lease_token: 'must-not-leak',
        }] };
      }
      throw new Error(`Unexpected query: ${sql}`);
    },
  });

  const success = await agent.get(`/api/surveys/${SURVEY_ID}/email-history?limit=25`);
  assert.equal(success.status, 200);
  assert.equal(success.headers['cache-control'], 'no-store');
  assert.equal(success.body.surveyId, SURVEY_ID);
  assert.equal(success.body.messages[0].recipient.address, 'recipient@example.test');
  for (const forbidden of ['provider_message_id', 'must-not-leak', 'lease_token', 'last_error']) {
    assert.equal(JSON.stringify(success.body).includes(forbidden), false);
  }

  const alias = await agent.get(`/api/surveys/${SURVEY_ID}/deliveries?limit=25`);
  assert.equal(alias.status, 200);
  assert.equal(alias.headers['cache-control'], 'no-store');
  assert.deepEqual(alias.body, success.body);

  const beforeRejectedParameters = historyQueries;
  const unsupported = await agent.get(`/api/surveys/${SURVEY_ID}/deliveries?status=failed`);
  assert.equal(unsupported.status, 400);
  assert.equal(unsupported.body.error, 'email_history_parameter_invalid');
  assert.equal(historyQueries, beforeRejectedParameters);

  const invalidCursor = await agent.get(`/api/surveys/${SURVEY_ID}/email-history?cursor=not-a-cursor`);
  assert.equal(invalidCursor.status, 400);
  assert.equal(invalidCursor.body.error, 'email_history_cursor_invalid');

  role = 'viewer';
  const viewer = await agent.get(`/api/surveys/${SURVEY_ID}/email-history`);
  assert.equal(viewer.status, 404);
  assert.equal(viewer.body.error, 'survey_not_found');

  role = null;
  const crossTenant = await agent.get(`/api/surveys/${SURVEY_ID}/email-history`);
  assert.equal(crossTenant.status, 404);
  assert.equal(crossTenant.body.error, 'survey_not_found');
});
