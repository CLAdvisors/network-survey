'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { insecureReason } = require('../../scripts/deploy/secure-artifact-check');

const script = path.resolve(__dirname, '../../scripts/deploy/secure-artifact-check.js');
const CAPABILITY_ONLY = JSON.stringify({ format_version: 1, transient_runtime_secrets: 1 });
const RUNTIME_REFERENCES = 'DB_MANAGED_SECRET_ARN=arn:aws:secretsmanager:us-east-1:710054969994:secret:synthetic\nSESSION_SECRET_PARAMETER=/network-survey/staging/api/session-secret\n';

const build = (marker, envFile) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'network-survey-secure-artifact-'));
  fs.mkdirSync(path.join(root, 'deploy'), { recursive: true });
  fs.mkdirSync(path.join(root, 'api'), { recursive: true });
  if (marker !== undefined) fs.writeFileSync(path.join(root, 'deploy', 'CAPABILITIES.json'), marker);
  if (envFile !== undefined) fs.writeFileSync(path.join(root, 'api', '.env.prod'), envFile);
  return root;
};

test('accepts a capability-verified release whose runtime env holds references only', () => {
  const root = build(CAPABILITY_ONLY, RUNTIME_REFERENCES);
  try {
    assert.equal(insecureReason(root), null);
    const result = spawnSync('node', [script, root], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('refuses an artifact without the capability marker or capability', () => {
  for (const marker of [undefined, JSON.stringify({ format_version: 1 })]) {
    const root = build(marker, RUNTIME_REFERENCES);
    try {
      assert.match(insecureReason(root), /capability/);
      const result = spawnSync('node', [script, root], { encoding: 'utf8' });
      assert.equal(result.status, 1);
      assert.equal(`${result.stdout}${result.stderr}`.includes('synthetic'), false);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  }
});

test('refuses a release whose runtime env contains inline credential keys without printing the value', () => {
  const root = build(CAPABILITY_ONLY, `DB_PASSWORD="synthetic-secret-must-not-appear"\n${RUNTIME_REFERENCES}`);
  try {
    assert.equal(insecureReason(root), 'release runtime environment contains inline credential keys');
    const result = spawnSync('node', [script, root], { encoding: 'utf8' });
    assert.equal(result.status, 1);
    assert.equal(`${result.stdout}${result.stderr}`.includes('synthetic-secret-must-not-appear'), false);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('refuses a release whose runtime env is missing or unreadable', () => {
  const root = build(CAPABILITY_ONLY, undefined);
  try {
    assert.equal(insecureReason(root), 'release runtime environment is missing');
    assert.equal(spawnSync('node', [script, root]).status, 1);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('usage error is a distinct non-zero exit', () => {
  assert.equal(spawnSync('node', [script]).status, 2);
});
