'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { startSecureRuntime, KINDS } = require('../secure-runtime');

test('secure runtime kinds are api, delivery and webhook only', () => {
  assert.deepEqual(Object.keys(KINDS).sort(), ['api', 'delivery', 'webhook']);
});

test('loads runtime secrets after configuration and before evaluating any application module', async () => {
  const calls = [];
  const fake = {
    configure: () => calls.push('config'),
    load: async () => calls.push('secrets'),
    resolve: (moduleName) => {
      calls.push(`require:${moduleName}`);
      return { startServer: () => calls.push('listen'), main: () => calls.push('worker') };
    },
  };
  await startSecureRuntime('api', fake);
  assert.deepEqual(calls, ['config', 'secrets', 'require:./server', 'listen']);
  calls.length = 0;
  await startSecureRuntime('delivery', fake);
  assert.deepEqual(calls, ['config', 'secrets', 'require:./email-worker', 'worker']);
  calls.length = 0;
  await startSecureRuntime('webhook', fake);
  assert.deepEqual(calls, ['config', 'secrets', 'require:./webhook-worker', 'worker']);
});

test('a missing secret prevents application-module initialization and unknown kinds fail closed', async () => {
  let required = false;
  const fake = {
    configure: () => {},
    load: async () => { throw Error('synthetic-secret'); },
    resolve: () => { required = true; },
  };
  await assert.rejects(startSecureRuntime('api', fake), /synthetic-secret/);
  assert.equal(required, false);
  await assert.rejects(startSecureRuntime('analysis', fake), /Unsupported secure runtime kind/);
  await assert.rejects(startSecureRuntime('unknown', fake), /Unsupported secure runtime kind/);
});

test('PM2 routes a secure target child through the secure loader without embedding secret values', () => {
  const previous = {
    SECURE_RUNTIME_ENABLED: process.env.SECURE_RUNTIME_ENABLED,
    EMAIL_WORKER_ENV: process.env.EMAIL_WORKER_ENV,
    SESSION_SECRET: process.env.SESSION_SECRET,
    DB_PASSWORD: process.env.DB_PASSWORD,
  };
  const configPath = require.resolve('../../scripts/deploy/ecosystem.config');
  try {
    process.env.SECURE_RUNTIME_ENABLED = 'true';
    process.env.EMAIL_WORKER_ENV = 'staging';
    process.env.SESSION_SECRET = 'synthetic-test-only';
    process.env.DB_PASSWORD = 'synthetic-test-only';
    delete require.cache[configPath];
    const config = require(configPath);
    assert.deepEqual(config.apps.map((app) => app.script), Array(3).fill('secure-runtime.js'));
    assert.deepEqual(config.apps.map((app) => app.args), ['api', 'delivery', 'webhook']);
    assert.deepEqual(config.apps.map((app) => app.env.NODE_ENV), Array(3).fill('production'));
    assert.deepEqual(config.apps.map((app) => app.env.SECURE_RUNTIME_ENABLED), Array(3).fill('true'));
    assert.equal(JSON.stringify(config).includes('synthetic-test-only'), false);
    assert.equal(config.apps.some((app) => app.name === 'ona-analysis-worker'), false);
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    delete require.cache[configPath];
  }
});

test('PM2 keeps legacy staging and prod-secondary on their existing non-secure entry points', () => {
  const previous = process.env.SECURE_RUNTIME_ENABLED;
  const previousEnv = process.env.EMAIL_WORKER_ENV;
  const configPath = require.resolve('../../scripts/deploy/ecosystem.config');
  try {
    for (const environment of ['staging', 'prod-secondary']) {
      delete process.env.SECURE_RUNTIME_ENABLED;
      process.env.EMAIL_WORKER_ENV = environment;
      delete require.cache[configPath];
      const config = require(configPath);
      assert.deepEqual(config.apps.map((app) => app.script), ['server.js', 'email-worker.js', 'webhook-worker.js']);
      assert.deepEqual(config.apps.map((app) => app.args), [undefined, undefined, undefined]);
      assert.deepEqual(config.apps.map((app) => app.env.NODE_ENV), Array(3).fill('prod'));
    }
  } finally {
    if (previous === undefined) delete process.env.SECURE_RUNTIME_ENABLED;
    else process.env.SECURE_RUNTIME_ENABLED = previous;
    if (previousEnv === undefined) delete process.env.EMAIL_WORKER_ENV;
    else process.env.EMAIL_WORKER_ENV = previousEnv;
    delete require.cache[configPath];
  }
});
