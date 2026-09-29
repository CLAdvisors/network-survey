'use strict';
process.env.NODE_ENV = 'test';
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'delivery-http-test-secret';
process.env.SURVEY_DELIVERY_V2_ENABLED = 'true';
process.env.SURVEY_SCHEDULES_ENABLED = 'true';
process.env.SURVEY_URL = 'https://survey.example.test';

const test = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcrypt');
const request = require('supertest');
const { app, pool } = require('../server');

const surveyId = '11111111-1111-4111-8111-111111111111';
const organizationId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
test('delivery HTTP enforces login, tenant roles, no-store bearer link and strict audit', async t => {
  const originalQuery = pool.query;
  const originalConnect = pool.connect;
  t.after(() => { pool.query = originalQuery; pool.connect = originalConnect; });
  const password = await bcrypt.hash('password123', 4);
  pool.query = async sql => {
    if (/SELECT \* FROM users WHERE username = \$1/.test(sql)) return { rows: [{ id: 91, username: 'delivery-user', password, status: 'active' }] };
    if (/SELECT \* FROM users WHERE id = \$1/.test(sql)) return { rows: [{ id: 91, username: 'delivery-user', status: 'active' }] };
    if (/information_schema\.columns/.test(sql)) return { rows: [] };
    if (/SELECT[\s\S]+sess[\s\S]+FROM[\s\S]+sessions/i.test(sql)) return { rows: [{ sess: { cookie: {}, userId: 91, username: 'delivery-user' } }], rowCount: 1 };
    if (/sessions/i.test(sql)) return { rows: [], rowCount: 1 };
    if (/FROM organization_memberships om/.test(sql)) return { rows: [] };
    return { rows: [], rowCount: 0 };
  };
  let role = 'viewer';
  let auditFails = false;
  const calls = [];
  pool.connect = async () => ({
    release() {},
    async query(sql, params = []) {
      calls.push({ sql, params });
      if (/SELECT s\.\*, om\.role/.test(sql)) return { rows: role ? [{ id: surveyId, organization_id: organizationId, name: 'Survey One', role, lifecycle_status: 'draft' }] : [] };
      if (/SELECT personal_link_minimum_role/.test(sql)) return { rows: [{ personal_link_minimum_role: 'admin' }] };
      if (/SELECT respondent_id, uuid, can_respond/.test(sql)) return { rows: params[1] === surveyId ? [{ respondent_id: 13, uuid: 'test-private-token', can_respond: true }] : [] };
      if (/INSERT INTO audit_events/.test(sql) && auditFails) throw new Error('audit unavailable');
      if (/SELECT \* FROM survey_delivery_schedules WHERE survey_id/.test(sql)) return { rows: [] };
      if (/INSERT INTO survey_delivery_schedules/.test(sql)) return { rows: [{ id: '22222222-2222-4222-8222-222222222222', survey_id: surveyId, timezone: 'UTC', start_local: '2026-10-15T10:00', close_local: '2026-10-20T10:00', next_due_at: '2026-10-15T10:00:00Z', status: 'active', version: 1 }] };
      return { rows: [], rowCount: 1 };
    },
  });
  const anonymous = await request(app).post(`/api/surveys/${surveyId}/respondents/13/personal-link`).send({ purpose: 'reveal' });
  assert.equal(anonymous.status, 401);
  const agent = request.agent(app);
  assert.equal((await agent.post('/api/login').send({ username: 'delivery-user', password: 'password123' })).status, 200);
  assert.equal((await agent.get(`/api/surveys/${surveyId}/personal-link-permission`)).body.canReveal, false);
  assert.equal((await agent.post(`/api/surveys/${surveyId}/respondents/13/personal-link`).send({ purpose: 'reveal' })).status, 404);
  assert.equal((await agent.put(`/api/surveys/${surveyId}/delivery-schedule`).send({ startLocal: '2026-10-15T10:00', closeLocal: '2026-10-20T10:00', timezone: 'UTC', reminderEveryDays: 1, expectedVersion: 0 })).status, 404);
  role = 'admin';
  const revealed = await agent.post(`/api/surveys/${surveyId}/respondents/13/personal-link`).send({ purpose: 'reveal' });
  assert.equal(revealed.status, 200);
  assert.equal(revealed.headers['cache-control'], 'no-store');
  assert.equal(new URL(revealed.body.link).searchParams.get('userId'), 'test-private-token');
  assert.equal(JSON.stringify(calls.filter(call => /INSERT INTO audit_events/.test(call.sql))).includes('test-private-token'), false);
  auditFails = true;
  const denied = await agent.post(`/api/surveys/${surveyId}/respondents/13/personal-link`).send({ purpose: 'copy' });
  assert.equal(denied.status, 500);
  assert.equal(JSON.stringify(denied.body).includes('test-private-token'), false);
  assert.equal(calls.at(-1).sql, 'ROLLBACK');
  auditFails = false;
  const scheduleResponse = await agent.put(`/api/surveys/${surveyId}/delivery-schedule`).send({ startLocal: '2026-10-15T10:00', closeLocal: '2026-10-20T10:00', timezone: 'UTC', reminderEveryDays: 1, expectedVersion: 0 });
  assert.equal(scheduleResponse.status, 200);
  assert.equal(scheduleResponse.body.schedule.timezone, 'UTC');
  assert.equal(JSON.stringify(scheduleResponse.body).includes('lease_token'), false);
});
