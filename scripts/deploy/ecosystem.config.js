// Limits are RSS tripwires, not capacity reservations. Enable them only on the
// reviewed 2 GiB prod-secondary hosts; source prod/staging still use smaller
// shapes. Their 784 MiB aggregate leaves substantial OS/agent headroom. A
// worker memory restart is safe because durable leases and provider idempotency
// keys fence replay after an ambiguous termination.
// Hosted environments whose processes must load credentials from SSM/Secrets
// Manager after spawn instead of receiving them from the PM2 parent. Keep in
// sync with api/runtime-secrets.js and deploy/runtime-pool.js.
const secureHosted = process.env.EMAIL_WORKER_ENV === 'staging';
const memoryLimit = (limit) => process.env.EMAIL_WORKER_ENV === 'prod-secondary'
  ? { max_memory_restart: limit }
  : {};
// PM2 bounds consecutive starts that fail before min_uptime. Later recurring
// failures are alarmed operationally; max_restarts is not a lifetime budget.
const failureContainment = {
  autorestart: true,
  min_uptime: '30s',
  max_restarts: 10,
  restart_delay: 1000,
  exp_backoff_restart_delay: 1000,
};

module.exports = {
  apps: [
    {
      name: 'ona-api',
      script: secureHosted ? 'secure-runtime.js' : 'server.js',
      args: secureHosted ? 'api' : undefined,
      cwd: '/opt/service/current/api',
      env: {
        NODE_ENV: secureHosted ? 'production' : 'prod',
        RELEASE_REVISION: process.env.RELEASE_REVISION,
        DEPLOYMENT_ID: process.env.DEPLOYMENT_ID,
        EMAIL_WORKER_ENV: process.env.EMAIL_WORKER_ENV,
      },
      kill_timeout: 30000,
      ...memoryLimit('352M'),
      ...failureContainment,
    },
    {
      name: 'ona-email-worker',
      script: secureHosted ? 'secure-runtime.js' : 'email-worker.js',
      args: secureHosted ? 'delivery' : undefined,
      cwd: '/opt/service/current/api',
      env: {
        NODE_ENV: secureHosted ? 'production' : 'prod',
        RELEASE_REVISION: process.env.RELEASE_REVISION,
        DEPLOYMENT_ID: process.env.DEPLOYMENT_ID,
        EMAIL_WORKER_ENV: process.env.EMAIL_WORKER_ENV,
      },
      kill_timeout: 30000,
      ...memoryLimit('176M'),
      ...failureContainment,
    },
    {
      name: 'ona-email-webhook-worker',
      script: secureHosted ? 'secure-runtime.js' : 'webhook-worker.js',
      args: secureHosted ? 'webhook' : undefined,
      cwd: '/opt/service/current/api',
      env: {
        NODE_ENV: secureHosted ? 'production' : 'prod',
        APP_ENV: process.env.EMAIL_WORKER_ENV,
        RELEASE_REVISION: process.env.RELEASE_REVISION,
        DEPLOYMENT_ID: process.env.DEPLOYMENT_ID,
        EMAIL_WORKER_ENV: process.env.EMAIL_WORKER_ENV,
      },
      kill_timeout: 30000,
      ...memoryLimit('256M'),
      ...failureContainment,
    },
  ],
};
