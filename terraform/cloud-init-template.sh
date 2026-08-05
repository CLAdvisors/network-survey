#!/bin/bash
# Provisions the API instance runtime. The application itself is NOT baked in
# here: releases are deployed from the artifacts bucket by CI via SSM
# (scripts/deploy/remote-deploy.sh), so app updates never require re-running
# cloud-init or replacing the instance.
set -o pipefail

export DEBIAN_FRONTEND=noninteractive
# awscli v1 (from apt) does not infer the region from instance metadata
export AWS_DEFAULT_REGION=${aws_region}

apt-get update -y
apt-get install -y curl unzip awscli openjdk-17-jre-headless postgresql-client build-essential python3

# CloudWatch Agent forwards bounded API/worker JSON and Embedded Metric Format
# records. Application code must never write payloads, addresses, signatures, or
# secrets to these files.
curl -fsSL https://amazoncloudwatch-agent.s3.amazonaws.com/ubuntu/amd64/latest/amazon-cloudwatch-agent.deb \
  -o /tmp/amazon-cloudwatch-agent.deb
dpkg -i /tmp/amazon-cloudwatch-agent.deb
rm -f /tmp/amazon-cloudwatch-agent.deb

# Node.js 20 LTS
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs

# PM2 process manager, started on boot via systemd
npm install -g pm2
env PATH=$PATH pm2 startup systemd -u ubuntu --hp /home/ubuntu

# Liquibase (used by the deploy script to run DB migrations from this host,
# since the database is not publicly accessible)
LIQUIBASE_VERSION=4.29.2
curl -fsSL "https://github.com/liquibase/liquibase/releases/download/v$LIQUIBASE_VERSION/liquibase-$LIQUIBASE_VERSION.tar.gz" -o /tmp/liquibase.tar.gz
mkdir -p /opt/liquibase
tar -xzf /tmp/liquibase.tar.gz -C /opt/liquibase
ln -sf /opt/liquibase/liquibase /usr/local/bin/liquibase
rm -f /tmp/liquibase.tar.gz

# Service layout
SERVICE_DIR=/opt/service
mkdir -p $SERVICE_DIR/releases $SERVICE_DIR/certs
chown -R ubuntu:ubuntu $SERVICE_DIR

# RDS CA bundle so the API and Liquibase can verify the DB's TLS certificate
curl -fsSL https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem \
  -o $SERVICE_DIR/certs/rds-global-bundle.pem

# Deploy-time configuration consumed by remote-deploy.sh
cat > $SERVICE_DIR/deploy.env <<EOF
CONFIG_BUCKET=${config_bucket}
ARTIFACTS_BUCKET=${artifacts_bucket}
AWS_DEFAULT_REGION=${aws_region}
ENVIRONMENT=${environment}
EOF
chown ubuntu:ubuntu $SERVICE_DIR/deploy.env

cat > /opt/aws/amazon-cloudwatch-agent/etc/amazon-cloudwatch-agent.json <<'EOF'
{
  "agent": { "metrics_collection_interval": 60, "run_as_user": "root" },
  "logs": {
    "logs_collected": {
      "files": {
        "collect_list": [
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

# Host firewall (the security group is the real boundary; this is defense in depth).
# SSH is intentionally not opened; use SSM Session Manager for access.
ufw allow 3000
ufw --force enable

# Bootstrap the latest release if CI has published one; otherwise the first
# run of the deploy workflow will bring the app up.
BOOTSTRAP_DIR=/tmp/ona-bootstrap
if aws s3 cp "s3://${artifacts_bucket}/api/latest-compatible.tar.gz" /tmp/ona-latest.tar.gz; then
  mkdir -p $BOOTSTRAP_DIR
  tar -xzf /tmp/ona-latest.tar.gz -C $BOOTSTRAP_DIR
  bash $BOOTSTRAP_DIR/deploy/remote-deploy.sh $BOOTSTRAP_DIR
  rm -rf $BOOTSTRAP_DIR /tmp/ona-latest.tar.gz
else
  echo "No capability-verified release artifact found in s3://${artifacts_bucket}/api/latest-compatible.tar.gz — run the deploy workflow to install the app."
fi

echo "Setup complete."
