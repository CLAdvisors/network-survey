'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { credentialKeysIn, validate } = require('../../scripts/deploy/runtime-config-check');

const script = path.resolve(__dirname, '../../scripts/deploy/runtime-config-check.js');

test('accepts a reference-only config and rejects every inline credential form', () => {
  assert.equal(validate('SECURE_RUNTIME_ENABLED=true\nDB_MANAGED_SECRET_ARN=arn:aws:secretsmanager:us-east-1:710054969994:secret:synthetic\nSESSION_SECRET_PARAMETER=/network-survey/staging/api/session-secret\n'), null);
  for (const line of [
    'DB_PASSWORD="synthetic-test-value"',
    'export DB_PASSWORD=synthetic-test-value',
    '   DB_PASSWORD = synthetic-test-value',
    '\tSESSION_SECRET=synthetic-test-value',
    'RESEND_API_KEY=synthetic-test-value',
    'DB_PASSWORD=',
  ]) {
    assert.match(validate(`${line}\nOTHER=value\n`), /inline credential keys/, `must reject: ${JSON.stringify(line)}`);
  }
  assert.deepEqual(credentialKeysIn('export DB_PASSWORD = x\n'), ['DB_PASSWORD']);
  assert.deepEqual(credentialKeysIn('DB_PASSWORD_EXPECTED=x\n'), []);
});

test('writes a clean config to the destination and never writes a rejected one', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'network-survey-config-check-'));
  try {
    const clean = path.join(dir, 'clean.env');
    const cleanRun = spawnSync('node', [script, clean], { input: 'DB_MANAGED_SECRET_ARN=arn:synthetic\nSESSION_SECRET_PARAMETER=/network-survey/staging/api/session-secret\n', encoding: 'utf8' });
    assert.equal(cleanRun.status, 0, cleanRun.stderr);
    assert.match(fs.readFileSync(clean, 'utf8'), /DB_MANAGED_SECRET_ARN=arn:synthetic/);

    const dirty = path.join(dir, 'dirty.env');
    const dirtyRun = spawnSync('node', [script, dirty], { input: 'DB_PASSWORD=synthetic-secret-must-not-appear\n', encoding: 'utf8' });
    assert.equal(dirtyRun.status, 1);
    assert.equal(fs.existsSync(dirty), false, 'a rejected config must never land on disk');
    assert.equal(`${dirtyRun.stdout}${dirtyRun.stderr}`.includes('synthetic-secret-must-not-appear'), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('usage error is a distinct non-zero exit', () => {
  assert.equal(spawnSync('node', [script]).status, 2);
});
