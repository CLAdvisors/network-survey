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
const ASSIGNMENT = /^\s*(?:export\s+)?([A-Za-z0-9_.-]+)\s*(?:=|:)/;
const DOTENV_LINE = /^\s*(?:export\s+)?([A-Za-z0-9_.-]+)\s*(?:=|:)\s*(.*)$/;

// Dotenv-compatible single-key read, so an identity value written with
// `export`, spaces or a colon is still seen. Last assignment wins.
function readDotenvValue(content, key) {
  let value;
  for (const line of String(content).split('\n')) {
    const match = DOTENV_LINE.exec(line);
    if (match && match[1] === key) {
      value = match[2].trim().replace(/^["']|["']$/g, '').replace(/\s+#.*$/, '').trim();
    }
  }
  return value;
}

// Dotenv-compatible key extraction: leading whitespace, optional `export `,
// `=` (with optional spaces) or `:` (dotenv also accepts `KEY: value`). Returns
// the credential keys that appear.
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
  const [first, second, third] = process.argv.slice(2);
  if (first === '--read-key' && second && third) {
    try {
      process.stdout.write(readDotenvValue(fs.readFileSync(third, 'utf8'), second) || '');
    } catch {
      process.exitCode = 1;
    }
  } else if (first) {
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
      fs.writeFileSync(first, input, { mode: 0o600 });
    });
  } else {
    console.error('usage: runtime-config-check.js <destination-path>   |   --read-key <key> <file>');
    process.exitCode = 2;
  }
}

module.exports = { credentialKeysIn, readDotenvValue, validate, ASSIGNMENT, DOTENV_LINE };
