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
const bootstrapAdmin = fs.readFileSync(path.join(root, 'scripts/deploy/bootstrap-admin.js'), 'utf8');
const deployWorkflow = fs.readFileSync(path.join(root, '.github/workflows/deploy.yml'), 'utf8');

test('the deploy script parses and binds the secure path to the explicit target flag', () => {
  const syntax = spawnSync('bash', ['-n', path.join(root, 'scripts/deploy/remote-deploy.sh')], { encoding: 'utf8' });
  assert.equal(syntax.status, 0, syntax.stderr);
  assert.match(script, /if \[ "\$ENVIRONMENT" = "staging" \] && \[ "\$\{SECURE_RUNTIME_ENABLED:-false\}" = "true" \]; then\n  SECURE_RUNTIME=true/);
  assert.match(script, /Secret-safe deployments refuse shell xtrace/);
  assert.match(script, /if \[ "\$ENVIRONMENT" = "prod-secondary" \] \|\| \[ "\$SECURE_RUNTIME" = true \]; then\n  # Serialize/);
});

test('every secure-runtime module agrees on the explicit SECURE_RUNTIME_ENABLED identity', () => {
  assert.match(runtimeSecrets, /String\(env\.SECURE_RUNTIME_ENABLED \|\| ''\) === 'true'/);
  assert.match(runtimePool, /String\(env\.SECURE_RUNTIME_ENABLED \|\| ''\) === 'true'/);
  assert.match(ecosystemSource, /const secureHosted = process\.env\.SECURE_RUNTIME_ENABLED === 'true';/);
  assert.match(bootstrapAdmin, /process\.env\.SECURE_RUNTIME_ENABLED === 'true'/);
  for (const [label, text] of Object.entries({ runtimeSecrets, runtimePool, ecosystemSource, bootstrapAdmin })) {
    assert.equal(/analysis/i.test(text), false, `${label}: no analysis worker is pulled in`);
    assert.equal(/'staging'/.test(text.replace(/.*legacy.*/gi, '')), false, `${label}: the logical name is not the secure selector`);
  }
  assert.equal(/ona-analysis-worker|ANALYSIS_WORKER_ENABLED/.test(script), false, 'remote-deploy must not touch the optional analysis worker');
});

test('the secure deploy validates reference-only config before writing it and requires the /live floor', () => {
  assert.match(script, /RELEASE_CAPABILITY_ARGS\+=\(--require-transient-runtime-secrets --require-alb-live-health\)/);
  assert.match(script, /aws s3 cp "s3:\/\/\$CONFIG_BUCKET\/\$CONFIG_KEY" - \| node "\$RELEASE_DIR\/deploy\/runtime-config-check\.js"/);
  assert.match(script, /test "\$CONFIG_SECURE_RUNTIME" = "true"/);
  assert.match(script, /Runtime config declares the secure identity but this host is not secure; refusing/);
  assert.match(script, /--read-key SECURE_RUNTIME_ENABLED/);
  assert.match(script, /fi # legacy secret-to-disk path; never execute for a secure runtime environment/);
  const marker = JSON.parse(fs.readFileSync(path.join(root, 'scripts/deploy/CAPABILITIES.json'), 'utf8'));
  assert.equal(marker.transient_runtime_secrets, 1);
  assert.equal(marker.alb_live_health, 1);
});

test('secure migrations and credential parses never put a secret on argv or leak a payload', () => {
  assert.match(script, /LIQUIBASE_COMMAND_PASSWORD="\$DB_PASSWORD" liquibase/);
  assert.equal(script.includes('read-managed-password.js'), true, 'managed-secret parsing goes through the sanitized helper');
  assert.equal(script.includes("node -e 'const value=JSON.parse(process.env.SECRET_JSON)"), false, 'no raw managed-secret parser remains');
  assert.equal(script.includes("node -e 'const s=JSON.parse(process.env.SECRET_JSON)"), false, 'no raw managed-secret parser remains');
  assert.match(script, /secure-artifact-check\.js" "\$PREVIOUS_RELEASE"/);
  assert.match(script, /host remains out of service, no insecure rollback/);
  assert.match(script, /PREVIOUS_API_DIR="\$PREVIOUS_RELEASE\/api"/);
  assert.match(script, /runtimePool\(process\.env\.PREVIOUS_API_DIR\)/);
});

test('every deploy-invoked query resolves the DB credential through the managed callback', () => {
  assert.equal(script.includes('password:process.env.DB_PASSWORD'), false, 'no inline DB_PASSWORD pool construction remains');
  assert.equal(script.includes('password: process.env.DB_PASSWORD'), false, 'no inline DB_PASSWORD pool construction remains');
  assert.match(script, /require\('\.\.\/deploy\/runtime-pool'\)\.runtimePool\(\)/);
  assert.match(script, /if \[ "\$SECURE_RUNTIME" != true \]; then\n        ls -1dt "\$SERVICE_DIR"\/releases\/\*/);
});

test('secure staging and prod-secondary both serve /live before traffic is trusted', () => {
  assert.match(script, /live_ok\(\) \{\n  if \[ "\$ENVIRONMENT" != "prod-secondary" \] && \[ "\$SECURE_RUNTIME" != true \]; then\n    return 0\n  fi/);
  assert.equal((script.match(/\blive_ok &&/g) || []).length, 2, 'both the deploy and restore health predicates check /live');
  assert.equal(script.includes('prod-secondary|staging'), false, 'legacy source staging is not a name-based /live trigger');
});

test('the PM2 app environment carries only non-secret keys', () => {
  const allowed = new Set(['NODE_ENV', 'RELEASE_REVISION', 'DEPLOYMENT_ID', 'EMAIL_WORKER_ENV', 'APP_ENV', 'SECURE_RUNTIME_ENABLED']);
  const configPath = require.resolve('../../scripts/deploy/ecosystem.config');
  const previous = process.env.SECURE_RUNTIME_ENABLED;
  try {
    process.env.SECURE_RUNTIME_ENABLED = 'true';
    delete require.cache[configPath];
    const config = require(configPath);
    for (const app of config.apps) {
      for (const key of Object.keys(app.env)) {
        assert.ok(allowed.has(key), `unexpected PM2 env key: ${key}`);
      }
    }
  } finally {
    if (previous === undefined) delete process.env.SECURE_RUNTIME_ENABLED;
    else process.env.SECURE_RUNTIME_ENABLED = previous;
    delete require.cache[configPath];
  }
});

test('the deploy artifact packages every secure-runtime file', () => {
  for (const file of ['api/secure-runtime.js', 'api/runtime-secrets.js', 'deploy/runtime-pool.js', 'deploy/secure-artifact-check.js', 'deploy/runtime-config-check.js', 'deploy/read-managed-password.js']) {
    assert.match(deployWorkflow, new RegExp(`test -f "\\$STAGE_DIR/${file.replace(/[.]/g, '\\.')}"`), `deploy.yml must assert ${file}`);
  }
});
