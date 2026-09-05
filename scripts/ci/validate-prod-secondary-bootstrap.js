const fs = require('fs');
const { spawnSync } = require('child_process');
const { gzipSync } = require('zlib');

const read = file => fs.readFileSync(file, 'utf8');
const required = (text, value, file) => {
  if (!text.includes(value)) throw new Error(`${file} is missing bootstrap contract: ${value}`);
};

const templatePath = 'terraform/modules/prod_secondary_platform/cloud-init.sh';
const aptPath = 'terraform/modules/prod_secondary_platform/apt-helper.sh';
const securityPath = 'terraform/modules/prod_secondary_platform/security-upgrade.sh';
const mainPath = 'terraform/modules/prod_secondary_platform/main.tf';
const remoteDeployPath = 'scripts/deploy/remote-deploy.sh';
const applyWorkflowPath = '.github/workflows/terraform-apply.yml';
const planWorkflowPath = '.github/workflows/terraform-plan.yml';
const moduleVariablesPath = 'terraform/modules/prod_secondary_platform/variables.tf';
const cloudInit = read(templatePath);
const aptHelper = read(aptPath);
const securityUpgrade = read(securityPath);
const main = read(mainPath);
const remoteDeploy = read(remoteDeployPath);
const applyWorkflow = read(applyWorkflowPath);
const planWorkflow = read(planWorkflowPath);
const moduleVariables = read(moduleVariablesPath);

for (const [text, file] of [[cloudInit, templatePath], [aptHelper, aptPath], [securityUpgrade, securityPath]]) {
  if (/set\s+-[^\n]*x/.test(text)) throw new Error(`${file} must not enable shell tracing`);
}
if (cloudInit.includes('ec2.archive.ubuntu.com') || aptHelper.includes('ec2.archive.ubuntu.com')) {
  throw new Error('bootstrap must not depend on the EC2 regional Ubuntu mirror');
}

for (const value of [
  'APT_MIRRORS=(archive.ubuntu.com us.archive.ubuntu.com)',
  String.raw`security\\.ubuntu\\.com/ubuntu/?`,
  'Acquire::Retries "2"',
  'Acquire::http::Timeout "10"',
  'timeout --signal=TERM --kill-after=15s 60s "${ONA_APT_GET:-apt-get}" -q update',
  '--fix-broken install',
  '"${ONA_DPKG:-dpkg}" --audit',
  '--download-only install',
  '--no-download install',
  '"${ONA_DPKG:-dpkg}" --configure -a',
]) required(`${aptHelper}\n${cloudInit}`, value, 'apt bootstrap');

for (const value of [
  'systemctl mask --now apt-daily.timer apt-daily-upgrade.timer',
  "*a) patch_time='Sat *-*-* 06:15:00 UTC'",
  "*b) patch_time='Sat *-*-* 07:15:00 UTC'",
  'Persistent=false',
  'RandomizedDelaySec=0',
  'Unattended-Upgrade::Automatic-Reboot "false"',
  '#clear Unattended-Upgrade::Allowed-Origins;',
  '"Ubuntu:jammy-security";',
  'TimeoutStartSec=1300',
]) required(cloudInit, value, templatePath);

for (const value of [
  'nice -n 15 ionice -c 3 unattended-upgrade --verbose',
  'ONA_SECURITY_UPGRADE_FAILED',
  'security-upgrade-status.json',
  'describe-target-health',
  'healthy_targets" -ge 2',
  "trap 'on_error 124' TERM INT",
]) required(securityUpgrade, value, securityPath);

for (const value of [
  'ONA_BOOTSTRAP_FAILED',
  'ONA_BOOTSTRAP_SUCCEEDED',
  '/var/lib/ona-bootstrap/status.json',
  'flock -w 30 9',
  'latest-compatible.tar.gz',
  'touch "$SERVICE_DIR/alb-live-health-required"',
  'timeout --signal=TERM --kill-after=30s 600s',
  'if [ -s "$STATUS_DIR/deployed-revision" ]; then',
  'HOST_HAS_BEEN_READY',
  'set_step open-readiness',
  'ufw allow 3000',
  'timeout --signal=TERM --kill-after=30s 120s dpkg -i',
]) required(cloudInit, value, templatePath);
if (/if\s+aws s3 cp/.test(cloudInit)) throw new Error('missing release artifact must fail bootstrap');
if (/artifact_revision.*current_revision/s.test(cloudInit)) throw new Error('API health/revision must not bypass complete deployment verification');
if (cloudInit.indexOf('ufw allow 3000') < cloudInit.indexOf('remote-deploy.sh')) throw new Error('ALB port must remain closed until deployment succeeds');

for (const value of ['if [ "$ENVIRONMENT" = "prod-secondary" ]; then', 'ona-deploy.lock', 'flock -w 60 8']) required(remoteDeploy, value, remoteDeployPath);

for (const value of [
  'elasticloadbalancing:DescribeTargetHealth',
  'target_group_arn           = aws_lb_target_group.api.arn',
  'aws_cloudwatch_log_metric_filter" "bootstrap_failure',
  'aws_cloudwatch_metric_alarm" "bootstrap_failure',
  'aws_cloudwatch_log_metric_filter" "security_upgrade_failure',
  'aws_cloudwatch_metric_alarm" "security_upgrade_failure',
  'runtime["bootstrap"]',
  'runtime["host-maintenance"]',
  'runtime["host"]',
  'apt_helper                 = file("${path.module}/apt-helper.sh")',
  'security_upgrade           = file("${path.module}/security-upgrade.sh")',
  'max_size                  = 3',
  'min_healthy_percentage = 100',
  'max_healthy_percentage = 150',
  'health_check_grace_period = 1800',
  'instance_warmup        = 2700',
  'user_data = base64gzip(',
  'data "aws_ami" "pinned"',
  'values = [var.ami_id]',
  'owners      = ["099720109477"]',
  'values = ["x86_64"]',
  'image_id      = data.aws_ami.pinned.id',
]) required(main, value, mainPath);
required(moduleVariables, 'Explicitly reviewed prod-secondary AMI ID', moduleVariablesPath);
if (/most_recent\s*=\s*true/.test(main)) throw new Error('prod-secondary must not resolve a moving latest AMI');
for (const [workflow, file] of [[applyWorkflow, applyWorkflowPath], [planWorkflow, planWorkflowPath]]) {
  for (const value of ['PROD_SECONDARY_AMI_ID', 'TF_VAR_ami_id']) required(workflow, value, file);
}

const substitutions = {
  aws_region: 'us-east-1',
  apt_helper: aptHelper,
  security_upgrade: securityUpgrade,
  target_group_arn: 'arn:aws:elasticloadbalancing:us-east-1:111122223333:targetgroup/test/1234',
  config_bucket: 'config-bucket',
  config_key: 'configs/runtime.env',
  artifacts_bucket: 'artifacts-bucket',
  environment: 'prod-secondary',
  bootstrap_log_group: '/test/bootstrap',
  host_maintenance_log_group: '/test/host-maintenance',
  host_log_group: '/test/host',
  api_log_group: '/test/api',
  email_worker_log_group: '/test/email-worker',
  webhook_worker_log_group: '/test/webhook-worker',
};
const escapedInterpolation = '__ESCAPED_SHELL_INTERPOLATION__';
const rendered = cloudInit
  .replace(/\$\$\{/g, `${escapedInterpolation}{`)
  .replace(/\$\{([a-z_]+)\}/g, (token, key) => {
    if (!(key in substitutions)) throw new Error(`unknown Terraform template variable ${token}`);
    return substitutions[key];
  })
  .replaceAll(`${escapedInterpolation}{`, '${');
const compressedBytes = gzipSync(rendered).byteLength;
if (compressedBytes > 16384) throw new Error(`compressed EC2 user data is ${compressedBytes} bytes; limit is 16384`);
const syntax = spawnSync('bash', ['-n'], { input: rendered, encoding: 'utf8' });
if (syntax.status !== 0) throw new Error(`rendered cloud-init shell syntax failed:\n${syntax.stderr}`);
for (const [file, text] of [[aptPath, aptHelper], [securityPath, securityUpgrade]]) {
  const result = spawnSync('bash', ['-n'], { input: text, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`${file} shell syntax failed:\n${result.stderr}`);
}

console.log('prod-secondary bootstrap and maintenance contract validated');
