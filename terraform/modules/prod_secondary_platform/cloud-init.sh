#!/bin/bash
# Provisions the API instance runtime. The application itself is NOT baked in
# here: releases are deployed from the artifacts bucket by CI via SSM
# (scripts/deploy/remote-deploy.sh), so app updates never require replacing the
# instance. This script is intentionally safe to rerun through cloud-init or SSM.
set -Eeuo pipefail

export DEBIAN_FRONTEND=noninteractive
# awscli v1 (from apt) does not infer the region from instance metadata.
export AWS_DEFAULT_REGION=${aws_region}
export AWS_RETRY_MODE=standard
export AWS_MAX_ATTEMPTS=4

BOOTSTRAP_LOG=/var/log/ona-bootstrap.log
STATUS_DIR=/var/lib/ona-bootstrap
STATUS_FILE=/var/lib/ona-bootstrap/status.json
CURRENT_STEP=initializing
mkdir -p "$STATUS_DIR"
touch "$BOOTSTRAP_LOG"
chmod 0640 "$BOOTSTRAP_LOG"
# No xtrace is used and no secret values are printed. CloudWatch backfills this
# operational log after its agent is installed; the EC2 console also retains it.
exec > >(tee -a "$BOOTSTRAP_LOG" /dev/console) 2>&1

set_step() {
  CURRENT_STEP=$1
  printf '{"status":"running","step":"%s","updated_at":"%s"}\n' \
    "$CURRENT_STEP" "$(date --utc +%FT%TZ)" > "$STATUS_FILE"
  echo "ONA_BOOTSTRAP_STEP step=$CURRENT_STEP"
}

on_error() {
  local exit_code=$1
  local line=$2
  trap - ERR TERM
  printf '{"status":"failed","step":"%s","failed_at":"%s","exit_code":%d,"line":%d}\n' \
    "$CURRENT_STEP" "$(date --utc +%FT%TZ)" "$exit_code" "$line" > "$STATUS_FILE"
  echo "ONA_BOOTSTRAP_FAILED step=$CURRENT_STEP exit_code=$exit_code line=$line" >&2
  exit "$exit_code"
}
trap 'on_error "$?" "$LINENO"' ERR
trap 'on_error 124 "$LINENO"' TERM

# Enforce one bootstrap at a time. Every network operation has its own deadline;
# the ASG health grace is the outer readiness deadline. A failed host never passes
# the ALB /health gate, while a planned refresh retains both old healthy targets.
exec 9>/run/lock/ona-bootstrap.lock
flock -w 30 9 || { echo 'ONA_BOOTSTRAP_LOCK_TIMEOUT' >&2; on_error 75 "$LINENO"; }

set_step disable-default-apt-timers
# Ubuntu's randomized apt timers previously overlapped on both app hosts and can
# consume enough resources to starve health checks when a mirror degrades.
timeout --signal=TERM --kill-after=15s 90s \
  systemctl mask --now apt-daily.timer apt-daily-upgrade.timer \
    apt-daily.service apt-daily-upgrade.service
cat > /etc/apt/apt.conf.d/99-ona-network-bounds <<'EOF'
Acquire::Retries "2";
Acquire::http::Timeout "10";
Acquire::https::Timeout "10";
Acquire::Queue-Mode "host";
APT::Update::Error-Mode "any";
DPkg::Lock::Timeout "30";
Dpkg::Use-Pty "0";
APT::Periodic::Enable "0";
Unattended-Upgrade::Automatic-Reboot "false";
EOF
cat > /etc/apt/apt.conf.d/52-ona-unattended-upgrades <<'EOF'
#clear Unattended-Upgrade::Allowed-Origins;
#clear Unattended-Upgrade::Origins-Pattern;
Unattended-Upgrade::Allowed-Origins {
  "Ubuntu:jammy-security";
};
EOF

set_step install-apt-helper
cat > /usr/local/sbin/ona-apt <<'ONA_APT_HELPER'
${apt_helper}
ONA_APT_HELPER
chmod 0755 /usr/local/sbin/ona-apt

set_step install-base-packages
/usr/local/sbin/ona-apt install \
  curl unzip awscli openjdk-17-jre-headless postgresql-client build-essential \
  python3 ca-certificates unattended-upgrades

bounded_curl() {
  curl --fail --silent --show-error --location \
    --retry 3 --retry-delay 2 --retry-all-errors \
    --connect-timeout 10 --max-time 120 "$@"
}

set_step install-cloudwatch-agent
cloudwatch_deb=$(mktemp /tmp/amazon-cloudwatch-agent.XXXXXX.deb)
bounded_curl https://amazoncloudwatch-agent.s3.amazonaws.com/ubuntu/amd64/latest/amazon-cloudwatch-agent.deb \
  -o "$cloudwatch_deb"
dpkg-deb --info "$cloudwatch_deb" >/dev/null
dpkg -i "$cloudwatch_deb"
rm -f "$cloudwatch_deb"

set_step install-node
nodesource_setup=$(mktemp /tmp/nodesource-setup.XXXXXX.sh)
bounded_curl https://deb.nodesource.com/setup_20.x -o "$nodesource_setup"
timeout --signal=TERM --kill-after=30s 180s bash "$nodesource_setup"
rm -f "$nodesource_setup"
/usr/local/sbin/ona-apt install nodejs

set_step install-pm2
timeout --signal=TERM --kill-after=30s 180s npm install --global pm2
timeout --signal=TERM --kill-after=15s 60s \
  env PATH="$PATH" pm2 startup systemd -u ubuntu --hp /home/ubuntu

set_step install-liquibase
LIQUIBASE_VERSION=4.29.2
LIQUIBASE_DIR=/opt/liquibase/$LIQUIBASE_VERSION
if [ ! -x "$LIQUIBASE_DIR/liquibase" ]; then
  liquibase_archive=$(mktemp /tmp/liquibase.XXXXXX.tar.gz)
  liquibase_extract=$(mktemp -d /tmp/liquibase.XXXXXX)
  bounded_curl "https://github.com/liquibase/liquibase/releases/download/v$LIQUIBASE_VERSION/liquibase-$LIQUIBASE_VERSION.tar.gz" \
    -o "$liquibase_archive"
  tar -tzf "$liquibase_archive" >/dev/null
  tar -xzf "$liquibase_archive" -C "$liquibase_extract"
  mkdir -p /opt/liquibase
  rm -rf "$LIQUIBASE_DIR"
  mv "$liquibase_extract" "$LIQUIBASE_DIR"
  rm -f "$liquibase_archive"
fi
ln -sfn "$LIQUIBASE_DIR/liquibase" /usr/local/bin/liquibase

set_step configure-service
SERVICE_DIR=/opt/service
mkdir -p "$SERVICE_DIR/releases" "$SERVICE_DIR/certs"
chown -R ubuntu:ubuntu "$SERVICE_DIR"

rds_bundle=$(mktemp /tmp/rds-global-bundle.XXXXXX.pem)
bounded_curl https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem -o "$rds_bundle"
install -o ubuntu -g ubuntu -m 0644 "$rds_bundle" "$SERVICE_DIR/certs/rds-global-bundle.pem"
rm -f "$rds_bundle"

cat > "$SERVICE_DIR/deploy.env" <<EOF
CONFIG_BUCKET=${config_bucket}
CONFIG_KEY=${config_key}
ARTIFACTS_BUCKET=${artifacts_bucket}
AWS_DEFAULT_REGION=${aws_region}
ENVIRONMENT=${environment}
EOF
chown ubuntu:ubuntu "$SERVICE_DIR/deploy.env"
chmod 0640 "$SERVICE_DIR/deploy.env"

set_step configure-maintenance
cat > /usr/local/sbin/ona-security-upgrade <<'ONA_SECURITY_UPGRADE'
${security_upgrade}
ONA_SECURITY_UPGRADE
chmod 0755 /usr/local/sbin/ona-security-upgrade

# Stagger the two AZs deterministically. Unknown/future AZs use a third fixed
# slot rather than Ubuntu's host-randomized one-hour window.
imds_token=$(curl -fsS --connect-timeout 2 --max-time 5 -X PUT \
  -H 'X-aws-ec2-metadata-token-ttl-seconds: 60' \
  http://169.254.169.254/latest/api/token 2>/dev/null || true)
availability_zone=
if [ -n "$imds_token" ]; then
  availability_zone=$(curl -fsS --connect-timeout 2 --max-time 5 \
    -H "X-aws-ec2-metadata-token: $imds_token" \
    http://169.254.169.254/latest/meta-data/placement/availability-zone 2>/dev/null || true)
fi
case "$availability_zone" in
  *a) patch_time='Sat *-*-* 06:15:00 UTC' ;;
  *b) patch_time='Sat *-*-* 07:15:00 UTC' ;;
  *)  patch_time='Sat *-*-* 08:15:00 UTC' ;;
esac
cat > /etc/systemd/system/ona-security-upgrades.service <<'EOF'
[Unit]
Description=Bounded prod-secondary security upgrade
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
ExecStart=/usr/local/sbin/ona-security-upgrade
Nice=15
IOSchedulingClass=idle
TimeoutStartSec=1300
EOF
cat > /etc/systemd/system/ona-security-upgrades.timer <<EOF
[Unit]
Description=Deterministic prod-secondary security upgrade schedule

[Timer]
OnCalendar=$patch_time
Persistent=false
RandomizedDelaySec=0
Unit=ona-security-upgrades.service

[Install]
WantedBy=timers.target
EOF
systemctl daemon-reload
systemctl enable --now ona-security-upgrades.timer

set_step configure-cloudwatch
cat > /opt/aws/amazon-cloudwatch-agent/etc/amazon-cloudwatch-agent.json <<'EOF'
{
  "agent": { "metrics_collection_interval": 60, "run_as_user": "root" },
  "logs": {
    "logs_collected": {
      "files": {
        "collect_list": [
          { "file_path": "/var/log/ona-bootstrap.log", "log_group_name": "${bootstrap_log_group}", "log_stream_name": "{instance_id}/bootstrap", "timezone": "UTC" },
          { "file_path": "/var/log/ona-security-upgrades.log", "log_group_name": "${host_maintenance_log_group}", "log_stream_name": "{instance_id}/security-upgrades", "timezone": "UTC" },
          { "file_path": "/home/ubuntu/.pm2/logs/ona-api-out.log", "log_group_name": "${api_log_group}", "log_stream_name": "{instance_id}/stdout", "timezone": "UTC" },
          { "file_path": "/home/ubuntu/.pm2/logs/ona-api-error.log", "log_group_name": "${api_log_group}", "log_stream_name": "{instance_id}/stderr", "timezone": "UTC" },
          { "file_path": "/home/ubuntu/.pm2/logs/ona-email-worker-out.log", "log_group_name": "${email_worker_log_group}", "log_stream_name": "{instance_id}/stdout", "timezone": "UTC" },
          { "file_path": "/home/ubuntu/.pm2/logs/ona-email-worker-error.log", "log_group_name": "${email_worker_log_group}", "log_stream_name": "{instance_id}/stderr", "timezone": "UTC" },
          { "file_path": "/home/ubuntu/.pm2/logs/ona-email-webhook-worker-out.log", "log_group_name": "${webhook_worker_log_group}", "log_stream_name": "{instance_id}/stdout", "timezone": "UTC" },
          { "file_path": "/home/ubuntu/.pm2/logs/ona-email-webhook-worker-error.log", "log_group_name": "${webhook_worker_log_group}", "log_stream_name": "{instance_id}/stderr", "timezone": "UTC" }
        ]
      }
    }
  }
}
EOF
/opt/aws/amazon-cloudwatch-agent/bin/amazon-cloudwatch-agent-ctl \
  -a fetch-config -m ec2 \
  -c file:/opt/aws/amazon-cloudwatch-agent/etc/amazon-cloudwatch-agent.json -s

set_step configure-firewall
# The security group remains the primary boundary. SSH stays closed; use SSM.
ufw allow 3000
ufw --force enable

set_step deploy-release
BOOTSTRAP_DIR=/tmp/ona-bootstrap
rm -rf "$BOOTSTRAP_DIR" /tmp/ona-latest.tar.gz
# A production replacement is not ready without the capability-verified release.
timeout --signal=TERM --kill-after=30s 180s \
  aws s3 cp "s3://${artifacts_bucket}/api/latest-compatible.tar.gz" /tmp/ona-latest.tar.gz
mkdir -p "$BOOTSTRAP_DIR"
tar -tzf /tmp/ona-latest.tar.gz >/dev/null
tar -xzf /tmp/ona-latest.tar.gz -C "$BOOTSTRAP_DIR"
artifact_revision=$(cat "$BOOTSTRAP_DIR/REVISION")
current_revision=$(cat "$SERVICE_DIR/current/REVISION" 2>/dev/null || true)
if [ "$artifact_revision" = "$current_revision" ] && \
   curl -fsS --connect-timeout 2 --max-time 5 http://localhost:3000/health >/dev/null; then
  echo "Release $artifact_revision is already healthy; deployment is converged."
else
  timeout --signal=TERM --kill-after=30s 600s \
    bash "$BOOTSTRAP_DIR/deploy/remote-deploy.sh" "$BOOTSTRAP_DIR"
fi
rm -rf "$BOOTSTRAP_DIR" /tmp/ona-latest.tar.gz

set_step complete
printf '{"status":"succeeded","step":"complete","finished_at":"%s"}\n' \
  "$(date --utc +%FT%TZ)" > "$STATUS_FILE"
echo 'ONA_BOOTSTRAP_SUCCEEDED'
trap - ERR TERM
