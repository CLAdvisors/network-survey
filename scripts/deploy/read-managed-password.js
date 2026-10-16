#!/usr/bin/env node
'use strict';

// Reads an RDS managed-secret JSON payload from SECRET_JSON and writes only the
// password to stdout. A malformed payload or a username mismatch fails with a
// constant message, so a parser error can never echo secret-adjacent data into
// a deploy, migration or bootstrap log.
function managedDatabasePassword(secretString, expectedUsername) {
  let secret;
  try {
    secret = JSON.parse(String(secretString || ''));
  } catch {
    throw new Error('managed credential is not valid JSON');
  }
  if (!secret || typeof secret.password !== 'string' || !secret.password) {
    throw new Error('managed credential is missing a password');
  }
  if (expectedUsername && secret.username !== expectedUsername) {
    throw new Error('managed credential username does not match');
  }
  return secret.password;
}

if (require.main === module) {
  try {
    process.stdout.write(managedDatabasePassword(process.env.SECRET_JSON, process.env.EXPECTED_DB_USER));
  } catch (error) {
    console.error(`Managed credential unavailable: ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = { managedDatabasePassword };
