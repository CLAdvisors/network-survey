#!/usr/bin/env node
'use strict';

// Exit 0 only for a secure-capable release: it declares the
// transient-runtime-secrets capability and its runtime env file carries no
// inline credential keys. Used before any automatic rollback so an older
// plaintext artifact is never restored. Prints only a category, never a value.
const fs = require('fs');
const path = require('path');

const CREDENTIAL_KEYS = Object.freeze([
  'DB_PASSWORD', 'SESSION_SECRET', 'RESEND_API_KEY', 'RESEND_KEY',
  'RESEND_WEBHOOK_SECRET', 'RESEND_WEBHOOK_PREVIOUS_SECRET',
]);

function insecureReason(releaseDir) {
  let marker;
  try {
    marker = JSON.parse(fs.readFileSync(path.join(releaseDir, 'deploy', 'CAPABILITIES.json'), 'utf8'));
  } catch {
    return 'release lacks a valid capability marker';
  }
  if (marker.transient_runtime_secrets !== 1) {
    return 'release lacks transient runtime secret capability';
  }
  let content;
  try {
    content = fs.readFileSync(path.join(releaseDir, 'api', '.env.prod'), 'utf8');
  } catch {
    return 'release runtime environment is missing';
  }
  const hasInline = content.split('\n').some((line) => CREDENTIAL_KEYS.some((key) => line.startsWith(`${key}=`)));
  if (hasInline) return 'release runtime environment contains inline credential keys';
  return null;
}

if (require.main === module) {
  const releaseDir = process.argv[2];
  if (!releaseDir) {
    console.error('usage: secure-artifact-check.js <release-dir>');
    process.exitCode = 2;
  } else {
    const failure = insecureReason(path.resolve(releaseDir));
    if (failure) {
      console.error(`Insecure release refused: ${failure}`);
      process.exitCode = 1;
    } else {
      console.log('Release declares transient-secret capability with no inline credentials');
    }
  }
}

module.exports = { insecureReason, CREDENTIAL_KEYS };
