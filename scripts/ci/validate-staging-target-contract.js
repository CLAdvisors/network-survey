'use strict';

// Offline static contract for the target-account staging tranche (no AWS, no
// network, no Terraform state). It asserts the target root/state/account
// bindings, the preserved legacy/prod identities and numeric defaults, the
// re-scoped environment branches, the zero-host capacity ceiling, the
// NAT/S3-gateway/no-interface-endpoint shape, and the fail-closed workflow
// routes. It does not prove provisioning readiness.

const fs = require('fs');
const assert = require('node:assert/strict');

const read = (path) => fs.readFileSync(path, 'utf8');

const moduleMain = read('terraform/modules/prod_secondary_platform/main.tf');
const moduleVars = read('terraform/modules/prod_secondary_platform/variables.tf');
const moduleMoved = read('terraform/modules/prod_secondary_platform/moved.tf');
const moduleLogging = read('terraform/modules/prod_secondary_platform/access-logging.tf');
const moduleCloudInit = read('terraform/modules/prod_secondary_platform/cloud-init.sh');

const targetProvider = read('terraform/envs/staging-target/provider.tf');
const targetLocals = read('terraform/envs/staging-target/locals.tf');
const targetMain = read('terraform/envs/staging-target/main.tf');
const targetVars = read('terraform/envs/staging-target/variables.tf');

const legacyProvider = read('terraform/envs/staging/provider.tf');
const prodMain = read('terraform/envs/prod-secondary/main.tf');
const prodTfvars = read('terraform/envs/prod-secondary/prod-secondary.tfvars');

const deployWorkflow = read('.github/workflows/deploy.yml');
const planWorkflow = read('.github/workflows/terraform-plan.yml');
const applyWorkflow = read('.github/workflows/terraform-apply.yml');
const rollbackWorkflow = read('.github/workflows/rollback-api.yml');

const guardPath = 'scripts/ci/guard-staging-route.sh';
const guard = read(guardPath);

const has = (text, needle, label) =>
  assert.ok(text.includes(needle), label || `expected to find: ${needle}`);
const hasNot = (text, needle, label) =>
  assert.equal(text.includes(needle), false, label || `expected NOT to find: ${needle}`);
const matches = (text, regex, label) =>
  assert.ok(regex.test(text), label || `expected match: ${regex}`);

// --- Target root / state / account bindings -------------------------------

has(targetProvider, 'bucket       = "network-survey-terraform-state-710054969994"', 'target state bucket');
has(targetProvider, 'key          = "envs/staging-target/terraform.tfstate"', 'target state key');
has(targetProvider, 'allowed_account_ids = ["710054969994"]', 'target account allow-list');
has(targetProvider, 'region              = "us-east-1"', 'target region');
hasNot(targetProvider, 'bucket       = "network-survey-terraform-state-438465164125"', 'target root must not bind the source state bucket');
hasNot(targetProvider, 'key          = "envs/staging/terraform.tfstate"', 'target root must not bind the legacy state key');
has(targetLocals, 'environment = "staging"', 'logical environment id stays staging');
has(targetLocals, 'name_prefix = "network-survey-staging"', 'target name prefix');
has(targetLocals, 'Stack       = "staging-v1"', 'target Stack tag');
has(targetLocals, 'AccountRole = "staging"', 'target AccountRole tag');
hasNot(targetLocals, '438465164125', 'target locals must not reference the source account');

// --- Preserved legacy source root and prod-secondary identity -------------

has(legacyProvider, 'network-survey-terraform-state-438465164125', 'legacy source state bucket preserved');
has(legacyProvider, 'envs/staging/terraform.tfstate', 'legacy source state key preserved');

has(prodMain, 'environment = local.environment', 'prod-secondary drives the module environment');
has(prodMain, 'enable_resend_credentials    = var.enable_resend_credentials', 'prod-secondary explicit feature gates preserved');
has(prodTfvars, 'enable_resend_credentials    = true', 'prod-secondary tfvars feature values preserved');
has(prodTfvars, 'enable_custom_domain_aliases = true', 'prod-secondary tfvars alias value preserved');
for (const knob of ['nat_gateway_count', 'app_desired_capacity', 'app_max_capacity', 'enable_interface_endpoints', 'db_multi_az']) {
  hasNot(prodMain, knob, `prod-secondary must inherit the module default for ${knob}`);
}

// --- Module defaults and re-scoped environment branches -------------------

matches(moduleVars, /variable "environment"[\s\S]*?contains\(\["prod-secondary", "staging"\], var\.environment\)/, 'module accepts staging and prod-secondary');
matches(moduleVars, /variable "nat_gateway_count"[\s\S]*?default\s*=\s*2/, 'nat_gateway_count default preserves prod-secondary');
matches(moduleVars, /variable "app_desired_capacity"[\s\S]*?default\s*=\s*2/, 'app_desired_capacity default preserves prod-secondary');
matches(moduleVars, /variable "app_max_capacity"[\s\S]*?default\s*=\s*3/, 'app_max_capacity default preserves prod-secondary');
matches(moduleVars, /variable "db_multi_az"[\s\S]*?default\s*=\s*true/, 'db_multi_az default preserves prod-secondary');
matches(moduleVars, /variable "enable_interface_endpoints"[\s\S]*?default\s*=\s*true/, 'interface endpoints default preserves prod-secondary');
matches(moduleVars, /app_max_capacity >= var\.app_desired_capacity && var\.app_max_capacity <= 3/, 'max capacity ceiling enforced');

has(moduleMain, 'config    = "network-survey-${var.environment}-config-${var.account_id}"', 'config bucket is environment-derived');
has(moduleMain, '"EMAIL_WORKER_ENV=${var.environment}"', 'worker env is environment-derived');
has(moduleMain, 'RESEND_PROVIDER_ACCOUNT_SCOPE=network-survey-resend-${var.environment}', 'resend scope is environment-derived');
has(moduleMain, 'name              = "/network-survey/${var.environment}/${each.value}"', 'log groups are environment-derived');
has(moduleMain, 'key                    = "configs/.env.${var.environment}"', 'runtime config key is environment-derived');
has(moduleMain, ':log-group:/network-survey/${var.environment}/*', 'KMS log ARN is environment-derived');
has(moduleMain, 'RESEND_API_KEY_PARAMETER=${var.enable_resend_credentials ? "/network-survey/${var.environment}/resend/api-key" : ""}', 'resend SSM path is environment-derived');
has(moduleMain, '"SESSION_COOKIE_NAME=${var.environment == "prod-secondary" ? "prodSecondarySessionId" : "stagingSessionId"}"', 'session cookie re-scoped to staging');
has(moduleMain, 'var.environment == "prod-secondary" ? "NetworkSurvey/ProdSecondary" : "NetworkSurvey/Staging"', 'alarm namespaces re-scoped to staging');
has(moduleLogging, 'network-survey-${var.environment}-access-logs-${var.account_id}', 'access-log bucket is environment-derived');

for (const [label, text] of Object.entries({ moduleMain, moduleVars, moduleMoved, moduleLogging, targetMain, targetVars, targetLocals, targetProvider, prodMain })) {
  hasNot(text, '"dev"', `${label}: no leftover dev environment literal`);
  hasNot(text, 'devSessionId', `${label}: no leftover dev cookie`);
  hasNot(text, 'NetworkSurvey/Dev', `${label}: no leftover dev metric namespace`);
}
for (const [label, text] of Object.entries({ deployWorkflow, planWorkflow, applyWorkflow, rollbackWorkflow })) {
  hasNot(text, "'dev'", `${label}: no leftover dev route`);
  hasNot(text, '|dev|', `${label}: no leftover dev route pattern`);
  hasNot(text, 'DEV_AMI_ID', `${label}: no leftover dev AMI variable`);
}

// --- Zero-host capacity ceiling -------------------------------------------

matches(moduleMain, /min_size\s*=\s*var\.app_desired_capacity/, 'ASG min follows the explicit variable');
matches(moduleMain, /desired_capacity\s*=\s*var\.app_desired_capacity/, 'ASG desired follows the explicit variable');
matches(moduleMain, /max_size\s*=\s*var\.app_max_capacity/, 'ASG max follows the explicit ceiling');
const natEipBlock = moduleMain.match(/resource "aws_eip" "nat" \{[\s\S]*?\n\}/);
assert.ok(natEipBlock, 'NAT EIP block found');
has(natEipBlock[0], 'count  = var.nat_gateway_count', 'one NAT EIP per NAT gateway (no idle public address)');
matches(moduleMain, /multi_az\s*=\s*var\.db_multi_az/, 'RDS Multi-AZ follows the explicit variable');
assert.equal(/multi_az\s*=\s*true/.test(moduleMain), false, 'RDS Multi-AZ must not be hardcoded true');
matches(moduleMain, /resource "aws_nat_gateway" "this" \{\n  count = var\.nat_gateway_count/, 'NAT gateway count follows the same variable');
has(moduleMain, 'instance_refresh', 'instance_refresh named in the ceiling proof');
hasNot(moduleMain, 'aws_autoscaling_policy', 'no scaling policy can raise capacity');
hasNot(moduleMain, 'aws_autoscaling_schedule', 'no scheduled action can raise capacity');
hasNot(moduleMain, 'aws_appautoscaling', 'no app-autoscaling target can raise capacity');

matches(targetMain, /start_staging_app \? 1 : 0/, 'staging desired capacity gated at zero');
matches(targetVars, /variable "start_staging_app"[\s\S]*?default\s*=\s*false/, 'staging app stays off by default');
for (const gate of [
  'enable_resend_credentials    = false',
  'enable_resend_webhook_ingest = false',
  'enable_survey_delivery_v2    = false',
]) {
  has(targetMain, gate, `staging feature gate stays off: ${gate}`);
}
// The reviewed bootstrap gate is enabled for staging only (synthetic admin).
has(targetMain, 'enable_owner_bootstrap       = true', 'staging enables the reviewed bootstrap gate only');

// --- Secure-runtime identity is target-staging only -----------------------
// The secure-runtime flag is stamped by the module into deploy.env and the
// runtime config. Only this root sets it true, so the retained source staging
// (a separate root/module) keeps its existing deploy path.
matches(moduleVars, /variable "secure_runtime_enabled"[\s\S]*?default\s*=\s*false/, 'secure runtime identity defaults off');
has(moduleMain, 'var.secure_runtime_enabled ? ["SECURE_RUNTIME_ENABLED=true"] : []', 'runtime config stamps the secure identity only when enabled');
has(moduleMain, 'secure_runtime_deploy_line = var.secure_runtime_enabled ? "\\nSECURE_RUNTIME_ENABLED=true" : ""', 'user_data line is template-level omission when disabled');
has(moduleCloudInit, 'ENVIRONMENT=${environment}${secure_runtime_deploy_line}', 'deploy.env appends the flag only from the omitted line');
hasNot(moduleMain, 'SECURE_RUNTIME_ENABLED=${var.secure_runtime_enabled}', 'no unconditional identity line remains');
hasNot(moduleMain, 'SECURE_RUNTIME_ENABLED=false', 'no false identity line drifts prod-secondary config');
hasNot(moduleCloudInit, 'SECURE_RUNTIME_ENABLED=false', 'no false identity line drifts prod-secondary user_data');
matches(targetMain, /secure_runtime_enabled\s+=\s+true/, 'target staging stamps the secure identity');
hasNot(prodMain, 'secure_runtime_enabled', 'prod-secondary inherits the secure-off default');
hasNot(read('terraform/envs/staging/main.tf'), 'secure_runtime_enabled', 'legacy source staging never stamps the secure identity');

// --- NAT / S3 gateway / no interface endpoints, no dangling refs ----------

has(targetMain, 'nat_gateway_count          = 1', 'one NAT gateway');
has(targetMain, 'enable_interface_endpoints = false', 'interface endpoints disabled in staging');
has(moduleMain, 'endpoint_services = var.enable_interface_endpoints ? toset([', 'interface endpoint set is gated');
has(moduleMain, 'for_each = local.endpoint_services', 'interface endpoints follow the gated set');
has(moduleMain, 'resource "aws_vpc_endpoint" "s3"', 'S3 gateway endpoint retained');
has(moduleMain, 'vpc_endpoint_type = "Gateway"', 'S3 endpoint is a gateway endpoint');
hasNot(moduleMain, 'aws_vpc_endpoint.interface[', 'no indexed reference to a possibly-absent interface endpoint');
matches(moduleMain, /nat_gateway_id\s*=\s*aws_nat_gateway\.this\[count\.index % var\.nat_gateway_count\]\.id/, 'app egress uses the modulo NAT selection');
const s3EndpointBlock = moduleMain.match(/resource "aws_vpc_endpoint" "s3" \{[\s\S]*?\n\}/);
assert.ok(s3EndpointBlock, 'S3 gateway endpoint block found');
hasNot(s3EndpointBlock[0], 'count', 'S3 gateway endpoint is not gated');
hasNot(s3EndpointBlock[0], 'for_each', 'S3 gateway endpoint is not gated');

// --- Account-global ownership and state-safe moves ------------------------

for (const address of [
  'aws_s3_account_public_access_block.this',
  'aws_iam_service_linked_role.autoscaling',
  'aws_ebs_encryption_by_default.this',
  'aws_ebs_default_kms_key.this',
  'aws_sns_topic_subscription.operations_email',
  'data.aws_iam_role.github_deploy',
]) {
  has(moduleMoved, `from = ${address}`, `moved from ${address}`);
  has(moduleMoved, `to   = ${address}[0]`, `moved to ${address}[0]`);
}
has(moduleMain, 'count = var.environment == "prod-secondary" ? 1 : 0', 'account-global counts are prod-secondary only');
matches(moduleMain, /data "aws_iam_role" "autoscaling_existing" \{\s*count = var\.environment == "staging" \? 1 : 0/, 'staging reuses the account-global autoscaling role');
has(moduleMain, 'count = var.operations_alert_email == null ? 0 : 1', 'null operations email disables the subscription');

// --- Fail-closed workflow routes ------------------------------------------

hasNot(deployWorkflow, '\n  push:\n', 'main-push auto-deploy removed');
has(deployWorkflow, 'scripts/ci/guard-staging-route.sh deploy', 'deploy route guarded');
has(planWorkflow, 'scripts/ci/guard-staging-route.sh plan', 'plan route guarded');
has(applyWorkflow, 'scripts/ci/guard-staging-route.sh apply', 'apply route guarded');
has(rollbackWorkflow, 'scripts/ci/guard-staging-route.sh rollback', 'rollback route guarded');
has(planWorkflow, 'staging-target', 'plan exposes the disabled target route');
has(applyWorkflow, 'staging-target', 'apply exposes the disabled target route');
has(guard, 'staging-target)', 'guard recognises the target route');

// Every guard step must run before OIDC credentials, and the routes that let
// TF_ENV select the resolved namespace must pass it to the guard so a staging
// alias cannot reach source-staging through a prod/production route.
const assertGuardBeforeCredentials = (text, label) => {
  const guardAt = text.indexOf('guard-staging-route.sh');
  const credentialsAt = text.indexOf('aws-actions/configure-aws-credentials');
  assert.ok(guardAt !== -1, `${label}: guard step present`);
  assert.ok(credentialsAt !== -1, `${label}: credentials step present`);
  assert.ok(guardAt < credentialsAt, `${label}: guard must run before any OIDC assumption`);
};
for (const [label, text] of Object.entries({ deployWorkflow, planWorkflow, applyWorkflow, rollbackWorkflow })) {
  assertGuardBeforeCredentials(text, `${label} workflow`);
  const guardAt = text.indexOf('guard-staging-route.sh');
  const resolveAt = text.indexOf('- name: Resolve ');
  assert.ok(resolveAt !== -1, `${label}: resolver step present`);
  assert.ok(guardAt < resolveAt, `${label}: guard must run before route resolution`);
}
has(deployWorkflow, 'CONFIGURED_TF_ENV: ${{ vars.TF_ENV }}', 'deploy passes its configured TF_ENV to the guard');
has(rollbackWorkflow, 'CONFIGURED_TF_ENV: ${{ vars.TF_ENV }}', 'rollback passes its configured TF_ENV to the guard');
has(guard, 'configured_tf_env', 'guard binds a configured TF_ENV to the route namespace');

// The generalized template must still render the exact prod-secondary values
// that the pre-change module hardcoded.
const prodResolved = moduleMain
  .replace(/\$\{var\.environment == "prod-secondary" \? "prodSecondarySessionId" : "stagingSessionId"\}/g, 'prodSecondarySessionId')
  .replace(/\$\{var\.environment\}/g, 'prod-secondary');
for (const literal of [
  'config    = "network-survey-prod-secondary-config-${var.account_id}"',
  'SESSION_SECRET_PARAMETER=/network-survey/prod-secondary/api/session-secret',
  'SESSION_COOKIE_NAME=prodSecondarySessionId',
  'RESEND_API_KEY_PARAMETER=${var.enable_resend_credentials ? "/network-survey/prod-secondary/resend/api-key" : ""}',
  'RESEND_PROVIDER_ACCOUNT_SCOPE=network-survey-resend-prod-secondary',
  'RESEND_WEBHOOK_SECRET_PARAMETER=${var.enable_resend_webhook_ingest ? "/network-survey/prod-secondary/resend/webhook-secret" : ""}',
  'RESEND_WEBHOOK_PREVIOUS_SECRET_PARAMETER=${var.enable_resend_webhook_ingest ? "/network-survey/prod-secondary/resend/webhook-previous-secret" : ""}',
  'name              = "/network-survey/prod-secondary/${each.value}"',
  'key                    = "configs/.env.prod-secondary"',
]) {
  has(prodResolved, literal, `prod-secondary rendering preserved: ${literal}`);
}

// --- Least-privilege staging runtime secret read policy -------------------
// The secure staging runtime reads its session SecureString and the RDS
// managed secret with the instance role only. This is Terraform code and was
// not applied. Staging leaves every resend/bootstrap gate off, so the only SSM
// parameter it may read is its own session secret.
const runtimeParamsBlock = moduleMain.match(/sid\s+=\s+"ReadRuntimeParameters"[\s\S]*?\n  \}/);
assert.ok(runtimeParamsBlock, 'runtime SSM parameter statement present');
has(runtimeParamsBlock[0], 'actions = ["ssm:GetParameter", "ssm:GetParameters"]', 'runtime reads SSM parameters');
has(runtimeParamsBlock[0], 'parameter/network-survey/${var.environment}/api/session-secret', 'runtime session secret is environment-derived');
hasNot(runtimeParamsBlock[0], 'parameter/network-survey/${var.environment}/*', 'runtime must not wildcard the parameter namespace');
has(runtimeParamsBlock[0], 'var.enable_resend_credentials ? [', 'resend read is gated by the staging-off feature flag');
has(runtimeParamsBlock[0], 'var.enable_owner_bootstrap ? [', 'bootstrap read is gated by the staging-off feature flag');

const managedSecretBlock = moduleMain.match(/sid\s+=\s+"ReadRDSManagedSecret"[\s\S]*?\n  \}/);
assert.ok(managedSecretBlock, 'runtime RDS managed-secret statement present');
has(managedSecretBlock[0], 'actions   = ["secretsmanager:DescribeSecret", "secretsmanager:GetSecretValue"]', 'runtime reads the managed secret');
has(managedSecretBlock[0], 'resources = [aws_db_instance.postgres.master_user_secret[0].secret_arn]', 'managed-secret read is scoped to the RDS secret');
hasNot(managedSecretBlock[0], '"*"', 'managed-secret read is not wildcarded');

const decryptBlock = moduleMain.match(/sid\s+=\s+"DecryptTargetDataOnly"[\s\S]*?\n  \}/);
assert.ok(decryptBlock, 'runtime decrypt statement present');
has(decryptBlock[0], 'aws_kms_key.rds.arn', 'managed DB secret key is decryptable');

const ssmCoreBlock = moduleMain.match(/data "aws_iam_policy_document" "ssm_core_without_parameter_reads" \{[\s\S]*?\n\}/);
assert.ok(ssmCoreBlock, 'SSM core policy present');
hasNot(ssmCoreBlock[0], 'ssm:GetParameter"', 'SSM core policy must not grant parameter reads');
hasNot(ssmCoreBlock[0], 'ssm:GetParameters"', 'SSM core policy must not grant parameter reads');
hasNot(moduleMain, 'parameter/network-survey/*', 'no wildcard parameter resource anywhere');

// --- Staging dashboard same-origin /api routing ---------------------------
// The exact /api and /api/* behaviors route to the ALB origin with caching off
// and no error-response override (API 401/403/404 stay JSON); the SPA fallback
// is a viewer-request CloudFront Function on the default behavior only.
has(moduleMain, 'for_each = var.environment == "staging" && each.key == "dashboard" ? ["/api", "/api/*"] : []', 'exact /api and /api/* ordered behaviors are staging-dashboard only');
has(moduleMain, 'path_pattern           = ordered_cache_behavior.value', 'both API behaviors use the ordered path pattern');
has(moduleMain, 'target_origin_id       = "${var.environment}-dashboard-api-alb"', 'API behaviors target the ALB origin');
has(moduleMain, 'resource "aws_cloudfront_function" "spa_fallback"', 'SPA fallback is a CloudFront Function, not a distribution error response');
hasNot(moduleMain, 'dynamic "custom_error_response"', 'no distribution-wide error response remains (API errors stay JSON)');

console.log('staging-target contract validation passed');
