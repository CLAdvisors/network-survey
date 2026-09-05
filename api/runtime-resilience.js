'use strict';

const fs = require('fs');
const { monitorEventLoopDelay } = require('perf_hooks');
const { Pool } = require('pg');
const { emitMetrics } = require('./email-metrics');

function boundedInteger(value, fallback, minimum, maximum) {
  if (value === undefined || value === null || String(value).trim() === '') return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(maximum, Math.max(minimum, Math.floor(parsed))) : fallback;
}

function poolConfigFromEnv(env = process.env) {
  const queryTimeout = boundedInteger(env.DB_QUERY_TIMEOUT_MS, 10000, 250, 120000);
  const statementTimeout = Math.min(
    boundedInteger(env.DB_STATEMENT_TIMEOUT_MS, 9000, 250, 120000),
    queryTimeout
  );
  return {
    user: env.DB_USER,
    password: env.DB_PASSWORD,
    host: env.DB_HOST,
    port: env.DB_PORT,
    database: env.DB_NAME || 'ONA',
    ssl: env.DB_SSL === 'true' ? {
      ca: env.DB_SSL_CA ? fs.readFileSync(env.DB_SSL_CA, 'utf8') : undefined,
      rejectUnauthorized: Boolean(env.DB_SSL_CA),
    } : undefined,
    max: boundedInteger(env.DB_POOL_MAX, 10, 1, 50),
    idleTimeoutMillis: boundedInteger(env.DB_POOL_IDLE_TIMEOUT_MS, 30000, 1000, 300000),
    maxLifetimeSeconds: boundedInteger(env.DB_POOL_MAX_LIFETIME_SECONDS, 1800, 60, 86400),
    connectionTimeoutMillis: boundedInteger(env.DB_POOL_ACQUIRE_TIMEOUT_MS, 3000, 100, 30000),
    query_timeout: queryTimeout,
    statement_timeout: statementTimeout,
    idle_in_transaction_session_timeout: boundedInteger(env.DB_IDLE_TRANSACTION_TIMEOUT_MS, 15000, 1000, 300000),
    keepAlive: true,
    keepAliveInitialDelayMillis: boundedInteger(env.DB_SOCKET_KEEPALIVE_DELAY_MS, 5000, 1000, 60000),
    allowExitOnIdle: false,
    application_name: String(env.DB_APPLICATION_NAME || `network-survey-${env.EMAIL_WORKER_ENV || env.NODE_ENV || 'local'}`).slice(0, 63),
  };
}

function poisonsDatabaseClient(error) {
  const code = String(error?.code || '').toUpperCase();
  return ['ECONNRESET', 'ECONNREFUSED', 'EPIPE', 'ETIMEDOUT', 'ENETUNREACH', 'EHOSTUNREACH'].includes(code)
    || /^08/.test(code)
    || /query read timeout|connection terminated|connection ended unexpectedly|socket hang up/i.test(String(error?.message || ''));
}

function guardCheckedOutClient(client) {
  if (!client || client.__runtimeResilienceGuarded) return client;
  const originalQuery = client.query;
  const originalRelease = client.release;
  let poison = null;
  Object.defineProperty(client, '__runtimeResilienceGuarded', { value:true, configurable:true });
  client.query = (...args) => {
    const callbackIndex = typeof args[args.length - 1] === 'function' ? args.length - 1 : -1;
    if (callbackIndex >= 0) {
      const callback = args[callbackIndex];
      args[callbackIndex] = (error, ...values) => {
        if (poisonsDatabaseClient(error)) poison = poison || error;
        callback(error, ...values);
      };
      return originalQuery.apply(client, args);
    }
    const result = originalQuery.apply(client, args);
    if (!result || typeof result.catch !== 'function') return result;
    return result.catch((error) => {
      if (poisonsDatabaseClient(error)) poison = poison || error;
      throw error;
    });
  };
  client.release = (error) => {
    client.query = originalQuery;
    client.release = originalRelease;
    delete client.__runtimeResilienceGuarded;
    return originalRelease.call(client, error || poison || undefined);
  };
  return client;
}

function createPool(env = process.env) {
  const pool = new Pool(poolConfigFromEnv(env));
  const originalConnect = pool.connect.bind(pool);
  pool.connect = (callback) => {
    if (typeof callback === 'function') {
      return originalConnect((error, client) => {
        const guarded = guardCheckedOutClient(client);
        callback(error, guarded, guarded?.release);
      });
    }
    return originalConnect().then(guardCheckedOutClient);
  };
  pool.on('error', (error) => {
    console.error('Idle PostgreSQL client error:', String(error?.message || error).slice(0, 300));
  });
  return pool;
}

function isTransientDatabaseError(error) {
  const code = String(error?.code || '').toUpperCase();
  if (/^(08|53)/.test(code) || ['40001', '40P01', '57014', '57P01', '57P02', '57P03'].includes(code)) return true;
  if (['ECONNRESET', 'ECONNREFUSED', 'EPIPE', 'ETIMEDOUT', 'ENETUNREACH', 'EHOSTUNREACH', 'RUNTIME_TIMEOUT'].includes(code)) return true;
  return /query read timeout|connection terminated|connection timeout|timeout exceeded when trying to connect|remaining connection slots/i.test(String(error?.message || ''));
}

function poolSnapshot(pool) {
  const total = Number(pool?.totalCount || 0);
  const idle = Number(pool?.idleCount || 0);
  return {
    total,
    active: Math.max(0, total - idle),
    idle,
    waiting: Number(pool?.waitingCount || 0),
    max: Number(pool?.options?.max || 0),
  };
}

function withDeadline(promise, timeoutMs, message = 'Operation timed out') {
  let timer;
  return Promise.race([
    Promise.resolve(promise),
    new Promise((_, reject) => {
      timer = setTimeout(() => {
        const error = new Error(message);
        error.code = 'runtime_timeout';
        reject(error);
      }, timeoutMs);
    }),
  ]).finally(() => clearTimeout(timer));
}

async function probeDatabase(pool, timeoutMs = 2500) {
  try {
    await withDeadline(pool.query({ text: 'SELECT 1', query_timeout: timeoutMs }), timeoutMs + 100, 'Database health probe timed out');
    return { ok: true };
  } catch (error) {
    return { ok: false, code: error?.code || 'database_unavailable' };
  }
}

function createDependencyProbe(pool, { timeoutMs = 2500, cacheMs = 1000, clock = Date.now } = {}) {
  let inFlight = null;
  let cached = null;
  return async () => {
    const now = clock();
    if (cached && now - cached.at < cacheMs) return cached.result;
    if (inFlight) return inFlight;
    inFlight = probeDatabase(pool, timeoutMs)
      .then((result) => { cached = { at:clock(), result }; return result; })
      .finally(() => { inFlight = null; });
    return inFlight;
  };
}

function createHealthHandlers(pool, { probe = createDependencyProbe(pool) } = {}) {
  const dependencyStatus = async (res, { requirePoolCapacity }) => {
    const database = await probe();
    const snapshot = poolSnapshot(pool);
    const poolContended = snapshot.max > 0 && snapshot.waiting > 0;
    const poolAvailable = !requirePoolCapacity || !poolContended;
    const ready = database.ok && poolAvailable;
    res.status(ready ? 200 : 503).json({
      status: ready ? 'ok' : 'error',
      database: database.ok ? 'ok' : 'unavailable',
      pool: poolContended ? (requirePoolCapacity ? 'saturated' : 'contended') : 'ok',
    });
  };
  return {
    liveness(req, res) {
      res.status(200).json({ status:'ok', process:'live' });
    },
    dependencies(req, res) {
      return dependencyStatus(res, { requirePoolCapacity:true });
    },
    compatibility(req, res) {
      // Singleton ALBs retain /health. Recoverable pool contention must not
      // evict their only target; /ready remains the strict capacity signal.
      return dependencyStatus(res, { requirePoolCapacity:false });
    },
  };
}

/** Recursive scheduling: the next run is armed only after the prior run settles. */
function createNonOverlappingScheduler(task, {
  intervalMs,
  initialDelayMs = intervalMs,
  onError = () => {},
  setTimer = setTimeout,
  clearTimer = clearTimeout,
} = {}) {
  let stopped = false;
  let timer = null;
  let running = false;
  let current = null;

  const arm = (delay) => {
    if (stopped) return;
    timer = setTimer(() => {
      if (stopped || running) return current;
      running = true;
      current = (async () => {
        try { await task(); } catch (error) { onError(error); }
        finally {
          running = false;
          arm(intervalMs);
        }
      })();
      return current;
    }, delay);
    timer?.unref?.();
  };

  arm(initialDelayMs);
  return {
    stop() {
      stopped = true;
      if (timer) clearTimer(timer);
      return current || Promise.resolve();
    },
    get running() { return running; },
  };
}

function startRuntimeTelemetry({ pool, processName, env = process.env, intervalMs = 60000 } = {}) {
  const environment = env.EMAIL_WORKER_ENV || env.APP_ENV || env.NODE_ENV || 'local';
  const release = env.RELEASE_REVISION || env.REVISION || 'local';
  const histogram = monitorEventLoopDelay({ resolution: 20 });
  histogram.enable();
  let first = true;
  const emit = (dependencyHealthy) => {
    const memory = process.memoryUsage();
    const snapshot = poolSnapshot(pool);
    const lagMs = Number.isFinite(histogram.max) ? Math.round(histogram.max / 1e6) : 0;
    histogram.reset();
    emitMetrics({
      namespace: env.RUNTIME_METRIC_NAMESPACE || 'NetworkSurvey/Runtime',
      environment,
      release,
      dimensions: { Process: processName },
      metrics: {
        ProcessHeartbeat: 1,
        ProcessStartCount: first ? 1 : 0,
        ProcessRssBytes: memory.rss,
        ProcessHeapUsedBytes: memory.heapUsed,
        EventLoopLagMilliseconds: lagMs,
        DbPoolActive: snapshot.active,
        DbPoolIdle: snapshot.idle,
        DbPoolWaiting: snapshot.waiting,
        ...(dependencyHealthy === undefined ? {} : { DbDependencyHealthy: dependencyHealthy ? 1 : 0 }),
      },
    });
    first = false;
  };
  // Emit before entering the worker loop/listener. Failures that happen earlier
  // in configuration/bootstrap remain covered by PM2 logs and heartbeat loss.
  emit();
  const scheduler = createNonOverlappingScheduler(async () => {
    const dependency = await probeDatabase(pool, boundedInteger(env.HEALTH_DB_TIMEOUT_MS, 2000, 250, 30000));
    emit(dependency.ok);
  }, {
    intervalMs,
    initialDelayMs: intervalMs,
    onError: (error) => console.error('Runtime telemetry failed:', error.message),
  });
  return {
    stop() { scheduler.stop(); histogram.disable(); },
  };
}

module.exports = {
  boundedInteger,
  createDependencyProbe,
  createHealthHandlers,
  createNonOverlappingScheduler,
  createPool,
  guardCheckedOutClient,
  isTransientDatabaseError,
  poisonsDatabaseClient,
  poolConfigFromEnv,
  poolSnapshot,
  probeDatabase,
  startRuntimeTelemetry,
  withDeadline,
};
