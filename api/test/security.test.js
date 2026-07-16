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

const { app, pool, validateRespondentToken, requireAuth, toSafeUser, columnExists, tableExists } = require('../server');

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

test('Phase 2 IAM migration is included and avoids destructive operations', () => {
  const changelog = fs.readFileSync(path.join(__dirname, '../../db/changelogs/master-changelog.xml'), 'utf8');
  const migration = fs.readFileSync(path.join(__dirname, '../../db/changelogs/v1_2_product_iam_foundation.sql'), 'utf8');

  assert.match(changelog, /v1_2_product_iam_foundation\.sql/);
  assert.match(migration, /CREATE EXTENSION IF NOT EXISTS pgcrypto/i);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS organizations/i);
  assert.match(migration, /organization_memberships/i);
  assert.match(migration, /ALTER TABLE Survey ADD COLUMN IF NOT EXISTS id UUID;/i);
  assert.match(migration, /UPDATE Survey SET id = gen_random_uuid\(\) WHERE id IS NULL/i);
  assert.match(migration, /ALTER TABLE Survey ALTER COLUMN id SET DEFAULT gen_random_uuid\(\)/i);
  assert.match(migration, /conrelid = 'users'::regclass/i);
  assert.doesNotMatch(migration, /\bDROP\b|\bTRUNCATE\b|\bDELETE\s+FROM\b|ALTER\s+TABLE[\s\S]+DROP\s+COLUMN/i);
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
  assert.match(calls[0].sql, /WHERE uuid = \$1 AND survey_name = \$2/);
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

test('respondent token validation requires uuid, surveyName match, and can_respond=true', async (t) => {
  const originalQuery = pool.query;
  t.after(() => {
    pool.query = originalQuery;
  });

  const calls = [];
  pool.query = async (sql, values) => {
    calls.push({ sql, values });
    if (values[0] === 'valid-token' && values[1] === 'Survey A') {
      return { rows: [{ respondent_id: 1, response: null, can_respond: true }] };
    }
    if (values[0] === 'disabled-token' && values[1] === 'Survey A') {
      return { rows: [{ respondent_id: 2, response: null, can_respond: false }] };
    }
    return { rows: [] };
  };

  const ok = await validateRespondentToken('Survey A', 'valid-token');
  assert.equal(ok.ok, true);
  assert.deepEqual(calls.at(-1).values, ['valid-token', 'Survey A']);

  const wrongSurvey = await validateRespondentToken('Survey B', 'valid-token');
  assert.equal(wrongSurvey.ok, false);
  assert.equal(wrongSurvey.status, 403);

  const disabled = await validateRespondentToken('Survey A', 'disabled-token');
  assert.equal(disabled.ok, false);
  assert.equal(disabled.status, 403);

  const demo = await validateRespondentToken('Survey A', 'demo');
  assert.equal(demo.ok, false);
  assert.equal(demo.status, 403);
});
