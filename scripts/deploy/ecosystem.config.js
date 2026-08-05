module.exports = {
  apps: [
    {
      name: 'ona-api',
      script: 'server.js',
      cwd: '/opt/service/current/api',
      env: {
        NODE_ENV: 'prod',
        RELEASE_REVISION: process.env.RELEASE_REVISION,
        EMAIL_WORKER_ENV: process.env.EMAIL_WORKER_ENV,
      },
      kill_timeout: 10000,
    },
    {
      name: 'ona-email-worker',
      script: 'email-worker.js',
      cwd: '/opt/service/current/api',
      env: {
        NODE_ENV: 'prod',
        RELEASE_REVISION: process.env.RELEASE_REVISION,
        EMAIL_WORKER_ENV: process.env.EMAIL_WORKER_ENV,
      },
      kill_timeout: 30000,
    },
  ],
};
