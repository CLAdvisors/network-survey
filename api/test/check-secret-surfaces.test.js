'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const scanner = path.resolve(__dirname, '../../scripts/deploy/check-secret-surfaces.sh');

test('scoped host scan returns only paths and counts, never synthetic values', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'network-survey-scanner-'));
  try {
    const releaseDir = path.join(root, 'opt/service/releases/synthetic/api');
    fs.mkdirSync(releaseDir, { recursive: true });
    const file = path.join(releaseDir, '.env.prod');
    fs.writeFileSync(file, 'DB_PASSWORD="synthetic-test-only"\n');
    const dirty = spawnSync('bash', [scanner, root], { encoding: 'utf8' });
    assert.equal(dirty.status, 1);
    assert.match(dirty.stdout, /credential-pattern present: \/opt\/service\/releases\/synthetic\/api\/\.env\.prod/);
    assert.match(dirty.stdout, /files with credential-name patterns: 1/);
    assert.equal(dirty.stdout.includes('synthetic-test-only'), false);

    fs.writeFileSync(file, 'DB_MANAGED_SECRET_ARN=arn:aws:secretsmanager:us-east-1:710054969994:secret:synthetic\nSESSION_SECRET_PARAMETER=/network-survey/staging/api/session-secret\n');
    fs.writeFileSync(path.join(releaseDir, '.env.local.example'), 'SESSION_SECRET=synthetic-example-not-runtime\n');
    const clean = spawnSync('bash', [scanner, root], { encoding: 'utf8' });
    assert.equal(clean.status, 0, clean.stdout);
    assert.match(clean.stdout, /files with credential-name patterns: 0/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
