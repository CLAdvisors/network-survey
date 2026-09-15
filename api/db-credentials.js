'use strict';

const { GetSecretValueCommand, SecretsManagerClient } = require('@aws-sdk/client-secrets-manager');

function secretRegion(secretArn) {
  const parts = String(secretArn || '').split(':');
  return parts[0] === 'arn' && parts[2] === 'secretsmanager' && parts[3] ? parts[3] : undefined;
}

function parseManagedDatabaseSecret(secretString, expectedUsername) {
  let secret;
  try {
    secret = JSON.parse(secretString);
  } catch {
    throw new Error('RDS managed secret is not valid JSON');
  }
  if (!secret || typeof secret.password !== 'string' || !secret.password) {
    throw new Error('RDS managed secret does not contain a password');
  }
  if (expectedUsername && secret.username !== expectedUsername) {
    throw new Error('RDS managed secret username does not match DB_USER');
  }
  return secret.password;
}

function createManagedDatabasePasswordProvider(env = process.env, { client } = {}) {
  const secretArn = String(env.DB_MANAGED_SECRET_ARN || '').trim();
  if (!secretArn) return null;

  const secrets = client || new SecretsManagerClient({
    region: env.AWS_REGION || env.AWS_DEFAULT_REGION || secretRegion(secretArn),
  });
  const configuredTimeout = Number(env.DB_SECRET_TIMEOUT_MS);
  const timeoutMs = Number.isFinite(configuredTimeout)
    ? Math.min(5000, Math.max(250, Math.floor(configuredTimeout)))
    : 2000;
  let inFlight = null;

  // node-postgres calls an async password function for every newly-created
  // physical connection. Reading AWSCURRENT here lets a long-running pool adopt
  // an RDS-managed rotation without rewriting files or restarting processes.
  // Concurrent pool growth shares one request, but successful values are not
  // cached across connection waves.
  return function managedDatabasePassword() {
    if (inFlight) return inFlight;
    inFlight = (async () => {
      const abort = new AbortController();
      const timer = setTimeout(() => abort.abort(), timeoutMs);
      let result;
      try {
        result = await secrets.send(new GetSecretValueCommand({
          SecretId: secretArn,
          VersionStage: 'AWSCURRENT',
        }), { abortSignal:abort.signal });
      } catch {
        const error = new Error('Unable to resolve the RDS managed password');
        error.code = 'DB_CREDENTIAL_UNAVAILABLE';
        throw error;
      } finally {
        clearTimeout(timer);
      }
      try {
        return parseManagedDatabaseSecret(result.SecretString, env.DB_USER);
      } catch {
        const error = new Error('The RDS managed credential is unavailable');
        error.code = 'DB_CREDENTIAL_UNAVAILABLE';
        throw error;
      }
    })().finally(() => { inFlight = null; });
    return inFlight;
  };
}

module.exports = {
  createManagedDatabasePasswordProvider,
  parseManagedDatabaseSecret,
  secretRegion,
};
