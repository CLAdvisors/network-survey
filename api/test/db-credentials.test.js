'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createManagedDatabasePasswordProvider,
  parseManagedDatabaseSecret,
  secretRegion,
} = require('../db-credentials');
const { createPool } = require('../runtime-resilience');

const ARN = 'arn:aws:secretsmanager:us-east-1:123456789012:secret:rds!db-example';

test('managed database password provider reads AWSCURRENT for every physical connection', async () => {
  const calls = [];
  const passwords = ['first-password', 'rotated-password'];
  const provider = createManagedDatabasePasswordProvider({
    DB_MANAGED_SECRET_ARN: ARN,
    DB_USER: 'DbAdmin',
    DB_PASSWORD: 'deployment-password',
  }, {
    client: {
      async send(command) {
        calls.push(command.input);
        return { SecretString:JSON.stringify({ username:'DbAdmin', password:passwords.shift() }) };
      },
    },
  });

  assert.equal(await provider(), 'first-password');
  assert.equal(await provider(), 'rotated-password');
  assert.deepEqual(calls, [
    { SecretId:ARN, VersionStage:'AWSCURRENT' },
    { SecretId:ARN, VersionStage:'AWSCURRENT' },
  ]);
});

test('managed database password provider fails safely when secret retrieval is unavailable', async () => {
  const unavailable = Object.assign(new Error('endpoint unavailable'), { code:'TimeoutError' });
  const provider = createManagedDatabasePasswordProvider({
    DB_MANAGED_SECRET_ARN: ARN,
    DB_USER: 'DbAdmin',
    DB_PASSWORD: 'stale-deployment-password',
  }, { client:{ send:async () => { throw unavailable; } } });
  await assert.rejects(provider(), error => (
    error.code === 'DB_CREDENTIAL_UNAVAILABLE'
    && !error.message.includes('endpoint unavailable')
    && !error.message.includes('stale-deployment-password')
  ));
});

test('managed database password retrieval has a bounded abort and can retry afterward', async () => {
  let calls = 0;
  const provider = createManagedDatabasePasswordProvider({
    DB_MANAGED_SECRET_ARN: ARN,
    DB_USER: 'DbAdmin',
    DB_SECRET_TIMEOUT_MS: '1', // clamped to the safe 250 ms floor
  }, { client:{ send:async (_command, { abortSignal }) => {
    calls += 1;
    if (calls > 1) return { SecretString:JSON.stringify({ username:'DbAdmin', password:'recovered' }) };
    return new Promise((resolve, reject) => abortSignal.addEventListener('abort', () => reject(new Error('aborted')), { once:true }));
  } } });
  await assert.rejects(provider(), error => error.code === 'DB_CREDENTIAL_UNAVAILABLE');
  assert.equal(await provider(), 'recovered');
});

test('managed database password provider deduplicates only concurrent retrievals', async () => {
  let calls = 0;
  let resolve;
  const provider = createManagedDatabasePasswordProvider({
    DB_MANAGED_SECRET_ARN: ARN,
    DB_USER: 'DbAdmin',
  }, { client:{ send:async () => { calls += 1; return new Promise(done => { resolve = done; }); } } });
  const first = provider();
  const second = provider();
  assert.equal(calls, 1);
  resolve({ SecretString:JSON.stringify({ username:'DbAdmin', password:'current' }) });
  assert.equal(await first, 'current');
  assert.equal(await second, 'current');
  await Promise.resolve();
  const third = provider();
  assert.equal(calls, 2);
  resolve({ SecretString:JSON.stringify({ username:'DbAdmin', password:'next' }) });
  assert.equal(await third, 'next');
});

test('managed provider classifies invalid current secret content safely for worker recovery', async () => {
  const provider = createManagedDatabasePasswordProvider({
    DB_MANAGED_SECRET_ARN: ARN,
    DB_USER: 'DbAdmin',
  }, { client:{ send:async () => ({ SecretString:JSON.stringify({ username:'Other', password:'do-not-print' }) }) } });
  await assert.rejects(provider(), error => (
    error.code === 'DB_CREDENTIAL_UNAVAILABLE'
    && !error.message.includes('Other')
    && !error.message.includes('do-not-print')
  ));
});

test('managed database secret validation rejects malformed or mismatched values without exposing them', () => {
  assert.equal(parseManagedDatabaseSecret(JSON.stringify({ username:'DbAdmin', password:'valid' }), 'DbAdmin'), 'valid');
  assert.throws(() => parseManagedDatabaseSecret('not-json', 'DbAdmin'), /not valid JSON/);
  assert.throws(() => parseManagedDatabaseSecret(JSON.stringify({ username:'DbAdmin' }), 'DbAdmin'), /does not contain a password/);
  assert.throws(() => parseManagedDatabaseSecret(JSON.stringify({ password:'do-not-print' }), 'DbAdmin'), /username does not match/);
  assert.throws(() => parseManagedDatabaseSecret(JSON.stringify({ username:'Other', password:'do-not-print' }), 'DbAdmin'), /username does not match/);
});

test('createPool replaces the deployment password with the managed provider', async () => {
  const pool = createPool({
    DB_MANAGED_SECRET_ARN: ARN,
    DB_USER: 'DbAdmin',
    DB_PASSWORD: 'deployment-password',
  }, {
    secretsClient: { send:async () => ({ SecretString:JSON.stringify({ username:'DbAdmin', password:'current-password' }) }) },
  });
  assert.equal(typeof pool.options.password, 'function');
  assert.equal(await pool.options.password(), 'current-password');
  await pool.end();
});

test('managed database credential support is opt-in and derives region from its ARN', () => {
  assert.equal(createManagedDatabasePasswordProvider({ DB_PASSWORD:'static' }), null);
  assert.equal(secretRegion(ARN), 'us-east-1');
  assert.equal(secretRegion('not-an-arn'), undefined);
});
