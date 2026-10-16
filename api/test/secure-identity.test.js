'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const dotenv = require('dotenv');
const { readSecureIdentity, loadDotenv } = require('../../scripts/deploy/read-secure-identity');

const script = path.resolve(__dirname, '../../scripts/deploy/read-secure-identity.js');
const apiDir = path.resolve(__dirname, '..');

test('reads the secure identity with the runtime dotenv parser for every supported form', () => {
  for (const line of [
    'SECURE_RUNTIME_ENABLED=true',
    'SECURE_RUNTIME_ENABLED=true#comment',
    'SECURE_RUNTIME_ENABLED="true" # comment',
    'SECURE_RUNTIME_ENABLED=`true`',
    'export SECURE_RUNTIME_ENABLED=true',
    '  SECURE_RUNTIME_ENABLED = true',
    'SECURE_RUNTIME_ENABLED: true',
    'SECURE_RUNTIME_ENABLED=true\nSECURE_RUNTIME_ENABLED=false',
  ]) {
    const expected = line.endsWith('SECURE_RUNTIME_ENABLED=false') ? 'false' : 'true';
    assert.equal(readSecureIdentity(`${line}\nOTHER=x\n`, dotenv), expected, `must read: ${JSON.stringify(line)}`);
  }
  assert.equal(readSecureIdentity('OTHER=x\n', dotenv), '', 'an absent identity reads empty');
  assert.equal(readSecureIdentity('SECURE_RUNTIME_ENABLED=TRUE\n', dotenv), 'TRUE');
});

test('loads the runtime dotenv parser from the release api directory', () => {
  assert.equal(typeof loadDotenv(apiDir).parse, 'function');
});

test('the CLI prints the identity and fails closed on a read error', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'network-survey-secure-identity-'));
  try {
    const file = path.join(dir, '.env.prod');
    fs.writeFileSync(file, 'SECURE_RUNTIME_ENABLED=true#hidden\n');
    const ok = spawnSync('node', [script, apiDir, file], { encoding: 'utf8' });
    assert.equal(ok.status, 0, ok.stderr);
    assert.equal(ok.stdout, 'true');

    const missing = spawnSync('node', [script, apiDir, path.join(dir, 'absent.env')], { encoding: 'utf8' });
    assert.equal(missing.status, 1, 'a read error must fail closed');
    assert.equal(missing.stdout, '');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
