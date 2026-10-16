'use strict';

const { SSMClient, GetParameterCommand } = require('@aws-sdk/client-ssm');

// Hosted environments whose runtime must resolve credentials transiently at
// process start and never read them from a plaintext file. This tranche enables
// staging only; prod and prod-secondary keep their existing deploy path until a
// separate, explicitly approved change. Keep this list in sync with
// scripts/deploy/runtime-pool.js and scripts/deploy/ecosystem.config.js.
const SECURE_RUNTIME_ENVIRONMENTS = Object.freeze(['staging']);

// [process env key, reference env key, expected SSM suffix, enabled?, optional?]
const SECRET_REFERENCES = Object.freeze([
  ['SESSION_SECRET', 'SESSION_SECRET_PARAMETER', '/api/session-secret', () => true],
  ['RESEND_API_KEY', 'RESEND_API_KEY_PARAMETER', '/resend/api-key', (env) => env.RESEND_CREDENTIAL_LOAD_ENABLED === 'true'],
  ['RESEND_WEBHOOK_SECRET', 'RESEND_WEBHOOK_SECRET_PARAMETER', '/resend/webhook-secret', (env) => env.RESEND_WEBHOOK_INGEST_ENABLED === 'true'],
  ['RESEND_WEBHOOK_PREVIOUS_SECRET', 'RESEND_WEBHOOK_PREVIOUS_SECRET_PARAMETER', '/resend/webhook-previous-secret', (env) => env.RESEND_WEBHOOK_INGEST_ENABLED === 'true', true],
]);

function isSecureRuntimeEnvironment(environment) {
  return SECURE_RUNTIME_ENVIRONMENTS.includes(environment);
}

// Load into the application process only, after PM2 has spawned it. Never pass
// these values through the PM2 parent, ecosystem config, release files, argv,
// logs or the PM2 dump. Errors are sanitized so a provider/AWS error body can
// never surface the failing parameter value.
async function loadRuntimeSecrets(env = process.env, { client, timeoutMs = 5000 } = {}) {
  if (!isSecureRuntimeEnvironment(env.EMAIL_WORKER_ENV)) return env;
  const prefix = `/network-survey/${env.EMAIL_WORKER_ENV}`;
  if (!env.DB_MANAGED_SECRET_ARN || env.DB_PASSWORD) {
    throw new Error('Secure runtime requires the managed database secret without an inline password');
  }
  for (const [key] of SECRET_REFERENCES) {
    if (env[key] || (key === 'RESEND_API_KEY' && env.RESEND_KEY)) {
      throw new Error('Secure runtime must not receive inline secrets');
    }
  }

  const ssm = client || new SSMClient({ region: env.AWS_REGION || env.AWS_DEFAULT_REGION || 'us-east-1' });
  const staged = {};
  try {
    for (const [key, parameterKey, expectedName, enabled, optional] of SECRET_REFERENCES) {
      if (!enabled(env)) {
        if (env[parameterKey]) throw new Error('Inactive runtime secret reference is configured');
        continue;
      }
      const name = String(env[parameterKey] || '').trim();
      if (name !== prefix + expectedName) {
        throw new Error('Invalid runtime secret reference');
      }
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), Math.min(10000, Math.max(250, timeoutMs)));
      try {
        const response = await ssm.send(new GetParameterCommand({ Name: name, WithDecryption: true }), { abortSignal: controller.signal });
        const value = response.Parameter?.Value;
        if (!value || response.Parameter?.Type !== 'SecureString') {
          throw new Error('Runtime secret is unavailable');
        }
        staged[key] = value;
      } catch (error) {
        if (!optional || error?.name !== 'ParameterNotFound') {
          throw new Error('Runtime secret is unavailable');
        }
      } finally {
        clearTimeout(timer);
      }
    }
    // Commit only after every mandatory read succeeded, so a partial failure
    // never leaves a half-populated process environment.
    Object.assign(env, staged);
    return env;
  } finally {
    if (!client) ssm.destroy();
  }
}

module.exports = { loadRuntimeSecrets, isSecureRuntimeEnvironment, SECURE_RUNTIME_ENVIRONMENTS };
