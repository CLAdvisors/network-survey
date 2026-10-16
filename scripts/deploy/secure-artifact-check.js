#!/usr/bin/env node
'use strict';

// Exit 0 only for a secure-capable release: it declares the
// transient-runtime-secrets capability, ships the secure runtime entrypoint
// and its PM2 ecosystem, and its runtime env file carries no inline credential
// keys (in any dotenv assignment form). Used before any automatic rollback so
// an older plaintext artifact is never restored. Prints only a category.
const fs = require('fs');
const path = require('path');
const { validate } = require('./runtime-config-check');

const REQUIRED_SECURE_FILES = Object.freeze([
  ['api', 'secure-runtime.js'],
  ['api', 'runtime-secrets.js'],
  ['deploy', 'ecosystem.config.js'],
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
  for (const segments of REQUIRED_SECURE_FILES) {
    if (!fs.existsSync(path.join(releaseDir, ...segments))) {
      return `release is missing its secure runtime entrypoint (${segments.join('/')})`;
    }
  }
  let content;
  try {
    content = fs.readFileSync(path.join(releaseDir, 'api', '.env.prod'), 'utf8');
  } catch {
    return 'release runtime environment is missing';
  }
  return validate(content);
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

module.exports = { insecureReason, REQUIRED_SECURE_FILES };
