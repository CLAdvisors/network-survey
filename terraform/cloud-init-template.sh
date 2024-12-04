#!/bin/bash

# Update and install dependencies
sudo apt update -y && sudo apt upgrade -y
sudo apt install -y curl

# Install Node.js (LTS version)
curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash -
sudo apt install -y nodejs

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

# Navigate to service directory and install dependencies
cd $SERVICE_DIR
npm install

cd api
npm install

set node_env=prod

# Start the service with PM2
pm2 start server.js --name my-service
pm2 startup
pm2 save

# Enable firewall and allow specific ports (optional)
sudo ufw allow 22       # SSH
sudo ufw allow 3000     # Your service port
sudo ufw enable

echo "Setup complete."
