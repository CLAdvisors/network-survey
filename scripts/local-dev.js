const fs = require('fs');
const path = require('path');
const net = require('net');
const http = require('http');
const https = require('https');
const { spawn } = require('child_process');
const treeKill = require('tree-kill');

const repoRoot = path.resolve(__dirname, '..');
const stateFilePath = path.join(repoRoot, '.local-dev.state.json');
const stoppingFilePath = path.join(repoRoot, '.local-dev.stopping');
const npmCommand = process.platform === 'win32' ? 'npm' : 'npm';

let shuttingDown = false;
let runtimeState = {
  runnerPid: process.pid,
  startedAt: new Date().toISOString(),
  services: [],
};

function parseEnvFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const env = {};

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();

    if (!line || line.startsWith('#')) {
      continue;
    }

    const separatorIndex = line.indexOf('=');
    if (separatorIndex === -1) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    let value = line.slice(separatorIndex + 1).trim();

    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }

    env[key] = value;
  }

  return env;
}

function readRequiredEnv(relativePath, requiredKeys) {
  const fullPath = path.join(repoRoot, relativePath);
  if (!fs.existsSync(fullPath)) {
    throw new Error(`Missing env file: ${relativePath}. Create it from ${relativePath}.example.`);
  }

  const env = parseEnvFile(fullPath);
  const missingKeys = requiredKeys.filter((key) => !env[key]);
  if (missingKeys.length > 0) {
    throw new Error(`Missing required keys in ${relativePath}: ${missingKeys.join(', ')}`);
  }

  return env;
}

function parseUrl(name, value) {
  try {
    const parsedUrl = new URL(value);
    if (!parsedUrl.port) {
      throw new Error('missing port');
    }

    return parsedUrl;
  } catch (error) {
    throw new Error(`Invalid ${name}: ${value}`);
  }
}

function validateConfig() {
  const apiEnv = readRequiredEnv('api/.env.local', [
    'DB_USER',
    'DB_PASSWORD',
    'DB_HOST',
    'DB_PORT',
    'FRONTEND_URL',
    'SURVEY_URL',
    'SESSION_SECRET',
  ]);
  const dashboardEnv = readRequiredEnv('dashboard/.env.development', [
    'REACT_APP_API_HOST',
    'REACT_APP_API_PORT',
    'REACT_APP_API_PROTOCOL',
  ]);
  const surveyEnv = readRequiredEnv('network-survey/.env.development', [
    'REACT_APP_API_HOST',
    'REACT_APP_API_PORT',
    'REACT_APP_API_PROTOCOL',
  ]);

  const dashboardUrl = parseUrl('FRONTEND_URL', apiEnv.FRONTEND_URL);
  const surveyUrl = parseUrl('SURVEY_URL', apiEnv.SURVEY_URL);

  const dashboardApiOrigin = `${dashboardEnv.REACT_APP_API_PROTOCOL}://${dashboardEnv.REACT_APP_API_HOST}:${dashboardEnv.REACT_APP_API_PORT}`;
  const surveyApiOrigin = `${surveyEnv.REACT_APP_API_PROTOCOL}://${surveyEnv.REACT_APP_API_HOST}:${surveyEnv.REACT_APP_API_PORT}`;

  if (dashboardApiOrigin !== surveyApiOrigin) {
    throw new Error(`Dashboard and survey API config do not match: ${dashboardApiOrigin} vs ${surveyApiOrigin}`);
  }

  if (!Number.isInteger(Number(apiEnv.DB_PORT))) {
    throw new Error(`DB_PORT must be numeric in api/.env.local. Received: ${apiEnv.DB_PORT}`);
  }

  if (dashboardUrl.hostname !== 'localhost' && dashboardUrl.hostname !== '127.0.0.1') {
    throw new Error(`FRONTEND_URL must target a local host for local dev. Received: ${apiEnv.FRONTEND_URL}`);
  }

  if (surveyUrl.hostname !== 'localhost' && surveyUrl.hostname !== '127.0.0.1') {
    throw new Error(`SURVEY_URL must target a local host for local dev. Received: ${apiEnv.SURVEY_URL}`);
  }

  return {
    apiEnv,
    apiPort: dashboardEnv.REACT_APP_API_PORT,
    apiOrigin: dashboardApiOrigin,
    apiHealthUrl: `${dashboardApiOrigin}/health`,
    dashboardUrl,
    surveyUrl,
  };
}

function readState() {
  if (!fs.existsSync(stateFilePath)) {
    return null;
  }

  try {
    return JSON.parse(fs.readFileSync(stateFilePath, 'utf8'));
  } catch (error) {
    return null;
  }
}

function writeState() {
  fs.writeFileSync(stateFilePath, JSON.stringify(runtimeState, null, 2));
}

function removeStateFile() {
  if (fs.existsSync(stateFilePath)) {
    fs.unlinkSync(stateFilePath);
  }
}

function isStopRequested() {
  return fs.existsSync(stoppingFilePath);
}

function clearStopRequested() {
  if (fs.existsSync(stoppingFilePath)) {
    fs.unlinkSync(stoppingFilePath);
  }
}

function isProcessRunning(pid) {
  if (!pid) {
    return false;
  }

  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return false;
  }
}

function killProcessTree(pid) {
  return new Promise((resolve) => {
    if (!pid || !isProcessRunning(pid)) {
      resolve();
      return;
    }

    treeKill(pid, 'SIGTERM', () => resolve());
  });
}

function attachPrefixedOutput(serviceName, stream, write) {
  let buffered = '';

  stream.on('data', (chunk) => {
    buffered += chunk.toString();
    const lines = buffered.split(/\r?\n/);
    buffered = lines.pop() || '';

    for (const line of lines) {
      if (line) {
        write(`[${serviceName}] ${line}\n`);
      }
    }
  });

  stream.on('end', () => {
    if (buffered) {
      write(`[${serviceName}] ${buffered}\n`);
    }
  });
}

function buildChildEnv(overrides) {
  const childEnv = {};

  for (const [key, value] of Object.entries(process.env)) {
    // Windows may expose drive-tracking vars like "=C:" that break spawn when re-passed.
    if (!key || key.startsWith('=') || value === undefined || value === null) {
      continue;
    }

    childEnv[key] = value;
  }

  return {
    ...childEnv,
    ...overrides,
    FORCE_COLOR: '1',
  };
}

function startService({ name, cwd, env }) {
  let child;

  try {
    child = spawn(`${npmCommand} run dev`, {
      cwd,
      env: buildChildEnv(env),
      shell: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (error) {
    throw new Error(`Failed to start ${name}: ${error.message}`);
  }

  runtimeState.services.push({ name, pid: child.pid, cwd });
  writeState();

  attachPrefixedOutput(name, child.stdout, (line) => process.stdout.write(line));
  attachPrefixedOutput(name, child.stderr, (line) => process.stderr.write(line));

  child.on('exit', (code, signal) => {
    if (shuttingDown) {
      return;
    }

    if (isStopRequested()) {
      shutdown(0).catch((error) => {
        console.error(error.message);
        process.exit(1);
      });
      return;
    }

    const exitLabel = signal ? `signal ${signal}` : `code ${code}`;
    console.error(`[${name}] exited unexpectedly with ${exitLabel}`);
    shutdown(1).catch((error) => {
      console.error(error.message);
      process.exit(1);
    });
  });

  return child;
}

function waitForTcpConnection(host, port, timeoutMs) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host, port: Number(port) });
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error(`Timed out connecting to ${host}:${port}`));
    }, timeoutMs);

    socket.on('connect', () => {
      clearTimeout(timer);
      socket.end();
      resolve();
    });

    socket.on('error', (error) => {
      clearTimeout(timer);
      socket.destroy();
      reject(error);
    });
  });
}

function requestUrl(targetUrl) {
  const url = new URL(targetUrl);
  const client = url.protocol === 'https:' ? https : http;

  return new Promise((resolve, reject) => {
    const request = client.request(url, { method: 'GET' }, (response) => {
      response.resume();
      response.on('end', () => resolve(response.statusCode || 0));
    });

    request.on('error', reject);
    request.setTimeout(3000, () => {
      request.destroy(new Error(`Timed out requesting ${targetUrl}`));
    });
    request.end();
  });
}

async function waitForHttpOk(targetUrl, timeoutMs) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    try {
      const statusCode = await requestUrl(targetUrl);
      if (statusCode >= 200 && statusCode < 400) {
        return;
      }
    } catch (error) {
      // Keep polling until timeout.
    }

    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  throw new Error(`Timed out waiting for ${targetUrl}`);
}

async function shutdown(exitCode) {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;

  const servicePids = runtimeState.services
    .map((service) => service.pid)
    .filter(Boolean)
    .reverse();

  for (const pid of servicePids) {
    await killProcessTree(pid);
  }

  removeStateFile();
  clearStopRequested();
  process.exit(exitCode);
}

async function main() {
  const existingState = readState();
  if (existingState) {
    const activePids = [existingState.runnerPid, ...(existingState.services || []).map((service) => service.pid)]
      .filter(Boolean)
      .filter(isProcessRunning);

    if (activePids.length > 0) {
      throw new Error('Local dev runner is already active. Run "npm run dev:stop" before starting again.');
    }

    removeStateFile();
  }

  clearStopRequested();

  const config = validateConfig();

  console.log('Validating local database connectivity...');
  await waitForTcpConnection(config.apiEnv.DB_HOST, config.apiEnv.DB_PORT, 5000).catch((error) => {
    throw new Error(`Postgres is not reachable at ${config.apiEnv.DB_HOST}:${config.apiEnv.DB_PORT}. ${error.message}`);
  });

  runtimeState = {
    runnerPid: process.pid,
    startedAt: new Date().toISOString(),
    services: [],
    apiHealthUrl: config.apiHealthUrl,
  };
  writeState();

  process.on('SIGINT', () => {
    shutdown(0).catch((error) => {
      console.error(error.message);
      process.exit(1);
    });
  });

  process.on('SIGTERM', () => {
    shutdown(0).catch((error) => {
      console.error(error.message);
      process.exit(1);
    });
  });

  process.on('uncaughtException', (error) => {
    console.error(error);
    shutdown(1).catch(() => process.exit(1));
  });

  process.on('unhandledRejection', (error) => {
    console.error(error);
    shutdown(1).catch(() => process.exit(1));
  });

  console.log('Starting API...');
  startService({
    name: 'api',
    cwd: path.join(repoRoot, 'api'),
    env: {
      PORT: String(config.apiPort),
    },
  });

  await waitForHttpOk(config.apiHealthUrl, 30000);

  console.log('Starting dashboard and survey app...');
  startService({
    name: 'dashboard',
    cwd: path.join(repoRoot, 'dashboard'),
    env: {
      PORT: config.dashboardUrl.port,
      BROWSER: 'none',
    },
  });

  startService({
    name: 'survey',
    cwd: path.join(repoRoot, 'network-survey'),
    env: {
      PORT: config.surveyUrl.port,
      BROWSER: 'none',
    },
  });

  await waitForHttpOk(config.apiOrigin.replace(/\/$/, ''), 15000);
  await waitForHttpOk(config.apiEnv.FRONTEND_URL, 180000);
  await waitForHttpOk(config.apiEnv.SURVEY_URL, 180000);

  console.log('Local development environment is ready.');
  console.log(`API: ${config.apiOrigin}`);
  console.log(`Dashboard: ${config.apiEnv.FRONTEND_URL}`);
  console.log(`Survey: ${config.apiEnv.SURVEY_URL}`);
  console.log('Run "npm run dev:stop" from another terminal, or press Ctrl+C here, to stop all services.');
}

main().catch((error) => {
  console.error(error.message);
  shutdown(1).catch(() => process.exit(1));
});