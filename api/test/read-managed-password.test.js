'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { managedDatabasePassword } = require('../../scripts/deploy/read-managed-password');

const script = path.resolve(__dirname, '../../scripts/deploy/read-managed-password.js');

test('returns only the password and enforces the expected username', () => {
  assert.equal(managedDatabasePassword(JSON.stringify({ username: 'DbAdmin', password: 'synthetic-test-only' }), 'DbAdmin'), 'synthetic-test-only');
  assert.throws(() => managedDatabasePassword(JSON.stringify({ username: 'Other', password: 'synthetic-test-only' }), 'DbAdmin'), /username does not match/);
});

test('a malformed or incomplete payload fails with a constant category and never echoes the body', () => {
  for (const payload of ['{not json', JSON.stringify({ username: 'DbAdmin' }), '']) {
    assert.throws(() => managedDatabasePassword(payload, 'DbAdmin'), /managed credential/);
    const result = spawnSync('node', [script], { encoding: 'utf8', env: { ...process.env, SECRET_JSON: `${payload} synthetic-marker-must-not-appear` } });
    assert.equal(result.status, 1);
    assert.equal(`${result.stdout}${result.stderr}`.includes('synthetic-marker-must-not-appear'), false);
  }
});

test('prints the password for a valid payload', () => {
  const result = spawnSync('node', [script], { encoding: 'utf8', env: { ...process.env, SECRET_JSON: JSON.stringify({ username: 'DbAdmin', password: 'synthetic-test-only' }), EXPECTED_DB_USER: 'DbAdmin' } });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, 'synthetic-test-only');
});
