#!/usr/bin/env node
'use strict';

// Validates a hosted runtime config *before* any credential-bearing file is
// written, and streams a clean config to its destination. A credential key in
// any supported dotenv assignment form (leading whitespace, `export `, spaces
// around `=`, empty value) is rejected. Errors print only a category.
//
// CLI: node runtime-config-check.js <destination-path>   (config on stdin)
const fs = require('fs');

const CREDENTIAL_KEYS = Object.freeze([
  'DB_PASSWORD', 'SESSION_SECRET', 'RESEND_API_KEY', 'RESEND_KEY',
  'RESEND_WEBHOOK_SECRET', 'RESEND_WEBHOOK_PREVIOUS_SECRET', 'AWS_SECRET_ACCESS_KEY',
]);
const ASSIGNMENT = /^\s*(?:export\s+)?([A-Za-z0-9_.-]+)\s*=/;

// Dotenv-compatible key extraction: leading whitespace, optional `export `,
// optional spaces around `=`. Returns the credential keys that appear.
function credentialKeysIn(content) {
  const found = new Set();
  for (const line of String(content).split('\n')) {
    const match = ASSIGNMENT.exec(line);
    if (match && CREDENTIAL_KEYS.includes(match[1])) found.add(match[1]);
  }
  return [...found];
}

function validate(content) {
  const keys = credentialKeysIn(content);
  if (keys.length) return `runtime configuration contains inline credential keys: ${keys.join(', ')}`;
  return null;
}

if (require.main === module) {
  const destination = process.argv[2];
  if (!destination) {
    console.error('usage: runtime-config-check.js <destination-path>');
    process.exitCode = 2;
  } else {
    let input = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => { input += chunk; });
    process.stdin.on('end', () => {
      const failure = validate(input);
      if (failure) {
        // Write nothing: a rejected config must never land on disk.
        console.error(failure);
        process.exitCode = 1;
        return;
      }
      fs.writeFileSync(destination, input, { mode: 0o600 });
    });
  }
}

module.exports = { credentialKeysIn, validate, ASSIGNMENT };
