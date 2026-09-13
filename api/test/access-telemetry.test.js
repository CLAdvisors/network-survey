'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');
const { createAccessErrorTelemetry, routeTemplate } = require('../access-telemetry');

function fixture() {
  const records = [];
  let tick = 1_000_000_000n;
  const app = express();
  app.use(createAccessErrorTelemetry({
    env: { ACCESS_ERROR_TELEMETRY_ENABLED: 'true' },
    log: (line) => records.push(line),
    now: () => { tick += 5_000_000n; return tick; },
    requestId: () => 'generated-request-id',
  }));
  app.use(express.json());
  app.get('/api/surveys/:surveyId', (_req, res) => res.status(503).json({ error: 'unavailable' }));
  app.post('/api/login', (_req, res) => res.status(401).json({ error: 'invalid' }));
  app.get('/ok', (_req, res) => res.status(200).end());
  return { app, records };
}

test('4xx/5xx telemetry contains only generated ID, method, route template, status, and duration', async () => {
  const { app, records } = fixture();
  await request(app)
    .post('/api/login?userId=respondent-secret-token')
    .set('Authorization', 'Bearer authorization-secret')
    .set('Cookie', 'session=cookie-secret')
    .send({ email: 'respondent@example.com', password: 'body-secret' })
    .expect('X-Request-Id', 'generated-request-id')
    .expect(401);

  assert.equal(records.length, 1);
  assert.deepEqual(JSON.parse(records[0]), {
    event: 'api_request_error',
    requestId: 'generated-request-id',
    method: 'POST',
    route: '/api/login',
    status: 401,
    durationMs: 5,
  });
  for (const forbidden of ['respondent-secret-token', 'authorization-secret', 'cookie-secret', 'respondent@example.com', 'body-secret', 'userId', 'Authorization', 'Cookie']) {
    assert.equal(records[0].includes(forbidden), false);
  }
});

test('telemetry uses route templates, never path parameter values or query strings', async () => {
  const { app, records } = fixture();
  await request(app).get('/api/surveys/path-secret?token=query-secret').expect(503);
  assert.equal(JSON.parse(records[0]).route, '/api/surveys/:surveyId');
  assert.equal(records[0].includes('path-secret'), false);
  assert.equal(records[0].includes('query-secret'), false);
});

test('successful requests are not logged and unmatched paths are fixed', async () => {
  const { app, records } = fixture();
  await request(app).get('/ok?token=query-secret').expect(200);
  await request(app).get('/secret-path-value?token=query-secret').expect(404);
  assert.equal(records.length, 1);
  assert.equal(JSON.parse(records[0]).route, 'unmatched');
  assert.equal(records[0].includes('secret-path-value'), false);
});

test('routeTemplate never falls back to originalUrl or path', () => {
  assert.equal(routeTemplate({ originalUrl: '/?userId=secret', path: '/secret' }), 'unmatched');
  assert.equal(routeTemplate({ route: { path: '/api/items/:id' }, baseUrl: '' }), '/api/items/:id');
});
