// Limits are RSS tripwires, not capacity reservations. Enable them only on the
// reviewed 2 GiB prod-secondary hosts; source prod/staging still use smaller
// shapes. Their 704 MiB aggregate leaves substantial OS/agent headroom. A
// worker memory restart is safe because durable leases and provider idempotency
// keys fence replay after an ambiguous termination.
const memoryLimit = (limit) => process.env.EMAIL_WORKER_ENV === 'prod-secondary'
  ? { max_memory_restart: limit }
  : {};
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
      script: 'server.js',
      cwd: '/opt/service/current/api',
      env: {
        NODE_ENV: 'prod',
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
      script: 'email-worker.js',
      cwd: '/opt/service/current/api',
      env: {
        NODE_ENV: 'prod',
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
      script: 'webhook-worker.js',
      cwd: '/opt/service/current/api',
      env: {
        NODE_ENV: 'prod',
        APP_ENV: process.env.EMAIL_WORKER_ENV,
        RELEASE_REVISION: process.env.RELEASE_REVISION,
        DEPLOYMENT_ID: process.env.DEPLOYMENT_ID,
        EMAIL_WORKER_ENV: process.env.EMAIL_WORKER_ENV,
      },
      kill_timeout: 30000,
      ...memoryLimit('176M'),
      ...failureContainment,
    },
  ],
};
