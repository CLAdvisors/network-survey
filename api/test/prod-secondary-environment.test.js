'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const lifecycle = require('../lifecycle');
const { HOSTED_ENVIRONMENTS, isHostedEnvironment } = require('../../scripts/deploy/hosted-environments');
const repositoryRoot = path.resolve(__dirname, '../..');

test('canonical environments preserve existing behavior and accept exact prod-secondary', () => {
  for (const environment of ['staging', 'prod', 'prod-secondary']) {
    assert.equal(isHostedEnvironment(environment), true);
    assert.equal(lifecycle.isHostedEnvironment(environment), true);
    assert.equal(lifecycle.environmentName({ EMAIL_WORKER_ENV: environment }), environment);
  }
  for (const environment of ['local', 'test']) {
    assert.equal(isHostedEnvironment(environment), false);
    assert.equal(lifecycle.isHostedEnvironment(environment), false);
    assert.equal(lifecycle.environmentName({ EMAIL_WORKER_ENV: environment }), environment);
  }
  assert.deepEqual(HOSTED_ENVIRONMENTS, ['staging', 'prod', 'prod-secondary']);
  for (const alias of ['prod_secondary', 'secondary-prod', 'secondary-production', 'production-secondary']) {
    assert.equal(isHostedEnvironment(alias), false);
    assert.equal(lifecycle.isHostedEnvironment(alias), false);
  }
});

test('prod-secondary migration seeds every hosted delivery control disabled', () => {
  const master = fs.readFileSync(path.join(repositoryRoot, 'db/changelogs/master-changelog.xml'), 'utf8');
  const migration = fs.readFileSync(path.join(repositoryRoot, 'db/changelogs/v1_8_prod_secondary_controls.sql'), 'utf8');
  assert.match(master, /v1_8_prod_secondary_controls\.sql/);
  assert.match(migration, /email_worker_control[\s\S]*'prod-secondary', false/);
  assert.match(migration, /email_webhook_worker_control[\s\S]*'prod-secondary', false, false/);
  assert.match(migration, /email_suppression_control[\s\S]*'prod-secondary', false/);
  assert.match(migration, /email_sending_control[\s\S]*'prod-secondary', false/);
  assert.equal((migration.match(/ON CONFLICT \(environment\) DO NOTHING/g) || []).length, 4);
});

test('all hosted deploy control entry points use the shared exact namespace validator', () => {
  for (const script of ['activate-suppression-enforcement.js','manage-resend-webhook.js','override-email-suppression.js','replay-webhook-event.js','set-email-claiming.js','set-email-sending.js','set-webhook-processing.js']) {
    const source = fs.readFileSync(path.join(repositoryRoot, 'scripts/deploy', script), 'utf8');
    assert.match(source, /require\('\.\/hosted-environments'\)/, script);
    assert.match(source, /isHostedEnvironment\(environment\)/, script);
  }
  const remoteDeploy = fs.readFileSync(path.join(repositoryRoot, 'scripts/deploy/remote-deploy.sh'), 'utf8');
  assert.match(remoteDeploy, /staging\|prod\|prod-secondary\)/);
});
