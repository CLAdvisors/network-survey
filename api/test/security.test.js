const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');

process.env.NODE_ENV = 'test';
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'test-secret';
process.env.ALLOW_PUBLIC_SIGNUP = 'false';
process.env.AUTH_RATE_LIMIT_MAX = '1000';
process.env.RESPONDENT_RATE_LIMIT_MAX = '1000';

const { app, pool, validateRespondentToken } = require('../server');

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
