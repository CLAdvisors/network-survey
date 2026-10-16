'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '../..');
const script = fs.readFileSync(path.join(root, 'scripts/deploy/remote-deploy.sh'), 'utf8');
const runtimeSecrets = fs.readFileSync(path.join(root, 'api/runtime-secrets.js'), 'utf8');
const runtimePool = fs.readFileSync(path.join(root, 'scripts/deploy/runtime-pool.js'), 'utf8');
const ecosystemSource = fs.readFileSync(path.join(root, 'scripts/deploy/ecosystem.config.js'), 'utf8');

test('the deploy script parses and targets staging as its only secure runtime environment', () => {
  const syntax = spawnSync('bash', ['-n', path.join(root, 'scripts/deploy/remote-deploy.sh')], { encoding: 'utf8' });
  assert.equal(syntax.status, 0, syntax.stderr);
  assert.match(script, /SECURE_RUNTIME=false\nif \[ "\$ENVIRONMENT" = "staging" \]; then\n  SECURE_RUNTIME=true/);
  assert.match(script, /Secret-safe deployments refuse shell xtrace/);
  assert.match(script, /if \[ "\$SECURE_RUNTIME" = true \] && \[\[ \$- == \*x\* \]\]/);
});

test('every secure-runtime module agrees on the staging-only secure set', () => {
  assert.match(runtimeSecrets, /SECURE_RUNTIME_ENVIRONMENTS = Object\.freeze\(\['staging'\]\)/);
  assert.match(runtimePool, /SECURE_RUNTIME_ENVIRONMENTS = Object\.freeze\(\['staging'\]\)/);
  assert.match(ecosystemSource, /const secureHosted = process\.env\.EMAIL_WORKER_ENV === 'staging';/);
  for (const [label, text] of Object.entries({ runtimeSecrets, runtimePool, ecosystemSource })) {
    assert.equal(/analysis/i.test(text), false, `${label}: no analysis worker is pulled in`);
  }
  assert.equal(/secureHosted = process\.env\.EMAIL_WORKER_ENV === 'staging';/.test(ecosystemSource), true, 'ecosystem secure routing is staging-only');
  assert.equal(/ona-analysis-worker|ANALYSIS_WORKER_ENABLED/.test(script), false, 'remote-deploy must not touch the optional analysis worker');
});

test('the secure deploy refuses inline credentials before any legacy write', () => {
  assert.match(script, /RELEASE_CAPABILITY_ARGS\+=\(--require-transient-runtime-secrets\)/);
  assert.match(script, /Runtime configuration contains inline credential keys; refusing deploy/);
  assert.match(script, /if \[ "\$SECURE_RUNTIME" = true \]; then\n  test -n "\$DB_MANAGED_SECRET_ARN"/);
  assert.match(script, /test "\$\(get_env_value SESSION_SECRET_PARAMETER\)" = "\/network-survey\/\$ENVIRONMENT\/api\/session-secret"/);
  assert.match(script, /fi # legacy secret-to-disk path; never execute for a secure runtime environment/);
  const marker = JSON.parse(fs.readFileSync(path.join(root, 'scripts/deploy/CAPABILITIES.json'), 'utf8'));
  assert.equal(marker.transient_runtime_secrets, 1);
});

test('secure migrations keep the credential off Liquibase argv and rollback refuses insecure artifacts', () => {
  assert.match(script, /LIQUIBASE_COMMAND_PASSWORD="\$DB_PASSWORD" liquibase/);
  assert.match(script, /secure-artifact-check\.js" "\$PREVIOUS_RELEASE"/);
  assert.match(script, /host remains out of service, no insecure rollback/);
  assert.equal(/refresh_managed_db_password "\$PREVIOUS_RELEASE\/api\/\.env\.prod"/.test(script), true, 'legacy refresh path still exists for non-secure environments');
});

test('every deploy-invoked query resolves the DB credential through the managed callback', () => {
  assert.equal(script.includes('password:process.env.DB_PASSWORD'), false, 'no inline DB_PASSWORD pool construction remains');
  assert.equal(script.includes('password: process.env.DB_PASSWORD'), false, 'no inline DB_PASSWORD pool construction remains');
  assert.match(script, /require\('\.\.\/deploy\/runtime-pool'\)\.runtimePool\(\)/);
  assert.match(script, /if \[ "\$SECURE_RUNTIME" != true \]; then\n        ls -1dt "\$SERVICE_DIR"\/releases\/\*/);
});

test('the PM2 app environment carries only non-secret keys', () => {
  // pm2 jlist/save exposes each app's pm2_env. The ecosystem must not add any
  // key outside this allow-list, so no secret can reach the PM2 parent or dump.
  const allowed = new Set(['NODE_ENV', 'RELEASE_REVISION', 'DEPLOYMENT_ID', 'EMAIL_WORKER_ENV', 'APP_ENV']);
  const configPath = require.resolve('../../scripts/deploy/ecosystem.config');
  const previous = process.env.EMAIL_WORKER_ENV;
  try {
    process.env.EMAIL_WORKER_ENV = 'staging';
    delete require.cache[configPath];
    const config = require(configPath);
    for (const app of config.apps) {
      for (const key of Object.keys(app.env)) {
        assert.ok(allowed.has(key), `unexpected PM2 env key: ${key}`);
      }
    }
  } finally {
    if (previous === undefined) delete process.env.EMAIL_WORKER_ENV;
    else process.env.EMAIL_WORKER_ENV = previous;
    delete require.cache[configPath];
  }
});
