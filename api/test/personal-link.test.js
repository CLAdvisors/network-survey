'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { personalLinkPermission, setPersonalLinkPermission, revealPersonalLink } = require('../lifecycle');

const surveyId = '11111111-1111-4111-8111-111111111111';
const otherSurveyId = '22222222-2222-4222-8222-222222222222';
const organizationId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const user = { id: 7 };
function fixture({ role = 'admin', minimumRole = 'admin', respondentSurvey = surveyId, respondentToken = 'bearer-secret', canRespond = true, archived = false, auditFails = false } = {}) {
  const statements = [];
  const client = {
    release() { statements.push('release'); },
    async query(sql, params = []) {
      statements.push({ sql, params });
      if (/SELECT s\.\*, om\.role/.test(sql)) return { rows: role ? [{ id: surveyId, organization_id: organizationId, name: 'Staff & Culture', role, archived_at: archived ? new Date() : null }] : [] };
      if (/SELECT personal_link_minimum_role/.test(sql)) return { rows: [{ personal_link_minimum_role: minimumRole }] };
      if (/SELECT respondent_id, uuid, can_respond/.test(sql)) return { rows: params[1] === respondentSurvey ? [{ respondent_id: 13, uuid: respondentToken, can_respond: canRespond }] : [] };
      if (/INSERT INTO audit_events/.test(sql) && auditFails) throw new Error('audit unavailable');
      return { rows: [] };
    },
  };
  return { pool: { connect: async () => client }, statements };
}
const config = { SURVEY_URL: 'https://surveys.example.test/form' };

test('default owner/admin permission and deny-by-default for other roles and foreign survey', async () => {
  for (const role of ['admin', 'owner']) {
    const { pool } = fixture({ role });
    assert.equal((await personalLinkPermission(pool, user, surveyId)).canReveal, true);
    const link = new URL((await revealPersonalLink(pool, user, surveyId, 13, 'reveal', config)).link);
    assert.equal(link.searchParams.get('surveyName'), 'Staff & Culture');
    assert.equal(link.searchParams.get('userId'), 'bearer-secret');
  }
  for (const role of ['editor', 'analyst', 'viewer', null]) {
    const { pool, statements } = fixture({ role });
    if (role) assert.equal((await personalLinkPermission(pool, user, surveyId)).canReveal, false);
    await assert.rejects(() => revealPersonalLink(pool, user, surveyId, 13, 'reveal', config), error => error.status === 404);
    assert.equal(statements.some(value => typeof value === 'object' && /SELECT respondent_id, uuid/.test(value.sql)), false);
  }
  const { pool } = fixture({ respondentSurvey: otherSurveyId });
  await assert.rejects(() => revealPersonalLink(pool, user, surveyId, 13, 'reveal', config), error => error.status === 404);
  for (const options of [{ respondentToken: null }, { canRespond: false }, { archived: true }]) {
    const invalid = fixture(options);
    await assert.rejects(() => revealPersonalLink(invalid.pool, user, surveyId, 13, 'reveal', config), error => error.status === 404);
    assert.equal(invalid.statements.some(value => typeof value === 'object' && /INSERT INTO audit_events/.test(value.sql)), false);
  }
});

test('every reveal and copy writes strict nonsecret audit in the same transaction', async () => {
  const { pool, statements } = fixture();
  await revealPersonalLink(pool, user, surveyId, 13, 'reveal', config);
  await revealPersonalLink(pool, user, surveyId, 13, 'copy', config);
  const audits = statements.filter(value => typeof value === 'object' && /INSERT INTO audit_events/.test(value.sql));
  assert.deepEqual(audits.map(value => value.params[3]), ['respondent.personal_link_reveal', 'respondent.personal_link_copy']);
  assert.equal(JSON.stringify(audits).includes('bearer-secret'), false);
  assert.equal(statements.filter(value => value.sql === 'COMMIT').length, 2);
  const broken = fixture({ auditFails: true });
  await assert.rejects(() => revealPersonalLink(broken.pool, user, surveyId, 13, 'reveal', config), /audit unavailable/);
  assert.equal(broken.statements.some(value => value.sql === 'COMMIT'), false);
  assert.equal(broken.statements.some(value => value.sql === 'ROLLBACK'), true);
});

test('owner alone configures policy, bad inputs and unavailable base URL fail closed', async () => {
  const editor = fixture({ role: 'admin' });
  await assert.rejects(() => setPersonalLinkPermission(editor.pool, user, surveyId, 'editor'), error => error.status === 404);
  const owner = fixture({ role: 'owner' });
  assert.equal((await setPersonalLinkPermission(owner.pool, user, surveyId, 'editor')).minimumRole, 'editor');
  assert.equal(owner.statements.some(value => typeof value === 'object' && /organization.personal_link_permission_updated/.test(JSON.stringify(value))), true);
  await assert.rejects(() => setPersonalLinkPermission(owner.pool, user, surveyId, 'superuser'), error => error.status === 400);
  await assert.rejects(() => revealPersonalLink(owner.pool, user, surveyId, 13, 'unknown', config), error => error.status === 400);
  await assert.rejects(() => revealPersonalLink(owner.pool, user, surveyId, 13, 'reveal', { SURVEY_URL: 'javascript:alert(1)' }), error => error.status === 503);
  await assert.rejects(() => revealPersonalLink(owner.pool, user, surveyId, 13, 'reveal', { SURVEY_URL: 'http://public.example.test', EMAIL_WORKER_ENV: 'prod-secondary' }), error => error.status === 503);
  assert.match((await revealPersonalLink(owner.pool, user, surveyId, 13, 'reveal', { SURVEY_URL: 'http://localhost:3000', EMAIL_WORKER_ENV: 'local' })).link, /^http:\/\/localhost/);
});
