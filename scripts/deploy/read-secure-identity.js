#!/usr/bin/env node
'use strict';

// Reads SECURE_RUNTIME_ENABLED from a runtime env file using the same dotenv
// parser the runtime uses, so no supported assignment form (quoting, inline
// comments, `export`, `:`) can hide the identity from the deploy guard. A read
// or parse failure exits non-zero with no value, so the caller fails closed.
const fs = require('fs');
const path = require('path');

function readSecureIdentity(envContent, dotenv) {
  return dotenv.parse(String(envContent)).SECURE_RUNTIME_ENABLED || '';
}

function loadDotenv(apiDir) {
  return require(path.join(apiDir || process.cwd(), 'node_modules', 'dotenv'));
}

if (require.main === module) {
  const apiDir = process.argv[2] || process.cwd();
  const envFile = process.argv[3] || path.join(apiDir, '.env.prod');
  try {
    process.stdout.write(readSecureIdentity(fs.readFileSync(envFile, 'utf8'), loadDotenv(apiDir)));
  } catch {
    process.exitCode = 1;
  }
}

module.exports = { readSecureIdentity, loadDotenv };
