'use strict';

// PM2 must spawn this child with parameter references, never credential values.
// Loading after spawn keeps credential values out of the PM2 daemon and
// dump.pm2. The secure path covers the API, the email (delivery) worker and the
// webhook worker; no optional analysis worker is pulled in here.
const path = require('node:path');
const dotenv = require('dotenv');
const { loadRuntimeSecrets } = require('./runtime-secrets');

const KINDS = Object.freeze({
  api: './server',
  delivery: './email-worker',
  webhook: './webhook-worker',
});

async function startSecureRuntime(kind, {
  env = process.env,
  load = loadRuntimeSecrets,
  resolve = require,
  configure = () => dotenv.config({ path: path.join(__dirname, '.env.prod') }),
} = {}) {
  const moduleName = KINDS[kind];
  if (!moduleName) throw new Error('Unsupported secure runtime kind');
  configure();
  await load(env, {});
  const runtime = resolve(moduleName);
  if (kind === 'api') return runtime.startServer();
  return runtime.main();
}

if (require.main === module) {
  startSecureRuntime(process.argv[2]).catch(() => {
    // AWS SDK/provider errors may include secret-adjacent data: never print the
    // raw exception object.
    console.error('Runtime startup failed');
    process.exitCode = 1;
  });
}

module.exports = { startSecureRuntime, KINDS };
