'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadRuntimeSecrets, isSecureRuntimeEnvironment, SECURE_RUNTIME_ENVIRONMENTS } = require('../runtime-secrets');

// Staging runtime config carries references only; every credential arrives
// from SSM/Secrets Manager after PM2 has already spawned the process.
const secureStaging = () => ({
  EMAIL_WORKER_ENV: 'staging',
  DB_MANAGED_SECRET_ARN: 'arn:aws:secretsmanager:us-east-1:710054969994:secret:rds!db-synthetic',
  SESSION_SECRET_PARAMETER: '/network-survey/staging/api/session-secret',
  RESEND_CREDENTIAL_LOAD_ENABLED: 'false',
  RESEND_WEBHOOK_INGEST_ENABLED: 'false',
});

const fake = (handler) => ({ send: async (command, options) => handler(command.input, options) });

test('secure set is exactly staging for this tranche', () => {
  assert.deepEqual([...SECURE_RUNTIME_ENVIRONMENTS], ['staging']);
  assert.equal(isSecureRuntimeEnvironment('staging'), true);
  for (const env of ['prod', 'prod-secondary', 'dev', 'local', 'test', undefined]) {
    assert.equal(isSecureRuntimeEnvironment(env), false, `${env} must stay on the legacy path`);
  }
});

test('loads the staging session SecureString only into the supplied process environment', async () => {
  const env = secureStaging();
  const names = [];
  await loadRuntimeSecrets(env, {
    client: fake((input) => {
      names.push(input.Name);
      assert.equal(input.WithDecryption, true);
      return { Parameter: { Type: 'SecureString', Value: 'synthetic-test-only' } };
    }),
  });
  assert.deepEqual(names, ['/network-survey/staging/api/session-secret']);
  assert.equal(env.SESSION_SECRET, 'synthetic-test-only');
  assert.equal(env.DB_PASSWORD, undefined);
  assert.equal(env.RESEND_API_KEY, undefined);
});

test('loads provider and webhook secrets only when their gates are on', async () => {
  const env = {
    ...secureStaging(),
    RESEND_CREDENTIAL_LOAD_ENABLED: 'true',
    RESEND_API_KEY_PARAMETER: '/network-survey/staging/resend/api-key',
    RESEND_WEBHOOK_INGEST_ENABLED: 'true',
    RESEND_WEBHOOK_SECRET_PARAMETER: '/network-survey/staging/resend/webhook-secret',
    RESEND_WEBHOOK_PREVIOUS_SECRET_PARAMETER: '/network-survey/staging/resend/webhook-previous-secret',
  };
  await loadRuntimeSecrets(env, {
    client: fake(() => ({ Parameter: { Type: 'SecureString', Value: 'synthetic-test-only' } })),
  });
  assert.equal(env.RESEND_API_KEY, 'synthetic-test-only');
  assert.equal(env.RESEND_WEBHOOK_SECRET, 'synthetic-test-only');
  assert.equal(env.RESEND_WEBHOOK_PREVIOUS_SECRET, 'synthetic-test-only');
});

test('never commits partial secrets when a mandatory read fails and never echoes the failure', async () => {
  const env = secureStaging();
  await assert.rejects(
    loadRuntimeSecrets(env, {
      client: fake(() => { throw new Error('synthetic-secret-must-not-appear'); }),
    }),
    (error) => error.message === 'Runtime secret is unavailable',
  );
  assert.equal(env.SESSION_SECRET, undefined);
});

test('an absent previous webhook secret is optional only when AWS reports ParameterNotFound', async () => {
  const env = {
    ...secureStaging(),
    RESEND_WEBHOOK_INGEST_ENABLED: 'true',
    RESEND_WEBHOOK_SECRET_PARAMETER: '/network-survey/staging/resend/webhook-secret',
    RESEND_WEBHOOK_PREVIOUS_SECRET_PARAMETER: '/network-survey/staging/resend/webhook-previous-secret',
  };
  await loadRuntimeSecrets(env, {
    client: fake((input) => {
      if (input.Name.endsWith('/webhook-previous-secret')) {
        const error = new Error('synthetic');
        error.name = 'ParameterNotFound';
        throw error;
      }
      return { Parameter: { Type: 'SecureString', Value: 'synthetic-test-only' } };
    }),
  });
  assert.equal(env.RESEND_WEBHOOK_PREVIOUS_SECRET, undefined);
  assert.equal(env.RESEND_WEBHOOK_SECRET, 'synthetic-test-only');
});

test('a non-SecureString or empty value fails closed', async () => {
  const env = secureStaging();
  await assert.rejects(
    loadRuntimeSecrets(env, { client: fake(() => ({ Parameter: { Type: 'String', Value: 'synthetic-test-only' } })) }),
    /Runtime secret is unavailable/,
  );
});

test('rejects plaintext, out-of-scope and cross-environment references before reading AWS', async () => {
  const inline = secureStaging();
  inline.DB_PASSWORD = 'synthetic-test-only';
  await assert.rejects(loadRuntimeSecrets(inline, { client: fake(() => { throw Error('must not call'); }) }), /inline password/);

  const inlineSecret = secureStaging();
  inlineSecret.SESSION_SECRET = 'synthetic-test-only';
  await assert.rejects(loadRuntimeSecrets(inlineSecret, { client: fake(() => { throw Error('must not call'); }) }), /inline secrets/);

  const wrongEnv = secureStaging();
  wrongEnv.SESSION_SECRET_PARAMETER = '/network-survey/prod-secondary/api/session-secret';
  await assert.rejects(loadRuntimeSecrets(wrongEnv, { client: fake(() => { throw Error('must not call'); }) }), /Invalid runtime secret reference/);
});

test('a disabled gate with an active reference is rejected', async () => {
  const env = secureStaging();
  env.RESEND_API_KEY_PARAMETER = '/network-survey/staging/resend/api-key';
  let reads = 0;
  await assert.rejects(loadRuntimeSecrets(env, {
    client: fake(() => { reads++; return { Parameter: { Type: 'SecureString', Value: 'synthetic-test-only' } }; }),
  }), /Inactive runtime secret reference/);
  assert.equal(reads, 1, 'only the session secret may be read before the inactive reference is rejected');
});

test('legacy hosted and local environments are returned untouched without any AWS read', async () => {
  for (const environment of ['prod', 'prod-secondary', 'local', 'test']) {
    const env = { EMAIL_WORKER_ENV: environment, SESSION_SECRET: 'synthetic-test-only' };
    const result = await loadRuntimeSecrets(env, { client: fake(() => { throw Error('must not call'); }) });
    assert.equal(result, env);
    assert.equal(env.SESSION_SECRET, 'synthetic-test-only');
  }
});
