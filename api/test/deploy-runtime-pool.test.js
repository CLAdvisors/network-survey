'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('path');
const { runtimePool } = require('../../scripts/deploy/runtime-pool');

const apiDir = path.resolve(__dirname, '..');
const secureEnv = (extra = {}) => ({
  SECURE_RUNTIME_ENABLED: 'true',
  EMAIL_WORKER_ENV: 'staging',
  DB_MANAGED_SECRET_ARN: 'arn:aws:secretsmanager:us-east-1:710054969994:secret:synthetic',
  DB_USER: 'synthetic', DB_HOST: '127.0.0.1', DB_SSL: 'false',
  ...extra,
});

test('secure target deploy controls use the managed DB password callback, not an inline value', async () => {
  const pool = runtimePool(apiDir, secureEnv());
  assert.equal(typeof pool.options.password, 'function');
  await pool.end();
});

test('secure target deploy controls reject a plaintext DB password before constructing a pool', () => {
  assert.throws(() => runtimePool(apiDir, secureEnv({ DB_PASSWORD: 'synthetic-test-only' })), /without plaintext file values/);
});

test('secure target deploy controls require the managed secret ARN with no plaintext fallback', () => {
  assert.throws(() => runtimePool(apiDir, { SECURE_RUNTIME_ENABLED: 'true', EMAIL_WORKER_ENV: 'staging' }), /without plaintext file values/);
  assert.throws(() => runtimePool(apiDir, { SECURE_RUNTIME_ENABLED: 'true', DB_PASSWORD: 'synthetic-test-only' }), /without plaintext file values/);
});

test('a legacy environment without the flag keeps its existing plaintext path', async () => {
  const env = { SECURE_RUNTIME_ENABLED: 'false', EMAIL_WORKER_ENV: 'prod-secondary', DB_PASSWORD: 'synthetic-test-only', DB_USER: 'synthetic', DB_HOST: '127.0.0.1', DB_SSL: 'false' };
  const pool = runtimePool(apiDir, env);
  assert.equal(pool.options.password, 'synthetic-test-only');
  await pool.end();
});

test('rollback resolves the previous release through the current helper even without its own runtime-pool', async () => {
  const previousRelease = fs.mkdtempSync(path.join(os.tmpdir(), 'network-survey-prev-release-'));
  try {
    fs.mkdirSync(path.join(previousRelease, 'api'));
    fs.mkdirSync(path.join(previousRelease, 'deploy'));
    for (const file of ['runtime-resilience.js', 'db-credentials.js', 'email-metrics.js', 'access-telemetry.js']) {
      fs.copyFileSync(path.join(apiDir, file), path.join(previousRelease, 'api', file));
    }
    fs.symlinkSync(path.join(apiDir, 'node_modules'), path.join(previousRelease, 'api', 'node_modules'));
    fs.writeFileSync(path.join(previousRelease, 'api', '.env.prod'), 'DB_USER=synthetic\nDB_HOST=127.0.0.1\nDB_SSL=false\n');
    // A pre-tranche2 artifact has no deploy/runtime-pool.js of its own.
    assert.equal(fs.existsSync(path.join(previousRelease, 'deploy', 'runtime-pool.js')), false);
    const pool = runtimePool(path.join(previousRelease, 'api'), { EMAIL_WORKER_ENV: 'prod-secondary', DB_PASSWORD: 'synthetic-test-only', DB_USER: 'synthetic', DB_HOST: '127.0.0.1', DB_SSL: 'false' });
    assert.equal(pool.options.password, 'synthetic-test-only');
    await pool.end();
  } finally {
    fs.rmSync(previousRelease, { recursive: true, force: true });
  }
});
