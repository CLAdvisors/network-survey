#!/bin/bash

# Update and install dependencies
sudo apt update -y && sudo apt upgrade -y
sudo apt install -y curl

# Install Node.js (LTS version)
curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash -
sudo apt install -y nodejs

export HOME=/home/ubuntu
export PM2_HOME=$HOME/.pm2
export NODE_ENV=prod
export node_env=prod

# Install PM2 globally
sudo npm install -g pm2

# Create a directory for the service
SERVICE_DIR="/opt/service"
sudo mkdir -p $SERVICE_DIR
sudo chown ubuntu:ubuntu $SERVICE_DIR

# Clone your service repository (replace with your repo)
git clone https://github.com/CLAdvisors/network-survey.git $SERVICE_DIR

sudo apt-get install -y awscli
aws s3 cp s3://${bucket_name}/configs/.env.prod $SERVICE_DIR/api/.env.prod
sudo rm -rf $SERVICE_DIR/api/.env.local

# Navigate to service directory and install dependencies
cd $SERVICE_DIR
npm install

cd api
npm install

# Start the service with PM2
sudo -u ubuntu -H bash -lc 'cd /opt/service/api && export NODE_ENV=prod && pm2 start server.js --name my-service --env prod'
sudo -u ubuntu -H bash -lc 'pm2 save'
sudo -u ubuntu -H bash -lc 'pm2 status'

# Enable firewall and allow specific ports (optional)
sudo ufw allow 22       # SSH
sudo ufw allow 3000     # Your service port
sudo ufw enable

echo "Setup complete."
