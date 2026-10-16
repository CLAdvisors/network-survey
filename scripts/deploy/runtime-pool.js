'use strict';

const path = require('path');

// Deploy-invoked migration/control/heartbeat tooling resolves its database
// credential through the same managed callback as the API. For a secure
// runtime (target staging) an inline DB_PASSWORD is a hard failure; the legacy
// environments keep createPool's existing credential preference.
//
// The secure identity is the SECURE_RUNTIME_ENABLED flag stamped by the target
// Terraform into the runtime config, so operator-run tools agree with the
// deployed processes without a second selector.
function runtimePool(apiDir = process.cwd(), env = process.env) {
  const dotenv = require(path.join(apiDir, 'node_modules/dotenv'));
  dotenv.config({ path: path.join(apiDir, '.env.prod') });
  if (String(env.SECURE_RUNTIME_ENABLED || '') === 'true') {
    if (!env.DB_MANAGED_SECRET_ARN || env.DB_PASSWORD) {
      throw new Error('Secure deploy requires managed DB credentials without plaintext file values');
    }
  }
  return require(path.join(apiDir, 'runtime-resilience')).createPool(env);
}

module.exports = { runtimePool };
