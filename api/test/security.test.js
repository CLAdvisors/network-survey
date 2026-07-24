const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const fs = require('node:fs');
const path = require('node:path');
const bcrypt = require('bcrypt');

process.env.NODE_ENV = 'test';
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'test-secret';
process.env.ALLOW_PUBLIC_SIGNUP = 'false';
process.env.AUTH_RATE_LIMIT_MAX = '1000';
process.env.RESPONDENT_RATE_LIMIT_MAX = '1000';

const {
  app,
  pool,
  validateRespondentToken,
  requireAuth,
  toSafeUser,
  columnExists,
  tableExists,
  hasAnyRole,
  resolveSurveyForUser,
  getDefaultOrganizationForUser,
  getDashboardBaseUrl,
  buildDashboardUrl,
  READ_SURVEY_ROLES,
  ANALYST_ROLES,
  EDITOR_ROLES,
  ADMIN_ROLES,
  hashToken,
  parseRequiredCsvValue,
  validateSurveyDefinition,
  validateRequiredAnswers,
  normalizeQuestionNames,
} = require('../server');

test('question schema requiredness is explicit, typed, and validates submitted answers', () => {
  assert.equal(parseRequiredCsvValue(undefined), true, 'legacy CSV remains required');
  assert.equal(parseRequiredCsvValue('false'), false);
  assert.equal(parseRequiredCsvValue('TRUE'), true);

  const schema = validateSurveyDefinition({
    elements: [
      { type: 'tagbox', name: 'legacy', title: 'Legacy optional' },
      { type: 'draggableranking', name: 'required', title: 'Rank', isRequired: true },
    ]
  });
  assert.equal(schema.elements[0].isRequired, false);
  assert.equal(schema.elements[1].isRequired, true);
  assert.deepEqual(validateRequiredAnswers(schema, { legacy: [] }), ['Invalid response: required']);
  assert.deepEqual(validateRequiredAnswers(schema, { required: ['a'] }), []);
  assert.deepEqual(validateRequiredAnswers(schema, { required: {} }), ['Invalid response: required']);
  assert.deepEqual(validateRequiredAnswers(schema, { legacy: {} , required: ['a'] }), ['Invalid response: legacy']);
  const conditionalSchema = validateSurveyDefinition({ elements: [
    { type: 'boolean', name: 'show' },
    { type: 'text', name: 'conditional', isRequired: true, visibleIf: '{show} = true' },
  ] });
  assert.deepEqual(validateRequiredAnswers(conditionalSchema, { show: false }), []);
  assert.deepEqual(validateRequiredAnswers(conditionalSchema, { show: true }), ['Invalid response: conditional']);
  assert.deepEqual(
    normalizeQuestionNames(conditionalSchema).elements[1].visibleIf,
    '{question_1} = true'
  );
  const collisionSchema = {
    elements: [
      { type: 'text', name: 'alpha' },
      { type: 'text', name: 'question_1', visibleIf: "{alpha} = 'yes'" },
    ],
  };
  assert.equal(
    normalizeQuestionNames(collisionSchema).elements[1].visibleIf,
    "{question_1} = 'yes'",
    'a replacement must not be rewritten again when it matches another old name'
  );
  const canonicalReferenceSchema = {
    elements: [
      { type: 'text', name: 'question_1' },
      { type: 'text', name: 'question_2', visibleIf: "{question_1} = 'yes'" },
    ],
  };
  assert.equal(
    normalizeQuestionNames(canonicalReferenceSchema).elements[1].visibleIf,
    "{question_1} = 'yes'",
    'an already-canonical reference must remain unchanged'
  );
  const unknownReferenceSchema = {
    elements: [{ type: 'text', name: 'alpha', visibleIf: "{not_a_question} = 'yes'" }],
  };
  assert.equal(
    normalizeQuestionNames(unknownReferenceSchema).elements[0].visibleIf,
    "{not_a_question} = 'yes'",
    'references outside the schema must remain unchanged'
  );
  assert.throws(() => validateSurveyDefinition({ elements: [{ type: 'tagbox', isRequired: 'false' }] }), /required/);
});

test('dashboard URL helpers prefer DASHBOARD_URL and fall back to FRONTEND_URL', (t) => {
  const originalDashboardUrl = process.env.DASHBOARD_URL;
  const originalFrontendUrl = process.env.FRONTEND_URL;
  t.after(() => {
    if (originalDashboardUrl === undefined) delete process.env.DASHBOARD_URL;
    else process.env.DASHBOARD_URL = originalDashboardUrl;
    if (originalFrontendUrl === undefined) delete process.env.FRONTEND_URL;
    else process.env.FRONTEND_URL = originalFrontendUrl;
  });

  delete process.env.DASHBOARD_URL;
  process.env.FRONTEND_URL = 'https://dashboard.example.com/';
  assert.equal(getDashboardBaseUrl(), 'https://dashboard.example.com');
  assert.equal(buildDashboardUrl('/accept-invite?token=abc'), 'https://dashboard.example.com/accept-invite?token=abc');

  process.env.DASHBOARD_URL = 'https://admin.example.com/';
  assert.equal(getDashboardBaseUrl(), 'https://admin.example.com');
  assert.equal(buildDashboardUrl('reset-password?token=abc'), 'https://admin.example.com/reset-password?token=abc');
});

test('dashboard/admin endpoints require authentication', async () => {
  const endpoints = [
    ['post', '/api/survey', { surveyName: 'S' }],
    ['post', '/api/testEmail', { surveyName: 'S', language: 'English', email: 'a@example.com' }],
    ['post', '/api/startSurvey', { surveyName: 'S' }],
    ['post', '/api/updateEmails', { surveyName: 'S', csvData: 'English,Hello' }],
    ['post', '/api/updateTarget', { surveyName: 'S', csvData: 'First,Last,Email\nA,B,a@example.com' }],
    ['post', '/api/updateTargets', { surveyName: 'S', csvData: 'First,Last,Email\nA,B,a@example.com' }],
    ['post', '/api/updateQuestions', { surveyName: 'S', questions: { elements: [] } }],
    ['get', '/api/survey-notifications/S'],
    ['get', '/api/admin/names?surveyName=S'],
    ['get', '/api/admin/questions?surveyName=S'],
    ['get', '/api/listQuestions?surveyName=S'],
    ['get', '/api/results?surveyName=S'],
    ['get', '/api/targets?surveyName=S'],
    ['get', '/api/surveyStatus?surveyName=S'],
    ['get', '/api/orgs'],
  ];

  for (const [method, url, body] of endpoints) {
    const res = await request(app)[method](url).send(body || {});
    assert.equal(res.status, 401, `${method.toUpperCase()} ${url}`);
  }
});

test('public signup can be disabled by ALLOW_PUBLIC_SIGNUP=false', async () => {
  const res = await request(app)
    .post('/api/register')
    .send({ username: 'new-user', password: 'password123' });

  assert.equal(res.status, 403);
});

test('login rejects disabled users before creating a session', async (t) => {
  const originalQuery = pool.query;
  t.after(() => {
    pool.query = originalQuery;
  });

  const hashedPassword = await bcrypt.hash('password123', 4);
  pool.query = async (sql, values) => {
    assert.match(sql, /SELECT \* FROM users WHERE username = \$1/);
    assert.deepEqual(values, ['disabled-user']);
    return { rows: [{ id: 44, username: 'disabled-user', password: hashedPassword, status: 'disabled' }] };
  };

  const res = await request(app)
    .post('/api/login')
    .send({ username: 'disabled-user', password: 'password123' });

  assert.equal(res.status, 403);
  assert.match(res.body.error, /disabled/i);
});

test('login updates last_login_at when IAM column exists and returns safe user shape', async (t) => {
  const originalQuery = pool.query;
  t.after(() => {
    pool.query = originalQuery;
  });

  const hashedPassword = await bcrypt.hash('password123', 4);
  let updatedLastLogin = false;
  pool.query = async (sql, values) => {
    if (/SELECT \* FROM users WHERE username = \$1/.test(sql)) {
      return {
        rows: [{
          id: 45,
          username: 'active-user',
          password: hashedPassword,
          email: 'active@example.com',
          display_name: 'Active User',
          status: 'active',
          is_platform_admin: false,
        }]
      };
    }

    if (/information_schema\.columns/.test(sql)) {
      assert.deepEqual(values, ['users', 'last_login_at']);
      return { rows: [{ '?column?': 1 }] };
    }

    if (/UPDATE users SET last_login_at = CURRENT_TIMESTAMP WHERE id = \$1/.test(sql)) {
      updatedLastLogin = true;
      assert.deepEqual(values, [45]);
      return { rows: [], rowCount: 1 };
    }

    // connect-pg-simple session destroy/set/touch queries during regenerate/save.
    if (/sessions/i.test(sql)) {
      return { rows: [], rowCount: 1 };
    }

    return { rows: [], rowCount: 0 };
  };

  const res = await request(app)
    .post('/api/login')
    .send({ username: 'active-user', password: 'password123' });

  assert.equal(res.status, 200);
  assert.equal(updatedLastLogin, true);
  assert.equal(res.body.user.username, 'active-user');
  assert.equal(res.body.user.email, 'active@example.com');
  assert.equal(res.body.user.displayName, 'Active User');
  assert.equal(res.body.user.password, undefined);
});

test('requireAuth loads current user and rejects disabled account status', async (t) => {
  const originalQuery = pool.query;
  t.after(() => {
    pool.query = originalQuery;
  });

  pool.query = async (sql, values) => {
    assert.match(sql, /SELECT \* FROM users WHERE id = \$1/);
    assert.deepEqual(values, [52]);
    return { rows: [{ id: 52, username: 'disabled-user', status: 'disabled' }] };
  };

  const req = { session: { userId: 52 } };
  const res = {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
  let nextCalled = false;

  await requireAuth(req, res, () => { nextCalled = true; });

  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 403);
  assert.match(res.body.error, /disabled/i);
});

test('schema capability helpers do not cache failed inspections as false', async (t) => {
  const originalQuery = pool.query;
  t.after(() => {
    pool.query = originalQuery;
  });

  let calls = 0;
  pool.query = async () => {
    calls += 1;
    if (calls === 1) {
      throw new Error('temporary metadata outage');
    }
    return { rows: [{ '?column?': 1 }] };
  };

  const columnName = `temporary_column_${Date.now()}`;
  assert.equal(await columnExists('users', columnName), false);
  assert.equal(await columnExists('users', columnName), true);
  assert.equal(calls, 2);
});

test('schema capability helpers do not cache failed table inspections as false', async (t) => {
  const originalQuery = pool.query;
  t.after(() => {
    pool.query = originalQuery;
  });

  let calls = 0;
  pool.query = async () => {
    calls += 1;
    if (calls === 1) {
      throw new Error('temporary metadata outage');
    }
    return { rows: [{ '?column?': 1 }] };
  };

  const tableName = `temporary_table_${Date.now()}`;
  assert.equal(await tableExists(tableName), false);
  assert.equal(await tableExists(tableName), true);
  assert.equal(calls, 2);
});

test('safe user serialization omits password hashes', () => {
  const safe = toSafeUser({
    id: 1,
    username: 'user',
    password: 'hash',
    email: 'user@example.com',
    display_name: 'User',
    status: 'active',
    is_platform_admin: true,
  });

  assert.deepEqual(safe, {
    id: 1,
    username: 'user',
    email: 'user@example.com',
    displayName: 'User',
    status: 'active',
    isPlatformAdmin: true,
    lastLoginAt: null,
  });
  assert.equal(safe.password, undefined);
});

test('remaining IAM migration adds audit, invite/reset, and non-destructive survey identifier foundation', () => {
  const changelog = fs.readFileSync(path.join(__dirname, '../../db/changelogs/master-changelog.xml'), 'utf8');
  const remaining = fs.readFileSync(path.join(__dirname, '../../db/changelogs/v1_4_product_iam_remaining.sql'), 'utf8');

  assert.match(changelog, /v1_4_product_iam_remaining\.sql/);
  assert.match(remaining, /CREATE TABLE IF NOT EXISTS audit_events/i);
  assert.match(remaining, /CREATE TABLE IF NOT EXISTS organization_invites/i);
  assert.match(remaining, /CREATE TABLE IF NOT EXISTS password_reset_tokens/i);
  assert.match(remaining, /ALTER TABLE Survey ADD COLUMN IF NOT EXISTS display_name/i);
  assert.match(remaining, /CREATE UNIQUE INDEX IF NOT EXISTS idx_survey_org_slug_active/i);
  assert.match(remaining, /active_slug_population/i);
  assert.match(remaining, /active_slug_duplicates/i);
  assert.match(remaining, /slug = s\.slug \|\| '-' \|\| s\.id::text/i);
  assert.doesNotMatch(remaining, /\bDROP\b|\bTRUNCATE\b|\bDELETE\s+FROM\b|ALTER\s+TABLE[\s\S]+DROP\s+COLUMN/i);
});

test('password reset request stores only token hash and returns raw token only with explicit manual-delivery flag', async (t) => {
  const originalQuery = pool.query;
  const originalReturnDevTokens = process.env.RETURN_DEV_TOKENS;
  process.env.RETURN_DEV_TOKENS = 'true';
  t.after(() => {
    pool.query = originalQuery;
    if (originalReturnDevTokens === undefined) delete process.env.RETURN_DEV_TOKENS;
    else process.env.RETURN_DEV_TOKENS = originalReturnDevTokens;
  });

  const calls = [];
  pool.query = async (sql, values) => {
    calls.push({ sql, values });
    if (/SELECT id, username, email FROM users/.test(sql)) {
      return { rows: [{ id: 9, username: 'reset-user', email: 'reset@example.com' }] };
    }
    if (/information_schema\.tables/.test(sql)) {
      return { rows: [] };
    }
    return { rows: [], rowCount: 1 };
  };

  const res = await request(app)
    .post('/api/password-reset/request')
    .send({ username: 'reset-user' });

  assert.equal(res.status, 200);
  assert.equal(typeof res.body.token, 'string');
  const insertCall = calls.find(call => /INSERT INTO password_reset_tokens/.test(call.sql));
  assert.ok(insertCall);
  assert.notEqual(insertCall.values[1], res.body.token);
  assert.equal(insertCall.values[1], hashToken(res.body.token));
});

test('password reset request does not expose raw token based on NODE_ENV alone', async (t) => {
  const originalQuery = pool.query;
  const originalReturnDevTokens = process.env.RETURN_DEV_TOKENS;
  delete process.env.RETURN_DEV_TOKENS;
  t.after(() => {
    pool.query = originalQuery;
    if (originalReturnDevTokens === undefined) delete process.env.RETURN_DEV_TOKENS;
    else process.env.RETURN_DEV_TOKENS = originalReturnDevTokens;
  });

  pool.query = async (sql) => {
    if (/SELECT id, username, email FROM users/.test(sql)) {
      return { rows: [{ id: 19, username: 'reset-user', email: 'reset@example.com' }] };
    }
    return { rows: [], rowCount: 1 };
  };

  const res = await request(app)
    .post('/api/password-reset/request')
    .send({ username: 'reset-user' });

  assert.equal(res.status, 200);
  assert.equal(res.body.success, true);
  assert.equal(res.body.token, undefined);
  assert.equal(res.body.resetUrl, undefined);
});

test('member update API prevents admins from assigning owner role', async (t) => {
  const originalQuery = pool.query;
  const originalConnect = pool.connect;
  t.after(() => {
    pool.query = originalQuery;
    pool.connect = originalConnect;
  });

  const hashedPassword = await bcrypt.hash('password123', 4);
  pool.query = async (sql, values) => {
    if (/SELECT \* FROM users WHERE username = \$1/.test(sql)) {
      return { rows: [{ id: 10, username: 'admin-user', password: hashedPassword, status: 'active' }] };
    }
    if (/SELECT \* FROM users WHERE id = \$1/.test(sql)) {
      return { rows: [{ id: 10, username: 'admin-user', status: 'active' }] };
    }
    if (/information_schema\.columns/.test(sql)) return { rows: [] };
    if (/SELECT[\s\S]+sess[\s\S]+FROM[\s\S]+sessions/i.test(sql)) {
      return { rows: [{ sess: { cookie: {}, userId: 10, username: 'admin-user' } }], rowCount: 1 };
    }
    if (/sessions/i.test(sql)) return { rows: [], rowCount: 1 };
    if (/FROM organization_memberships om/.test(sql)) return { rows: [] };
    if (/FROM organization_memberships\s+WHERE organization_id = \$1 AND user_id = \$2/.test(sql)) {
      return { rows: [{ role: 'admin', organization_id: values[0] }] };
    }
    return { rows: [], rowCount: 0 };
  };

  const agent = request.agent(app);
  const loginRes = await agent.post('/api/login').send({ username: 'admin-user', password: 'password123' });
  assert.equal(loginRes.status, 200);

  let updateAttempted = false;
  pool.connect = async () => ({
    query: async (sql, values) => {
      if (sql === 'BEGIN' || sql === 'ROLLBACK' || sql === 'COMMIT') return { rows: [], rowCount: 0 };
      if (/SELECT om\.role\s+FROM organization_memberships om/.test(sql)) {
        return { rows: [{ role: 'admin' }] };
      }
      if (/SELECT om\.role, u\.status, u\.username/.test(sql)) {
        return { rows: [{ role: 'editor', status: 'active', username: 'target-user' }] };
      }
      if (/UPDATE organization_memberships|UPDATE users/.test(sql)) updateAttempted = true;
      return { rows: [], rowCount: 0 };
    },
    release() {}
  });

  const res = await agent
    .patch('/api/orgs/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/members/11')
    .send({ role: 'owner' });

  assert.equal(res.status, 403);
  assert.match(res.body.message, /Only owners can assign owner role/);
  assert.equal(updateAttempted, false);
});

test('platform admin organization list endpoint requires platform admin and returns member counts', async (t) => {
  const originalQuery = pool.query;
  t.after(() => {
    pool.query = originalQuery;
  });

  const hashedPassword = await bcrypt.hash('password123', 4);
  pool.query = async (sql, values) => {
    if (/SELECT \* FROM users WHERE username = \$1/.test(sql)) {
      return { rows: [{ id: 77, username: 'platform-user', password: hashedPassword, status: 'active', is_platform_admin: true }] };
    }
    if (/SELECT \* FROM users WHERE id = \$1/.test(sql)) {
      return { rows: [{ id: 77, username: 'platform-user', status: 'active', is_platform_admin: true }] };
    }
    if (/information_schema\.columns/.test(sql) || /information_schema\.tables/.test(sql)) return { rows: [] };
    if (/SELECT[\s\S]+sess[\s\S]+FROM[\s\S]+sessions/i.test(sql)) {
      return { rows: [{ sess: { cookie: {}, userId: 77, username: 'platform-user' } }], rowCount: 1 };
    }
    if (/sessions/i.test(sql)) return { rows: [], rowCount: 1 };
    if (/SELECT o\.id, o\.name, o\.slug, COUNT\(om\.user_id\)::int AS "memberCount"/.test(sql)) {
      return { rows: [{ id: 'org-1', name: 'Default / Imported', slug: 'default-imported', memberCount: 2 }] };
    }
    return { rows: [], rowCount: 0 };
  };

  const agent = request.agent(app);
  const loginRes = await agent.post('/api/login').send({ username: 'platform-user', password: 'password123' });
  assert.equal(loginRes.status, 200);

  const res = await agent.get('/api/orgs');
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.organizations, [{ id: 'org-1', name: 'Default / Imported', slug: 'default-imported', memberCount: 2 }]);
});

test('local db setup bootstraps local admin IAM access after migrations', () => {
  const setupSource = fs.readFileSync(path.join(__dirname, '../../scripts/db-setup.js'), 'utf8');
  assert.match(setupSource, /is_platform_admin/);
  assert.match(setupSource, /status = EXCLUDED\.status/);
  assert.match(setupSource, /organization_memberships/);
  assert.match(setupSource, /default-imported/);
  assert.match(setupSource, /DO UPDATE SET role = 'owner'/);
});

test('member management, invite, reset, and audit routes are present with required guardrails', () => {
  const serverSource = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
  assert.match(serverSource, /app\.get\('\/api\/orgs'/);
  assert.match(serverSource, /Platform admin access is required/);
  assert.match(serverSource, /app\.get\('\/api\/orgs\/:organizationId\/members'/);
  assert.match(serverSource, /app\.patch\('\/api\/orgs\/:organizationId\/members\/:userId'/);
  assert.match(serverSource, /You cannot disable your own account/);
  assert.match(serverSource, /Cannot remove the last active owner/);
  assert.match(serverSource, /Only owners can modify owners/);
  assert.match(serverSource, /Only owners can assign owner role/);
  assert.match(serverSource, /lockedActorMembership/);
  assert.match(serverSource, /FOR UPDATE`/);
  assert.match(serverSource, /lockRows: true/);
  assert.match(serverSource, /app\.post\('\/api\/orgs\/:organizationId\/invites'/);
  assert.match(serverSource, /app\.post\('\/api\/invites\/accept'/);
  assert.match(serverSource, /app\.post\('\/api\/password-reset\/request'/);
  assert.match(serverSource, /app\.post\('\/api\/password-reset\/complete'/);
  assert.match(serverSource, /eventType: 'member\.updated'/);
  assert.match(serverSource, /eventType: 'survey\.archived'/);
});

test('/api/testEmail rejects arbitrary recipients instead of falling back to another respondent token', async (t) => {
  const originalQuery = pool.query;
  const originalConnect = pool.connect;
  t.after(() => {
    pool.query = originalQuery;
    pool.connect = originalConnect;
  });

  const hashedPassword = await bcrypt.hash('password123', 4);
  pool.query = async (sql, values) => {
    if (/SELECT \* FROM users WHERE username = \$1/.test(sql)) {
      return { rows: [{ id: 31, username: 'editor-user', password: hashedPassword, status: 'active' }] };
    }
    if (/SELECT \* FROM users WHERE id = \$1/.test(sql)) {
      return { rows: [{ id: 31, username: 'editor-user', status: 'active' }] };
    }
    if (/information_schema\.columns/.test(sql)) return { rows: [] };
    if (/SELECT[\s\S]+sess[\s\S]+FROM[\s\S]+sessions/i.test(sql)) {
      return { rows: [{ sess: { cookie: {}, userId: 31, username: 'editor-user' } }], rowCount: 1 };
    }
    if (/sessions/i.test(sql)) return { rows: [], rowCount: 1 };
    if (/LEFT JOIN organization_memberships/.test(sql)) {
      return {
        rows: [{
          id: '11111111-1111-4111-8111-111111111111',
          name: 'Survey A',
          organization_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          role: 'editor',
        }]
      };
    }
    return { rows: [], rowCount: 0 };
  };

  const sendTestQueries = [];
  pool.connect = async () => ({
    query: async (sql, values) => {
      sendTestQueries.push({ sql, values });
      if (/SELECT text FROM email/.test(sql)) return { rows: [{ text: 'Hello {{link}}' }] };
      if (/SELECT uuid FROM Respondent/.test(sql)) {
        assert.match(sql, /lower\(contact_info\) = lower\(\$3\)/);
        assert.deepEqual(values, ['11111111-1111-4111-8111-111111111111', 'Survey A', 'attacker@example.com']);
        return { rows: [] };
      }
      return { rows: [], rowCount: 0 };
    },
    release() {}
  });

  const agent = request.agent(app);
  const loginRes = await agent.post('/api/login').send({ username: 'editor-user', password: 'password123' });
  assert.equal(loginRes.status, 200);

  const res = await agent
    .post('/api/testEmail')
    .send({ surveyName: 'Survey A', language: 'English', email: 'attacker@example.com' });

  assert.equal(res.status, 404);
  assert.match(res.body.message, /Reminders can only be sent/);
  assert.equal(sendTestQueries.some((call) => /SELECT uuid FROM Respondent/.test(call.sql)), true);
});

test('dashboard read-only tables hide edit controls and demo email avoids public demo token', () => {
  const questionTable = fs.readFileSync(path.join(__dirname, '../../dashboard/src/components/QuestionTable.js'), 'utf8');
  const respondentTable = fs.readFileSync(path.join(__dirname, '../../dashboard/src/components/RespondentTable.js'), 'utf8');
  const serverSource = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');

  assert.match(questionTable, /readOnly = false/);
  assert.match(questionTable, /editable: !readOnly/);
  assert.match(questionTable, /!readOnly &&/);
  assert.match(respondentTable, /readOnly = false/);
  assert.match(respondentTable, /disabled=\{readOnly\}/);
  assert.match(respondentTable, /!readOnly &&/);
  assert.match(respondentTable, /surveyName,/);
  assert.doesNotMatch(respondentTable, /params\.row\.surveyName/);
  assert.doesNotMatch(serverSource, /sendMail\(email, 'demo'/);
  assert.match(serverSource, /lower\(contact_info\) = lower\(\$3\)/);
  assert.match(serverSource, /No active respondent token found/);
});

test('demo seed is local-guarded, idempotent, and uses real respondent tokens', () => {
  const seed = fs.readFileSync(path.join(__dirname, '../../scripts/dev/seed-demo-account.js'), 'utf8');
  const menu = fs.readFileSync(path.join(__dirname, '../../dashboard/src/components/SurveyTableMenuCell.js'), 'utf8');
  assert.match(seed, /DEMO_SEED_ALLOW_NONLOCAL/);
  assert.match(seed, /ON CONFLICT \(slug\) DO UPDATE/);
  assert.match(seed, /ON CONFLICT \(username\) DO UPDATE/);
  assert.match(seed, /ON CONFLICT \(name, survey_name\) DO UPDATE/);
  assert.match(seed, /demo-alex-token/);
  assert.doesNotMatch(seed, /userId=demo/);
  assert.doesNotMatch(menu, /userId=demo/);
});

test('Phase 2/3 IAM migrations are included and avoid destructive operations', () => {
  const changelog = fs.readFileSync(path.join(__dirname, '../../db/changelogs/master-changelog.xml'), 'utf8');
  const phase2 = fs.readFileSync(path.join(__dirname, '../../db/changelogs/v1_2_product_iam_foundation.sql'), 'utf8');
  const archive = fs.readFileSync(path.join(__dirname, '../../db/changelogs/v1_3_survey_archive.sql'), 'utf8');

  assert.match(changelog, /v1_2_product_iam_foundation\.sql/);
  assert.match(changelog, /v1_3_survey_archive\.sql/);
  assert.match(phase2, /CREATE EXTENSION IF NOT EXISTS pgcrypto/i);
  assert.match(phase2, /CREATE TABLE IF NOT EXISTS organizations/i);
  assert.match(phase2, /organization_memberships/i);
  assert.match(phase2, /ALTER TABLE Survey ADD COLUMN IF NOT EXISTS id UUID;/i);
  assert.match(phase2, /UPDATE Survey SET id = gen_random_uuid\(\) WHERE id IS NULL/i);
  assert.match(phase2, /ALTER TABLE Survey ALTER COLUMN id SET DEFAULT gen_random_uuid\(\)/i);
  assert.match(phase2, /conrelid = 'users'::regclass/i);
  assert.match(archive, /ADD COLUMN IF NOT EXISTS archived_at/i);
  assert.match(archive, /ADD COLUMN IF NOT EXISTS archived_by_user_id/i);
  assert.doesNotMatch(phase2 + '\n' + archive, /\bDROP\b|\bTRUNCATE\b|\bDELETE\s+FROM\b|ALTER\s+TABLE[\s\S]+DROP\s+COLUMN/i);
});

test('role policy matrix matches org-scoped authorization decisions', () => {
  for (const role of ['viewer', 'analyst', 'editor', 'admin', 'owner']) {
    assert.equal(hasAnyRole(role, READ_SURVEY_ROLES), true, `${role} can read metadata/questions`);
  }

  assert.equal(hasAnyRole('viewer', ANALYST_ROLES), false);
  assert.equal(hasAnyRole('analyst', ANALYST_ROLES), true);
  assert.equal(hasAnyRole('analyst', EDITOR_ROLES), false);
  assert.equal(hasAnyRole('editor', EDITOR_ROLES), true);
  assert.equal(hasAnyRole('editor', ADMIN_ROLES), false);
  assert.equal(hasAnyRole('admin', ADMIN_ROLES), true);
  assert.equal(hasAnyRole('owner', ADMIN_ROLES), true);
});

test('resolveSurveyForUser denies cross-org guessed surveyName before downstream reads', async (t) => {
  const originalQuery = pool.query;
  t.after(() => {
    pool.query = originalQuery;
  });

  let queries = 0;
  pool.query = async (sql, values) => {
    queries += 1;
    assert.match(sql, /LEFT JOIN organization_memberships/);
    assert.deepEqual(values, [7, 'Org B Secret']);
    return {
      rows: [{
        id: '22222222-2222-4222-8222-222222222222',
        name: 'Org B Secret',
        organization_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        role: null,
      }]
    };
  };

  const res = { statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
  const survey = await resolveSurveyForUser({ user: { id: 7, isPlatformAdmin: false } }, res, {
    surveyName: 'Org B Secret',
    allowedRoles: ANALYST_ROLES,
  });

  assert.equal(survey, null);
  assert.equal(res.statusCode, 404);
  assert.equal(queries, 1);
});

test('resolveSurveyForUser allows platform admin without membership', async (t) => {
  const originalQuery = pool.query;
  t.after(() => {
    pool.query = originalQuery;
  });

  pool.query = async () => ({
    rows: [{
      id: '33333333-3333-4333-8333-333333333333',
      name: 'Any Survey',
      organization_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      role: null,
    }]
  });

  const res = { status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
  const survey = await resolveSurveyForUser({ user: { id: 1, isPlatformAdmin: true } }, res, {
    surveyName: 'Any Survey',
    allowedRoles: ADMIN_ROLES,
  });

  assert.equal(survey.name, 'Any Survey');
  assert.equal(survey.role, 'owner');
  assert.equal(res.statusCode, undefined);
});

test('survey create organization defaulting handles none, one, multiple, and platform admin explicit requirement', async (t) => {
  const originalQuery = pool.query;
  t.after(() => {
    pool.query = originalQuery;
  });

  let memberships = [];
  pool.query = async (sql, values) => {
    assert.match(sql, /FROM organization_memberships/);
    assert.deepEqual(values, [42]);
    return { rows: memberships };
  };

  const makeRes = () => ({ statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } });
  const req = { user: { id: 42, isPlatformAdmin: false } };

  memberships = [];
  let res = makeRes();
  assert.equal(await getDefaultOrganizationForUser(req, res), null);
  assert.equal(res.statusCode, 403);

  memberships = [{ organization_id: 'org-a', role: 'editor' }];
  res = makeRes();
  assert.deepEqual(await getDefaultOrganizationForUser(req, res), memberships[0]);
  assert.equal(res.statusCode, 200);

  memberships = [{ organization_id: 'org-a', role: 'editor' }, { organization_id: 'org-b', role: 'owner' }];
  res = makeRes();
  assert.equal(await getDefaultOrganizationForUser(req, res), null);
  assert.equal(res.statusCode, 400);

  res = makeRes();
  assert.equal(await getDefaultOrganizationForUser({ user: { id: 1, isPlatformAdmin: true } }, res), null);
  assert.equal(res.statusCode, 400);
});

test('startSurvey email_sent update and survey archive implementation are scoped and non-destructive', () => {
  const serverSource = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
  assert.match(serverSource, /UPDATE Respondent SET email_sent = true WHERE contact_info = ANY\(\$1\) AND survey_name = \$2/);
  assert.match(serverSource, /UPDATE survey SET archived_at = CURRENT_TIMESTAMP, archived_by_user_id = \$1 WHERE id = \$2/);
  assert.doesNotMatch(serverSource, /DELETE FROM email WHERE survey_name[\s\S]+DELETE FROM respondent WHERE survey_name[\s\S]+DELETE FROM survey WHERE name/);
});

test('/api/names rejects demo and does not query/return respondent names', async (t) => {
  const originalQuery = pool.query;
  t.after(() => {
    pool.query = originalQuery;
  });

  const calls = [];
  pool.query = async (sql, values) => {
    calls.push({ sql, values });
    return { rows: [] };
  };

  const res = await request(app)
    .get('/api/names')
    .query({ surveyName: 'Survey A', userId: 'demo' });

  assert.equal(res.status, 403);
  assert.equal(res.body.names, undefined);
  assert.equal(calls.length, 1, 'only the token validation query should run');
  assert.match(calls[0].sql, /JOIN Survey s/);
  assert.match(calls[0].sql, /s\.archived_at IS NULL/);
  assert.deepEqual(calls[0].values, ['demo', 'Survey A']);
});

test('respondent routes reject invalid or mismatched survey/token before returning data', async (t) => {
  const originalQuery = pool.query;
  t.after(() => {
    pool.query = originalQuery;
  });

  pool.query = async () => ({ rows: [] });

  const questionRes = await request(app)
    .get('/api/questions')
    .query({ surveyName: 'Survey B', userId: 'valid-token' });
  assert.equal(questionRes.status, 403);

  const statusRes = await request(app)
    .get('/api/user/status')
    .query({ surveyName: 'Survey B', userId: 'valid-token' });
  assert.equal(statusRes.status, 403);

  const submitRes = await request(app)
    .post('/api/user')
    .send({ surveyName: 'Survey B', userId: 'valid-token', answers: '{}' });
  assert.equal(submitRes.status, 403);
});

test('respondent routes reject archived survey tokens without dashboard session', async (t) => {
  const originalQuery = pool.query;
  t.after(() => {
    pool.query = originalQuery;
  });

  const calls = [];
  pool.query = async (sql, values) => {
    calls.push({ sql, values });
    assert.match(sql, /s\.archived_at IS NULL/);
    assert.deepEqual(values, ['archived-token', 'Archived Survey']);
    return { rows: [] };
  };

  const questionRes = await request(app)
    .get('/api/questions')
    .query({ surveyName: 'Archived Survey', userId: 'archived-token' });
  assert.equal(questionRes.status, 403);

  const statusRes = await request(app)
    .get('/api/user/status')
    .query({ surveyName: 'Archived Survey', userId: 'archived-token' });
  assert.equal(statusRes.status, 403);

  const submitRes = await request(app)
    .post('/api/user')
    .send({ surveyName: 'Archived Survey', userId: 'archived-token', answers: '{}' });
  assert.equal(submitRes.status, 403);

  const namesRes = await request(app)
    .get('/api/names')
    .query({ surveyName: 'Archived Survey', userId: 'archived-token' });
  assert.equal(namesRes.status, 403);
  assert.equal(calls.length, 4);
});

test('/api/questions rejects demo token for arbitrary survey definitions', async (t) => {
  const originalQuery = pool.query;
  t.after(() => {
    pool.query = originalQuery;
  });

  pool.query = async () => ({ rows: [] });

  const res = await request(app)
    .get('/api/questions')
    .query({ surveyName: 'Survey A', userId: 'demo' });

  assert.equal(res.status, 403);
});

test('respondent token validation requires uuid, surveyName match, can_respond=true, and active survey', async (t) => {
  const originalQuery = pool.query;
  t.after(() => {
    pool.query = originalQuery;
  });

  const calls = [];
  pool.query = async (sql, values) => {
    calls.push({ sql, values });
    assert.match(sql, /JOIN Survey s/);
    assert.match(sql, /s\.archived_at IS NULL/);
    if (values[0] === 'valid-token' && values[1] === 'Survey A') {
      return { rows: [{ respondent_id: 1, response: null, can_respond: true, survey_id: 'survey-a-id' }] };
    }
    if (values[0] === 'disabled-token' && values[1] === 'Survey A') {
      return { rows: [{ respondent_id: 2, response: null, can_respond: false, survey_id: 'survey-a-id' }] };
    }
    // Archived surveys are rejected because the JOIN + archived_at predicate returns no rows.
    if (values[0] === 'archived-token' && values[1] === 'Archived Survey') {
      return { rows: [] };
    }
    return { rows: [] };
  };

  const ok = await validateRespondentToken('Survey A', 'valid-token');
  assert.equal(ok.ok, true);
  assert.equal(ok.respondent.survey_id, 'survey-a-id');
  assert.deepEqual(calls.at(-1).values, ['valid-token', 'Survey A']);

  const wrongSurvey = await validateRespondentToken('Survey B', 'valid-token');
  assert.equal(wrongSurvey.ok, false);
  assert.equal(wrongSurvey.status, 403);

  const disabled = await validateRespondentToken('Survey A', 'disabled-token');
  assert.equal(disabled.ok, false);
  assert.equal(disabled.status, 403);

  const archived = await validateRespondentToken('Archived Survey', 'archived-token');
  assert.equal(archived.ok, false);
  assert.equal(archived.status, 403);

  const demo = await validateRespondentToken('Survey A', 'demo');
  assert.equal(demo.ok, false);
  assert.equal(demo.status, 403);
});
