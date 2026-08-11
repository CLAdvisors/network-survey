'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const bcrypt = require('bcrypt');
process.env.NODE_ENV = 'test';
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'email-template-test-secret';
process.env.AUTH_RATE_LIMIT_MAX = '1000';
const { app, pool, parseInvitationTemplateCsv, normalizeInvitationTemplates, insertEmails } = require('../server');

test('CSV invitation import uses a real CSV parser for quoted multiline bodies', () => {
  const templates = parseInvitationTemplateCsv(
    'language_code,notification_text\nen,"Hello, team.\n\nPlease complete the survey."\nfr,"Bonjour"'
  );
  assert.deepEqual(templates, [
    { language: 'English', text: 'Hello, team.\n\nPlease complete the survey.' },
    { language: 'French', text: 'Bonjour' },
  ]);
});

test('template validation canonicalizes supported languages and rejects inaccessible or oversized values', () => {
  assert.deepEqual(normalizeInvitationTemplates([{ language: 'en', text: 'Hello' }]), [
    { language: 'English', text: 'Hello' },
  ]);
  assert.throws(
    () => normalizeInvitationTemplates([{ language: 'Englsh', text: 'Hello' }]),
    /supported language/
  );
  assert.throws(
    () => normalizeInvitationTemplates([{ language: 'English', text: 'x'.repeat(2556) }]),
    /2555 characters or fewer/
  );
  assert.throws(
    () => normalizeInvitationTemplates([{ language: 'English', text: 'Hello', subject: 'x'.repeat(256) }]),
    /255 characters or fewer/
  );
  assert.throws(
    () => normalizeInvitationTemplates([{ language: 'en', text: 'One' }, { language: 'English', text: 'Two' }]),
    /must be unique/
  );
});

test('structured update endpoint preserves subject and rejects lifecycle-locked surveys', async (t) => {
  const originalQuery = pool.query;
  const originalConnect = pool.connect;
  t.after(() => { pool.query = originalQuery; pool.connect = originalConnect; });
  const password = await bcrypt.hash('password123', 4);
  let lifecycleStatus = 'draft';
  const inserts = [];

  pool.query = async (sql) => {
    if (/SELECT \* FROM users WHERE username/.test(sql)) {
      return { rows: [{ id: 51, username: 'template-editor', password, status: 'active' }] };
    }
    if (/SELECT \* FROM users WHERE id/.test(sql)) {
      return { rows: [{ id: 51, username: 'template-editor', status: 'active' }] };
    }
    if (/information_schema\.(columns|tables)/.test(sql)) return { rows: [] };
    if (/SELECT[\s\S]+sess[\s\S]+FROM[\s\S]+sessions/i.test(sql)) {
      return { rows: [{ sess: { cookie: {}, userId: 51, username: 'template-editor' } }], rowCount: 1 };
    }
    if (/sessions/i.test(sql)) return { rows: [], rowCount: 1 };
    if (/LEFT JOIN organization_memberships/.test(sql)) {
      return { rows: [{
        id: '11111111-1111-4111-8111-111111111111', name: 'SurveyOne',
        organization_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', role: 'editor',
        lifecycle_status: lifecycleStatus,
      }] };
    }
    return { rows: [], rowCount: 0 };
  };
  pool.connect = async () => ({
    query: async (sql, values) => {
      if (/SELECT s\.\*, om\.role FROM survey/.test(sql)) {
        return { rows: [{
          id: '11111111-1111-4111-8111-111111111111', name: 'SurveyOne',
          organization_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', role: 'editor',
          lifecycle_status: lifecycleStatus,
        }] };
      }
      if (/INSERT INTO email/.test(sql)) inserts.push(values);
      return { rows: [], rowCount: 1 };
    },
    release() {},
  });

  const agent = request.agent(app);
  assert.equal((await agent.post('/api/login').send({ username: 'template-editor', password: 'password123' })).status, 200);
  const body = 'First line\n\nSecond line, with punctuation.';
  const saved = await agent.post('/api/updateEmails').send({
    surveyName: 'SurveyOne', templates: [{ language: 'English', text: body }],
  });
  assert.equal(saved.status, 200);
  assert.equal(inserts.length, 1);
  assert.equal(inserts[0][3], body);
  assert.equal(inserts[0][4], null);

  lifecycleStatus = 'active';
  const locked = await agent.post('/api/updateEmails').send({
    surveyName: 'SurveyOne', templates: [{ language: 'English', text: 'Changed' }],
  });
  assert.equal(locked.status, 409);
  assert.equal(locked.body.error, 'survey_not_editable');
  assert.equal(inserts.length, 1);
  const lockedSubject = await agent.put('/api/survey-notifications/11111111-1111-4111-8111-111111111111/subject').send({
    language: 'English', subject: 'Changed subject',
  });
  assert.equal(lockedSubject.status, 409);
  assert.equal(lockedSubject.body.error, 'survey_not_editable');
});

test('structured template persistence round-trips multiline text and omits subject updates', async (t) => {
  const originalConnect = pool.connect;
  t.after(() => { pool.connect = originalConnect; });
  const calls = [];
  pool.connect = async () => ({
    query: async (sql, values) => {
      calls.push({ sql, values });
      return { rows: [], rowCount: 1 };
    },
    release() {},
  });

  const body = `Hello, team.\n\nPlease complete Jane's \"leadership\" survey.`;
  await insertEmails([{ language: 'English', text: body }], {
    id: '11111111-1111-4111-8111-111111111111',
    name: 'SurveyOne',
  });

  const insert = calls.find(({ sql }) => /INSERT INTO email/.test(sql));
  assert.ok(insert);
  assert.equal(insert.values[3], body);
  assert.equal(insert.values[4], null);
  assert.match(insert.sql, /WHEN \$5 IS NULL THEN email\.invitation_subject/);
  assert.equal(calls[0].sql, 'BEGIN');
  assert.equal(calls.at(-1).sql, 'COMMIT');
});
