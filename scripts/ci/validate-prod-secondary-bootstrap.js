const fs = require('fs');
const { spawnSync } = require('child_process');

const read = file => fs.readFileSync(file, 'utf8');
const required = (text, value, file) => {
  if (!text.includes(value)) throw new Error(`${file} is missing bootstrap contract: ${value}`);
};

const templatePath = 'terraform/modules/prod_secondary_platform/cloud-init.sh';
const aptPath = 'terraform/modules/prod_secondary_platform/apt-helper.sh';
const securityPath = 'terraform/modules/prod_secondary_platform/security-upgrade.sh';
const mainPath = 'terraform/modules/prod_secondary_platform/main.tf';
const cloudInit = read(templatePath);
const aptHelper = read(aptPath);
const securityUpgrade = read(securityPath);
const main = read(mainPath);

for (const [text, file] of [[cloudInit, templatePath], [aptHelper, aptPath], [securityUpgrade, securityPath]]) {
  if (/set\s+-[^\n]*x/.test(text)) throw new Error(`${file} must not enable shell tracing`);
}
if (cloudInit.includes('ec2.archive.ubuntu.com') || aptHelper.includes('ec2.archive.ubuntu.com')) {
  throw new Error('bootstrap must not depend on the EC2 regional Ubuntu mirror');
}

for (const value of [
  'APT_MIRRORS=(archive.ubuntu.com us.archive.ubuntu.com)',
  'Acquire::Retries "2"',
  'Acquire::http::Timeout "10"',
  'timeout --signal=TERM --kill-after=15s 60s apt-get -q update',
  '--fix-broken install',
  'dpkg --audit',
  '--download-only install',
  '--no-download install',
  'dpkg --configure -a',
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
  "trap 'on_error 124' TERM INT",
]) required(securityUpgrade, value, securityPath);

for (const value of [
  'ONA_BOOTSTRAP_FAILED',
  'ONA_BOOTSTRAP_SUCCEEDED',
  '/var/lib/ona-bootstrap/status.json',
  'sleep 1500',
  'latest-compatible.tar.gz',
  'timeout --signal=TERM --kill-after=30s 600s',
]) required(cloudInit, value, templatePath);
if (/if\s+aws s3 cp/.test(cloudInit)) throw new Error('missing release artifact must fail bootstrap');

for (const value of [
  'aws_cloudwatch_log_metric_filter" "bootstrap_failure',
  'aws_cloudwatch_metric_alarm" "bootstrap_failure',
  'aws_cloudwatch_log_metric_filter" "security_upgrade_failure',
  'aws_cloudwatch_metric_alarm" "security_upgrade_failure',
  'runtime["bootstrap"]',
  'runtime["host-maintenance"]',
  'apt_helper                 = file("${path.module}/apt-helper.sh")',
  'security_upgrade           = file("${path.module}/security-upgrade.sh")',
  'max_size                  = 3',
  'min_healthy_percentage = 100',
  'max_healthy_percentage = 150',
  'health_check_grace_period = 1800',
]) required(main, value, mainPath);

const substitutions = {
  aws_region: 'us-east-1',
  apt_helper: aptHelper,
  security_upgrade: securityUpgrade,
  config_bucket: 'config-bucket',
  config_key: 'configs/runtime.env',
  artifacts_bucket: 'artifacts-bucket',
  environment: 'prod-secondary',
  bootstrap_log_group: '/test/bootstrap',
  host_maintenance_log_group: '/test/host-maintenance',
  api_log_group: '/test/api',
  email_worker_log_group: '/test/email-worker',
  webhook_worker_log_group: '/test/webhook-worker',
};
const rendered = cloudInit.replace(/\$\{([a-z_]+)\}/g, (token, key) => {
  if (!(key in substitutions)) throw new Error(`unknown Terraform template variable ${token}`);
  return substitutions[key];
});
const syntax = spawnSync('bash', ['-n'], { input: rendered, encoding: 'utf8' });
if (syntax.status !== 0) throw new Error(`rendered cloud-init shell syntax failed:\n${syntax.stderr}`);
for (const [file, text] of [[aptPath, aptHelper], [securityPath, securityUpgrade]]) {
  const result = spawnSync('bash', ['-n'], { input: text, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`${file} shell syntax failed:\n${result.stderr}`);
}

console.log('prod-secondary bootstrap and maintenance contract validated');
