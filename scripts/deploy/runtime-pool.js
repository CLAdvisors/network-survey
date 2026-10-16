'use strict';

const path = require('path');

// Hosted environments that must never fall back to a plaintext database
// credential. Keep in sync with api/runtime-secrets.js
// SECURE_RUNTIME_ENVIRONMENTS and scripts/deploy/ecosystem.config.js.
const SECURE_RUNTIME_ENVIRONMENTS = Object.freeze(['staging']);

// Deploy-invoked migration/control/heartbeat tooling resolves its database
// credential through the same managed callback as the API. For a secure
// environment an inline DB_PASSWORD is a hard failure; for the legacy
// environments createPool keeps its existing preference order.
function runtimePool(apiDir = process.cwd(), env = process.env) {
  const dotenv = require(path.join(apiDir, 'node_modules/dotenv'));
  dotenv.config({ path: path.join(apiDir, '.env.prod') });
  if (SECURE_RUNTIME_ENVIRONMENTS.includes(env.EMAIL_WORKER_ENV)) {
    if (!env.DB_MANAGED_SECRET_ARN || env.DB_PASSWORD) {
      throw new Error('Secure deploy requires managed DB credentials without plaintext file values');
    }
  }
  return require(path.join(apiDir, 'runtime-resilience')).createPool(env);
}

module.exports = { runtimePool, SECURE_RUNTIME_ENVIRONMENTS };
