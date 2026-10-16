'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { runtimePool, SECURE_RUNTIME_ENVIRONMENTS } = require('../../scripts/deploy/runtime-pool');

const apiDir = path.resolve(__dirname, '..');

test('deploy controls enforce the secure set for this tranche', () => {
  assert.deepEqual([...SECURE_RUNTIME_ENVIRONMENTS], ['staging']);
});

test('staging deploy controls use the managed DB password callback, not an inline value', async () => {
  const env = {
    EMAIL_WORKER_ENV: 'staging',
    DB_MANAGED_SECRET_ARN: 'arn:aws:secretsmanager:us-east-1:710054969994:secret:synthetic',
    DB_USER: 'synthetic', DB_HOST: '127.0.0.1', DB_SSL: 'false',
  };
  const pool = runtimePool(apiDir, env);
  assert.equal(typeof pool.options.password, 'function');
  await pool.end();
});

test('staging deploy controls reject a plaintext DB password before constructing a pool', () => {
  const env = {
    EMAIL_WORKER_ENV: 'staging',
    DB_MANAGED_SECRET_ARN: 'arn:aws:secretsmanager:us-east-1:710054969994:secret:synthetic',
    DB_PASSWORD: 'synthetic-test-only',
  };
  assert.throws(() => runtimePool(apiDir, env), /without plaintext file values/);
});

test('staging deploy controls require the managed secret ARN with no plaintext fallback', () => {
  assert.throws(() => runtimePool(apiDir, { EMAIL_WORKER_ENV: 'staging' }), /without plaintext file values/);
  assert.throws(() => runtimePool(apiDir, { EMAIL_WORKER_ENV: 'staging', DB_PASSWORD: 'synthetic-test-only' }), /without plaintext file values/);
});

test('legacy prod-secondary deploy controls keep their existing plaintext path', async () => {
  const env = { EMAIL_WORKER_ENV: 'prod-secondary', DB_PASSWORD: 'synthetic-test-only', DB_USER: 'synthetic', DB_HOST: '127.0.0.1', DB_SSL: 'false' };
  const pool = runtimePool(apiDir, env);
  assert.equal(pool.options.password, 'synthetic-test-only');
  await pool.end();
});
