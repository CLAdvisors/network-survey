const fs = require('fs');
const path = require('path');
const os = require('os');
const https = require('https');
const { spawn } = require('child_process');
const { Client } = require('pg');

const repoRoot = path.resolve(__dirname, '..');
const apiEnvPath = path.join(repoRoot, 'api', '.env.local');
const dbDirectory = path.join(repoRoot, 'db');
const generatedLiquibaseProperties = path.join(dbDirectory, '.liquibase.local.generated.properties');
const jdbcDirectory = path.join(dbDirectory, 'lib');
const postgresJdbcVersion = '42.7.5';
const postgresJdbcJar = `postgresql-${postgresJdbcVersion}.jar`;
const postgresJdbcPath = path.join(jdbcDirectory, postgresJdbcJar);
const postgresJdbcUrl = `https://repo1.maven.org/maven2/org/postgresql/postgresql/${postgresJdbcVersion}/${postgresJdbcJar}`;
const defaultLocalAdminUsername = 'admin';
const defaultLocalAdminPassword = 'admin123';
const localDbHosts = new Set(['localhost', '127.0.0.1', '::1']);

function parseEnvFile(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Missing ${path.relative(repoRoot, filePath)}. Create it before running DB setup.`);
  }

  const env = {};
  const content = fs.readFileSync(filePath, 'utf8');
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) {
      continue;
    }

    const separatorIndex = line.indexOf('=');
    if (separatorIndex < 0) {
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

function buildConfig() {
  const env = parseEnvFile(apiEnvPath);

  const requiredKeys = ['DB_USER', 'DB_PASSWORD', 'DB_HOST', 'DB_PORT'];
  const missing = requiredKeys.filter((key) => !env[key]);
  if (missing.length > 0) {
    throw new Error(`Missing required keys in api/.env.local: ${missing.join(', ')}`);
  }

  const port = Number(env.DB_PORT);
  if (!Number.isInteger(port)) {
    throw new Error(`DB_PORT must be numeric in api/.env.local. Received: ${env.DB_PORT}`);
  }

  return {
    host: env.DB_HOST,
    port,
    user: env.DB_USER,
    password: env.DB_PASSWORD,
    databaseName: 'ONA',
    nodeEnv: (env.NODE_ENV || '').trim(),
    allowNonLocalDbSetup: String(env.ALLOW_NON_LOCAL_DB_SETUP || '').trim().toLowerCase() === 'true',
    localAdminUsername: env.LOCAL_ADMIN_USERNAME || defaultLocalAdminUsername,
    localAdminPassword: env.LOCAL_ADMIN_PASSWORD || defaultLocalAdminPassword,
  };
}

function assertLocalOnly(config) {
  const allowFromFlag = process.argv.includes('--allow-nonlocal');
  if (allowFromFlag || config.allowNonLocalDbSetup) {
    return;
  }

  const normalizedHost = String(config.host || '').trim().toLowerCase();
  const normalizedNodeEnv = String(config.nodeEnv || '').trim().toLowerCase();

  const hostLooksLocal = localDbHosts.has(normalizedHost);
  const envLooksLocal = !normalizedNodeEnv || normalizedNodeEnv === 'development' || normalizedNodeEnv === 'local';

  if (hostLooksLocal && envLooksLocal) {
    return;
  }

  throw new Error(
    [
      'Refusing to run scripts/db-setup.js against a non-local environment.',
      `Resolved DB host: ${config.host}`,
      `Resolved NODE_ENV: ${config.nodeEnv || '(empty)'}`,
      'Use Terraform-generated Liquibase scripts for production/staging migrations.',
      'If this is intentional for a one-off case, re-run with --allow-nonlocal or set ALLOW_NON_LOCAL_DB_SETUP=true in api/.env.local.',
    ].join(' ')
  );
}

function getBcrypt() {
  try {
    return require('bcrypt');
  } catch (_) {
    const apiBcryptPath = path.join(repoRoot, 'api', 'node_modules', 'bcrypt');
    try {
      return require(apiBcryptPath);
    } catch (error) {
      throw new Error(
        'Could not load bcrypt. Install API dependencies with "npm --prefix api install", then re-run npm run db:setup.'
      );
    }
  }
}

function runCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: 'inherit',
      shell: process.platform === 'win32',
      ...options,
    });

    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`${command} exited with code ${code}`));
    });
  });
}

async function ensureLiquibaseInstalled() {
  try {
    await runCommand('liquibase', ['--version'], { stdio: 'ignore' });
  } catch (error) {
    throw new Error(
      'Liquibase CLI is not available on PATH. Install Liquibase, then re-run npm run db:setup.'
    );
  }
}

function downloadFile(url, destination) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, (response) => {
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        downloadFile(response.headers.location, destination).then(resolve).catch(reject);
        return;
      }

      if (response.statusCode !== 200) {
        reject(new Error(`Failed to download ${url}. HTTP status ${response.statusCode}`));
        return;
      }

      const writeStream = fs.createWriteStream(destination);
      response.pipe(writeStream);
      writeStream.on('finish', () => {
        writeStream.close();
        resolve();
      });
      writeStream.on('error', reject);
    });

    request.on('error', reject);
  });
}

async function ensurePostgresJdbcDriver() {
  fs.mkdirSync(jdbcDirectory, { recursive: true });

  if (fs.existsSync(postgresJdbcPath)) {
    return;
  }

  console.log(`PostgreSQL JDBC driver not found. Downloading ${postgresJdbcJar}...`);
  await downloadFile(postgresJdbcUrl, postgresJdbcPath);
  console.log(`Downloaded PostgreSQL JDBC driver to ${path.relative(repoRoot, postgresJdbcPath)}.`);
}

async function ensureDatabaseExists(config) {
  const adminClient = new Client({
    host: config.host,
    port: config.port,
    user: config.user,
    password: config.password,
    database: 'postgres',
  });

  await adminClient.connect();
  try {
    const existsResult = await adminClient.query('SELECT 1 FROM pg_database WHERE datname = $1', [config.databaseName]);

    if (existsResult.rowCount === 0) {
      await adminClient.query(`CREATE DATABASE "${config.databaseName}"`);
      console.log(`Created database ${config.databaseName}.`);
    } else {
      console.log(`Database ${config.databaseName} already exists.`);
    }
  } finally {
    await adminClient.end();
  }
}

function writeGeneratedLiquibaseProperties(config) {
  const lines = [
    '# Generated by scripts/db-setup.js',
    `url=jdbc:postgresql://${config.host}:${config.port}/${config.databaseName}`,
    `username=${config.user}`,
    `password=${config.password}`,
    'changeLogFile=changelogs/master-changelog.xml',
    'logLevel=info',
    '',
  ];

  fs.writeFileSync(generatedLiquibaseProperties, lines.join(os.EOL), 'utf8');
}

async function runLiquibaseUpdate() {
  await runCommand('liquibase', [
    '--defaultsFile=.liquibase.local.generated.properties',
    `--classpath=${postgresJdbcPath}`,
    'update',
  ], {
    cwd: dbDirectory,
  });
}

async function ensureLocalAdminUser(config) {
  const username = String(config.localAdminUsername || '').trim();
  const password = String(config.localAdminPassword || '').trim();

  if (!username || !password) {
    throw new Error('LOCAL_ADMIN_USERNAME and LOCAL_ADMIN_PASSWORD must both be non-empty when provided.');
  }

  if (password.length < 6) {
    throw new Error('LOCAL_ADMIN_PASSWORD must be at least 6 characters.');
  }

  const bcrypt = getBcrypt();
  const passwordHash = await bcrypt.hash(password, 10);

  const client = new Client({
    host: config.host,
    port: config.port,
    user: config.user,
    password: config.password,
    database: config.databaseName,
  });

  await client.connect();
  try {
    await client.query(
      `INSERT INTO users (username, password)
       VALUES ($1, $2)
       ON CONFLICT (username)
       DO UPDATE SET password = EXCLUDED.password`,
      [username, passwordHash]
    );
  } finally {
    await client.end();
  }

  console.log(`Local admin account ensured (username: ${username}).`);
}

async function main() {
  const migrateOnly = process.argv.includes('--migrate-only');
  const config = buildConfig();

  assertLocalOnly(config);

  console.log('Checking Liquibase CLI availability...');
  await ensureLiquibaseInstalled();

  if (!migrateOnly) {
    console.log('Ensuring local database exists...');
    await ensureDatabaseExists(config);
  }

  await ensurePostgresJdbcDriver();
  writeGeneratedLiquibaseProperties(config);

  console.log('Applying Liquibase changelog...');
  await runLiquibaseUpdate();

  if (!migrateOnly) {
    console.log('Ensuring local admin account...');
    await ensureLocalAdminUser(config);
  }

  console.log('Database setup complete.');
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});