'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { Pool } = require('pg');
const { ResendProvider, classifyProviderError, demoEmailIdempotencyKey } = require('../email');
const { DeliveryWorker } = require('../email-worker');
const { WebhookWorker } = require('../webhook-worker');
const {
  createDependencyProbe,
  createHealthHandlers,
  createNonOverlappingScheduler,
  guardCheckedOutClient,
  isTransientDatabaseError,
  poolConfigFromEnv,
  probeDatabase,
  startRuntimeTelemetry,
} = require('../runtime-resilience');

test('PostgreSQL pool configuration bounds acquisition, statements, queries, idle transactions, and socket keepalive', () => {
  const config = poolConfigFromEnv({
    DB_POOL_ACQUIRE_TIMEOUT_MS: '321',
    DB_QUERY_TIMEOUT_MS: '654',
    DB_STATEMENT_TIMEOUT_MS: '999',
    DB_IDLE_TRANSACTION_TIMEOUT_MS: '777',
    DB_SOCKET_KEEPALIVE_DELAY_MS: '2222',
  });
  assert.equal(config.maxLifetimeSeconds, 1800);
  assert.equal(config.connectionTimeoutMillis, 321);
  assert.equal(poolConfigFromEnv({ DB_QUERY_TIMEOUT_MS:'' }).query_timeout, 10000);
  assert.equal(config.query_timeout, 654);
  assert.equal(config.statement_timeout, 654, 'server timeout cannot exceed the client query deadline');
  assert.equal(config.idle_in_transaction_session_timeout, 1000); // clamped safe floor
  assert.equal(config.keepAlive, true);
  assert.equal(config.keepAliveInitialDelayMillis, 2222);
});

test('node-postgres rejects a hung socket acquisition within the configured deadline', async () => {
  class HangingClient extends EventEmitter {
    connect(callback) { this.connectCallback = callback; }
    isConnected() { return false; }
    end() { this.connectCallback(new Error('ended')); }
  }
  const pool = new Pool({ Client:HangingClient, max:1, connectionTimeoutMillis:20 });
  const keepAlive = setTimeout(() => {}, 500);
  const started = Date.now();
  await assert.rejects(pool.connect(), /connection timeout/i);
  clearTimeout(keepAlive);
  assert.ok(Date.now() - started < 250);
  await pool.end();
});

test('checked-out clients are destroyed after uncancelled query and socket timeouts, including rollback paths', async () => {
  const released = [];
  let calls = 0;
  const timeout = new Error('Query read timeout');
  const client = guardCheckedOutClient({
    query:async () => {
      calls += 1;
      if (calls === 1) throw timeout;
      return { rows:[] }; // transaction catch may still attempt ROLLBACK
    },
    release:(error) => released.push(error),
  });
  try { await client.query('SELECT pg_sleep(60)'); }
  catch (error) { await client.query('ROLLBACK'); }
  client.release();
  assert.equal(released[0], timeout, 'a later successful rollback must not clear the poison');

  const socket = new Error('socket hang up');
  socket.code = 'ECONNRESET';
  const socketReleased = [];
  const socketClient = guardCheckedOutClient({
    query:async () => { throw socket; },
    release:(error) => socketReleased.push(error),
  });
  await assert.rejects(socketClient.query('SELECT 1'), /socket hang up/);
  socketClient.release();
  assert.equal(socketReleased[0], socket);

  const reusable = { query() { return Promise.resolve({ rows:[] }); } };
  const exactQuery = reusable.query;
  for (let index = 0; index < 1000; index += 1) {
    const checkoutRelease = function checkoutRelease() { assert.equal(this, reusable); };
    reusable.release = checkoutRelease;
    guardCheckedOutClient(reusable);
    assert.notEqual(reusable.query, exactQuery);
    reusable.release();
    assert.equal(reusable.query, exactQuery, 'guard must restore the exact query identity');
    assert.equal(reusable.release, checkoutRelease, 'guard must restore the exact per-checkout release identity');
    assert.equal(reusable.__runtimeResilienceGuarded, undefined);
  }
});

test('hung database query fails its health deadline and concurrent probes are single-flight', async () => {
  let calls = 0;
  const pool = { query() { calls += 1; return new Promise(() => {}); } };
  const probe = createDependencyProbe(pool, { timeoutMs:20, cacheMs:50 });
  const [first, second] = await Promise.all([probe(), probe()]);
  assert.equal(first.ok, false);
  assert.equal(second.ok, false);
  assert.equal(calls, 1);
  assert.equal((await probe()).ok, false);
  assert.equal(calls, 1, 'failure is briefly cached to avoid a health-check pool stampede');
});

test('database retry classification is narrow and does not hide programming failures', () => {
  assert.equal(isTransientDatabaseError({ code:'57014' }), true);
  assert.equal(isTransientDatabaseError({ code:'ECONNRESET' }), true);
  assert.equal(isTransientDatabaseError(new Error('Query read timeout')), true);
  assert.equal(isTransientDatabaseError(new TypeError('broken invariant')), false);
});

test('delivery worker degrades through repeated DB stalls instead of exiting into a restart loop', async () => {
  let sleeps = 0;
  let worker;
  const pool = {
    query: async () => { throw Object.assign(new Error('statement timeout'), { code:'57014' }); },
    totalCount:0, idleCount:0, waitingCount:0, options:{ max:10 },
  };
  worker = new DeliveryWorker({
    pool,
    provider:{ send:async () => ({ id:'unused' }) },
    env:{ EMAIL_WORKER_ENV:'test', RESEND_PROVIDER_ACCOUNT_SCOPE:'local-test' },
    sleepFn:async () => { sleeps += 1; if (sleeps === 2) worker.stop(); },
    instanceId:'test/runtime-stall',
  });
  await worker.run();
  assert.equal(sleeps, 2);
  assert.match(worker.lastError, /statement timeout/);
});

test('delivery worker surfaces unexpected failures to PM2 containment', async () => {
  const worker = new DeliveryWorker({
    pool:{
      query:async () => { throw new TypeError('broken invariant'); },
      totalCount:0, idleCount:0, waitingCount:0, options:{ max:10 },
    },
    provider:{ send:async () => ({ id:'unused' }) },
    env:{ EMAIL_WORKER_ENV:'test', RESEND_PROVIDER_ACCOUNT_SCOPE:'local-test' },
    sleepFn:async () => { throw new Error('unexpected sleep'); },
    instanceId:'test/programming-failure',
  });
  await assert.rejects(worker.run(), /broken invariant/);
});

test('non-overlapping scheduler does not arm another run while a task is hung', async () => {
  const timers = [];
  let release;
  let runs = 0;
  const scheduler = createNonOverlappingScheduler(async () => {
    runs += 1;
    await new Promise((resolve) => { release = resolve; });
  }, {
    intervalMs: 10,
    initialDelayMs: 0,
    setTimer(callback) { timers.push(callback); return { unref() {} }; },
    clearTimer() {},
  });

  assert.equal(timers.length, 1);
  const running = timers.shift()();
  await Promise.resolve();
  assert.equal(runs, 1);
  assert.equal(timers.length, 0);
  release();
  await running;
  assert.equal(timers.length, 1);
  scheduler.stop();
});

test('provider deadline covers a slow response body and remains ambiguous/idempotent', async () => {
  let observedKey;
  const provider = new ResendProvider({
    apiKey: 'test-key',
    timeoutMs: 20,
    fetchImpl: async (url, options) => {
      observedKey = options.headers['Idempotency-Key'];
      return {
        ok: true,
        status: 200,
        headers: { get: () => null },
        json: () => new Promise((resolve, reject) => {
          options.signal.addEventListener('abort', () => {
            const error = new Error('aborted');
            error.name = 'AbortError';
            reject(error);
          });
        }),
      };
    },
  });
  await assert.rejects(
    provider.send({ to:'nobody@example.test' }, { idempotencyKey:'delivery/stable-key' }),
    (error) => error.code === 'timeout' && error.uncertain && classifyProviderError(error) === 'ambiguous'
  );
  assert.equal(observedKey, 'delivery/stable-key');
});

test('provider preserves a known HTTP rejection when its body times out', async () => {
  const provider = new ResendProvider({
    apiKey:'test-key',
    timeoutMs:20,
    fetchImpl:async (url, options) => ({
      ok:false,
      status:429,
      headers:{ get:(name) => name === 'retry-after' ? '7' : null },
      json:() => new Promise((resolve, reject) => options.signal.addEventListener('abort', () => {
        const error = new Error('aborted');
        error.name = 'AbortError';
        reject(error);
      })),
    }),
  });
  await assert.rejects(provider.send({}, { idempotencyKey:'known-rejection' }), (error) => (
    error.code === 'http_429' && error.status === 429 && error.retryAfter === '7' && !error.uncertain
  ));
});

test('liveness is dependency-free while readiness fails closed on DB or pool saturation', async () => {
  const response = () => ({
    statusCode: null,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  });
  const pool = { totalCount:10, idleCount:0, waitingCount:2, options:{ max:10 } };
  const handlers = createHealthHandlers(pool, { probe:async () => ({ ok:false }) });
  const live = response();
  handlers.liveness({}, live);
  assert.equal(live.statusCode, 200);
  assert.deepEqual(live.body, { status:'ok', process:'live' });
  const ready = response();
  await handlers.dependencies({}, ready);
  assert.equal(ready.statusCode, 503);
  assert.deepEqual(ready.body, { status:'error', database:'unavailable', pool:'saturated' });

  const contendedPool = { totalCount:10, idleCount:0, waitingCount:2, options:{ max:10 } };
  const singletonHandlers = createHealthHandlers(contendedPool, { probe:async () => ({ ok:true }) });
  const compatibility = response();
  await singletonHandlers.compatibility({}, compatibility);
  assert.equal(compatibility.statusCode, 200, 'recoverable contention must not evict a singleton target');
  assert.deepEqual(compatibility.body, { status:'ok', database:'ok', pool:'contended' });
});

test('worker errors are retained per source and clear only after that source recovers', () => {
  const delivery = new DeliveryWorker({ pool:{}, provider:{}, env:{ RESEND_PROVIDER_ACCOUNT_SCOPE:'test' } });
  delivery.recordError('heartbeat', new Error('heartbeat failed'));
  delivery.recordError('loop', new Error('query failed'));
  delivery.clearError('heartbeat');
  assert.match(delivery.lastError, /loop:query failed/);
  assert.doesNotMatch(delivery.lastError, /heartbeat/);

  const webhook = new WebhookWorker({ pool:{}, provider:null, env:{ RESEND_PROVIDER_ACCOUNT_SCOPE:'test' } });
  webhook.recordError('maintenance', new Error('purge failed'));
  webhook.recordError('canary', new Error('canary failed'));
  webhook.clearError('canary');
  assert.equal(webhook.lastError, 'maintenance:purge failed');
});

test('demo email retries reuse one provider idempotency key', () => {
  const token = 'signed-demo-token';
  assert.equal(demoEmailIdempotencyKey(token), demoEmailIdempotencyKey(token));
  assert.notEqual(demoEmailIdempotencyKey(token), demoEmailIdempotencyKey(`${token}-other`));
  assert.doesNotMatch(demoEmailIdempotencyKey(token), /signed-demo-token/);
});

test('runtime telemetry emits the process start synchronously when runtime starts', () => {
  const records = [];
  const originalLog = console.log;
  console.log = (line) => records.push(JSON.parse(line));
  try {
    const telemetry = startRuntimeTelemetry({
      pool:{ totalCount:0, idleCount:0, waitingCount:0, options:{ max:10 } },
      processName:'fast-crash-test',
      env:{ EMAIL_WORKER_ENV:'test' },
      intervalMs:60000,
    });
    telemetry.stop();
  } finally { console.log = originalLog; }
  assert.equal(records.length, 1);
  assert.equal(records[0].ProcessStartCount, 1);
  assert.equal(records[0].Process, 'fast-crash-test');
});

test('runtime telemetry reports bounded database dependency failure', async () => {
  const records = [];
  const originalLog = console.log;
  console.log = (line) => records.push(JSON.parse(line));
  try {
    const telemetry = startRuntimeTelemetry({
      pool:{ query:async () => { throw new Error('database unavailable'); }, totalCount:0, idleCount:0, waitingCount:0, options:{ max:10 } },
      processName:'dependency-test',
      env:{ EMAIL_WORKER_ENV:'test', HEALTH_DB_TIMEOUT_MS:'10' },
      intervalMs:5,
    });
    await new Promise((resolve) => setTimeout(resolve, 15));
    telemetry.stop();
  } finally { console.log = originalLog; }
  assert.ok(records.some((record) => record.DbDependencyHealthy === 0));
});

test('PM2 restart policy contains crash churn and scopes RSS tripwires to reviewed hosts', () => {
  const ecosystemPath = require.resolve('../../scripts/deploy/ecosystem.config');
  const previousEnvironment = process.env.EMAIL_WORKER_ENV;
  process.env.EMAIL_WORKER_ENV = 'prod-secondary';
  delete require.cache[ecosystemPath];
  const ecosystem = require(ecosystemPath);
  assert.deepEqual(ecosystem.apps.map((app) => app.name), [
    'ona-api', 'ona-email-worker', 'ona-email-webhook-worker',
  ]);
  for (const app of ecosystem.apps) {
    assert.equal(app.autorestart, true);
    assert.equal(app.min_uptime, '30s');
    assert.equal(app.max_restarts, 10);
    assert.equal(app.restart_delay, 1000);
    assert.equal(app.exp_backoff_restart_delay, 1000);
  }
  const totalMiB = ecosystem.apps.reduce((sum, app) => sum + Number.parseInt(app.max_memory_restart, 10), 0);
  assert.equal(totalMiB, 704);
  assert.equal(ecosystem.apps.find((app) => app.name === 'ona-api').kill_timeout, 30000);
  process.env.EMAIL_WORKER_ENV = 'staging';
  delete require.cache[ecosystemPath];
  assert.ok(require(ecosystemPath).apps.every((app) => app.max_memory_restart === undefined));
  if (previousEnvironment === undefined) delete process.env.EMAIL_WORKER_ENV;
  else process.env.EMAIL_WORKER_ENV = previousEnvironment;
  delete require.cache[ecosystemPath];
  const serverSource = fs.readFileSync(path.resolve(__dirname, '../server.js'), 'utf8');
  assert.match(serverSource, /setTimeout\(\(\) => process\.exit\(1\), 28000\)/);
});

test('prod-secondary replacement health is process-only and activation controls remain default-off', () => {
  const terraform = fs.readFileSync(path.resolve(__dirname, '../../terraform/modules/prod_secondary_platform/main.tf'), 'utf8');
  assert.match(terraform, /path\s+= "\/live"/);
  assert.match(terraform, /health_check_type\s+= "ELB"/);
  assert.match(terraform, /health_check_grace_period\s+= 1800/);
  assert.match(terraform, /instance_warmup\s+= 2700/);
  assert.match(terraform, /metric_name\s+= "DbDependencyHealthy"/);
  assert.match(terraform, /pattern\s+= "\?\\"Out of memory\\" \?\\"Killed process\\" \?\\"oom-kill\\""/);
  assert.match(terraform, /\?\\"EXT4-fs\\"/);
  assert.match(terraform, /\$\{var\.environment\}-KernelOomCount/);
  assert.match(terraform, /max_healthy_percentage\s+= 150/);
  const sharedBackendVariables = fs.readFileSync(path.resolve(__dirname, '../../terraform/modules/api_backend/variables.tf'), 'utf8');
  assert.match(sharedBackendVariables, /variable "health_check_path"[\s\S]*default\s+= "\/health"/);
  const sharedBackend = fs.readFileSync(path.resolve(__dirname, '../../terraform/modules/api_backend/main.tf'), 'utf8');
  assert.match(sharedBackend, /\?\\"oom-kill\\"/);
  assert.match(sharedBackend, /\?\\"EXT4-fs\\"/);
  assert.match(sharedBackend, /\$\{var\.environment\}-KernelOomCount/);
  const prodSecondaryVariables = fs.readFileSync(path.resolve(__dirname, '../../terraform/modules/prod_secondary_platform/variables.tf'), 'utf8');
  assert.match(prodSecondaryVariables, /condition\s+= var\.instance_type == "t3\.small"/);
  const applyWorkflow = fs.readFileSync(path.resolve(__dirname, '../../.github/workflows/terraform-apply.yml'), 'utf8');
  assert.match(applyWorkflow, /terraform state show -no-color/);
  assert.match(applyWorkflow, /module\.platform\.aws_autoscaling_group\.app/);
  assert.match(applyWorkflow, /module\.platform\.aws_lb_target_group\.api/);
  assert.match(applyWorkflow, /aws elbv2 describe-target-groups/);
  assert.ok(applyWorkflow.indexOf('Inspect Terraform-managed prod-secondary health path') < applyWorkflow.indexOf('Configure prod-secondary deploy preflight credentials'));
  assert.match(applyWorkflow, /steps\.live-migration\.outputs\.migration_required == 'true'/);
  assert.doesNotMatch(applyWorkflow, /API_ASG_NAME/);
  assert.match(applyWorkflow, /verify-prod-secondary-live-targets\.sh '\$\{\{ steps\.live-migration\.outputs\.asg_name \}\}' '\$\{\{ steps\.live-migration\.outputs\.target_group_arn \}\}'/);
  assert.match(applyWorkflow, /Inspect post-apply \/live floor[\s\S]+always\(\)/);
  assert.match(applyWorkflow, /alb-live-health-required/);
  const preflight = fs.readFileSync(path.resolve(__dirname, '../../scripts/deploy/verify-prod-secondary-live-targets.sh'), 'utf8');
  assert.doesNotMatch(preflight, /describe-target-groups/, 'narrow deploy role must not inspect target-group configuration');
  assert.match(preflight, /ATTACHED_TARGET_GROUPS\[0\].*= "\$TARGET_GROUP_ARN"/);
  assert.match(preflight, /REGISTERED_TARGETS/);
  assert.match(preflight, /http:\/\/localhost:3000\/live/);
  for (const gate of ['EMAIL_CLAIMING_ENABLED=false', 'EMAIL_SENDING_ENABLED=false', 'WEBHOOK_PROCESSING_ENABLED=false']) {
    assert.match(terraform, new RegExp(gate));
  }
});

test('direct hung query probe returns without waiting forever', async () => {
  const started = Date.now();
  const result = await probeDatabase({ query: () => new Promise(() => {}) }, 20);
  assert.equal(result.ok, false);
  assert.ok(Date.now() - started < 500);
});
