const express = require('express');
const fs = require('fs');
const path = require('path');
const cors = require('cors');
const { nanoid } = require('nanoid');
const { Pool } = require('pg');
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);
const Papa = require('papaparse');
const dotenvFlow = require('dotenv-flow');
const bcrypt = require('bcrypt');
const rateLimit = require('express-rate-limit');
const crypto = require('crypto');
const { Model, Serializer, Question } = require('survey-core');

dotenvFlow.config();

const { ResendProvider, reserveProviderRateOnClient } = require('./email');
const lifecycle = require('./lifecycle');
const respondentRoster = require('./respondent-roster');
const { effectiveInstructions } = require('./survey-instructions');
const { createResendWebhookHandler } = require('./webhooks');
const { displayedRespondentPredicate, displayedRespondentCountExpression, isLegacyPlaceholderRespondent } = require('./respondent-utils');
const resendApiKey = process.env.RESEND_KEY || process.env.RESEND_API_KEY;

// Keep server-side validation in step with the respondent's custom SurveyJS type.
if (!Serializer.findClass('draggableranking')) {
  class QuestionDraggableRankingModel extends Question {
    getType() { return 'draggableranking'; }
  }
  Serializer.addClass('draggableranking', [], () => new QuestionDraggableRankingModel(''), 'question');
}
lifecycle.setSurveyDefinitionValidator(validateSurveyDefinition);

const pool = new Pool({
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  database: process.env.DB_NAME || 'ONA',
  ssl: process.env.DB_SSL === 'true'
    ? { ca: process.env.DB_SSL_CA ? fs.readFileSync(process.env.DB_SSL_CA, 'utf8') : undefined,
        rejectUnauthorized: Boolean(process.env.DB_SSL_CA) }
    : undefined,
});
const directSurveyProvider = resendApiKey ? new ResendProvider({ apiKey: resendApiKey }) : null;

async function reserveSynchronousEmailRate(client) {
  const environment = process.env.EMAIL_RATE_BUDGET_ENV || lifecycle.environmentName(process.env);
  const rate = Math.max(1, Number(process.env.EMAIL_RATE_PER_SECOND || 5));
  if (await reserveProviderRateOnClient(client, environment, rate)) return;
  const error = new Error('Email provider rate budget is busy; retry shortly.');
  error.statusCode = 503;
  throw error;
}

async function invokeSynchronousProvider(toAddress, factory) {
  const environment = lifecycle.environmentName(process.env);
  const hosted = lifecycle.isHostedEnvironment(environment);
  const scope = process.env.RESEND_PROVIDER_ACCOUNT_SCOPE || (hosted ? '' : 'local-resend-account');
  if (!scope) { const error=new Error('Provider account suppression scope is not configured.'); error.statusCode=503; throw error; }
  const normalizedAddress = String(toAddress || '').trim().toLowerCase();
  const globalKey = `email-provider-boundary:${environment}`;
  const addressKey = `email-suppression-boundary:${scope}:${normalizedAddress}`;
  const client = await pool.connect();
  let globalLocked = false, addressLocked = false;
  try {
    await client.query('SELECT pg_advisory_lock(hashtextextended($1,0))', [globalKey]);
    globalLocked = true;
    await client.query('SELECT pg_advisory_lock(hashtextextended($1,0))', [addressKey]);
    addressLocked = true;
    const control = await client.query('SELECT sending_enabled,minimum_release FROM email_sending_control WHERE environment=$1', [environment]);
    const row = control.rows[0];
    const release = process.env.RELEASE_REVISION || process.env.REVISION || 'local';
    if (!row?.sending_enabled || (row.minimum_release && row.minimum_release !== release)) {
      const error = new Error('Application email sending is disabled.');
      error.statusCode = 503;
      throw error;
    }
    const enforcement = await client.query('SELECT enforcement_enabled FROM email_suppression_control WHERE environment=$1', [environment]);
    if (enforcement.rows[0]?.enforcement_enabled) {
      const suppressed = await client.query(`SELECT 1 FROM email_suppressions WHERE provider_account_scope=$1 AND normalized_address=$2 AND (provider_active OR locally_overridden_at IS NULL) LIMIT 1`, [scope, normalizedAddress]);
      if (suppressed.rowCount) {
        const error = new Error('Recipient is suppressed.');
        error.statusCode = 409;
        throw error;
      }
    }
    await reserveSynchronousEmailRate(client);
    return await factory();
  } finally {
    if (addressLocked) await client.query('SELECT pg_advisory_unlock(hashtextextended($1,0))', [addressKey]).catch(() => {});
    if (globalLocked) await client.query('SELECT pg_advisory_unlock(hashtextextended($1,0))', [globalKey]).catch(() => {});
    client.release();
  }
}

// Account/demo mail remains bounded request work in Phase 1. Resend resolves
// provider errors in {error}; only a response containing an id is accepted.
async function sendAccountEmail({ to, subject, html, text }) {
  if (!directSurveyProvider) return { sent: false, message: 'Email is not configured; deliver the returned link manually.' };
  try {
    const result = await invokeSynchronousProvider(to, () => directSurveyProvider.send(
      { from: 'CLA Survey <survey@cladvisors.com>', to, subject, html, text },
      { idempotencyKey: `account-email/${crypto.randomUUID()}` }
    ));
    if (!result?.id) throw new Error('Provider response did not include a message ID');
    return { sent: true, providerMessageId: result.id };
  } catch (error) {
    console.error('Account email provider request failed:', String(error.message || error).slice(0, 500));
    return { sent: false, message: 'Email provider request failed; deliver the returned link manually.' };
  }
}

function buildSurveyEmailHtml(text, link, language = 'en') {
  return require('./email').renderInvitation({ bodyText: text, link, language }).html;
}

function buildSurveyUrl(baseUrl, query, nodeEnv = process.env.NODE_ENV) {
  if (!baseUrl) throw new Error('Missing SURVEY_URL environment variable');
  const url = new URL(baseUrl);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error('SURVEY_URL must be an HTTP(S) base URL without credentials, query parameters, or a fragment');
  }
  if (lifecycle.isHostedEnvironment(lifecycle.environmentName({ NODE_ENV: nodeEnv })) && url.protocol !== 'https:') {
    throw new Error('SURVEY_URL must use HTTPS in production');
  }
  for (const [name, value] of Object.entries(query)) url.searchParams.set(name, value);
  return url.toString();
}

async function sendDemoMail(email, survey, text, demoToken, subject = 'CLA Network Survey', language = 'en') {
  if (!directSurveyProvider) throw new Error('Missing RESEND_KEY or RESEND_API_KEY environment variable');
  const link = buildSurveyUrl(process.env.SURVEY_URL, { surveyName: survey.name, demoToken });
  const rendered = require('./email').renderInvitation({ bodyText: text, link, language });
  return invokeSynchronousProvider(email, () => directSurveyProvider.send(
    { from: 'CLA Survey <survey@cladvisors.com>', to: email, subject: `[Demo] ${subject}`, ...rendered },
    { idempotencyKey: `survey-demo/${crypto.randomUUID()}` }
  ));
}

// Function to execute a query
async function executeQuery(query, values = []) {
  const client = await pool.connect();
  
  try {
    const result = await client.query(query, values);
    return result;
  } finally {
    client.release();
  }
}

const app = express();
const port = Number(process.env.PORT) || 3000;

function getDashboardBaseUrl() {
  return (process.env.DASHBOARD_URL || process.env.FRONTEND_URL || '').replace(/\/$/, '');
}

function buildDashboardUrl(path) {
  const baseUrl = getDashboardBaseUrl();
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${baseUrl}${normalizedPath}`;
}

const DEMO_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

function createDemoToken(surveyId, surveyName, now = Date.now()) {
  const payload = Buffer.from(JSON.stringify({
    type: 'survey-demo',
    surveyId,
    surveyName,
    expiresAt: now + DEMO_TOKEN_TTL_MS,
    nonce: crypto.randomBytes(12).toString('base64url'),
  })).toString('base64url');
  const signature = crypto
    .createHmac('sha256', process.env.DEMO_TOKEN_SECRET || process.env.SESSION_SECRET)
    .update(payload)
    .digest('base64url');
  return `d1.${payload}.${signature}`;
}

function verifyDemoToken(token, now = Date.now()) {
  try {
    const [version, payload, signature, extra] = String(token || '').split('.');
    if (version !== 'd1' || !payload || !signature || extra) return null;
    const expected = crypto
      .createHmac('sha256', process.env.DEMO_TOKEN_SECRET || process.env.SESSION_SECRET)
      .update(payload)
      .digest();
    const actual = Buffer.from(signature, 'base64url');
    if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) return null;
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (claims.type !== 'survey-demo' || !claims.surveyId || !claims.surveyName || !Number.isFinite(claims.expiresAt) || claims.expiresAt <= now) return null;
    return claims;
  } catch {
    return null;
  }
}

function prepareSurveyForDemo(value) {
  const namedDefinitions = new Map();
  const peopleChoiceSources = new Set();

  const inspect = (node, inheritedTagbox = false) => {
    if (Array.isArray(node)) {
      node.forEach((entry) => inspect(entry, inheritedTagbox));
      return;
    }
    if (!node || typeof node !== 'object') return;
    if (typeof node.name === 'string') {
      const definitions = namedDefinitions.get(node.name) || [];
      definitions.push(node);
      namedDefinitions.set(node.name, definitions);
    }
    const isTagbox = inheritedTagbox || node.type === 'tagbox' || node.cellType === 'tagbox';
    if (isTagbox && typeof node.choicesFromQuestion === 'string') {
      peopleChoiceSources.add(node.choicesFromQuestion);
    }
    Object.entries(node).forEach(([key, nestedValue]) => {
      inspect(nestedValue, node.cellType === 'tagbox' && key === 'columns');
    });
  };
  inspect(value);

  const pendingSources = [...peopleChoiceSources];
  while (pendingSources.length > 0) {
    const sources = namedDefinitions.get(pendingSources.pop()) || [];
    sources.forEach((source) => {
      if (
        typeof source.choicesFromQuestion === 'string'
        && !peopleChoiceSources.has(source.choicesFromQuestion)
      ) {
        peopleChoiceSources.add(source.choicesFromQuestion);
        pendingSources.push(source.choicesFromQuestion);
      }
    });
  }

  const prepare = (node, inheritedTagbox = false) => {
    if (Array.isArray(node)) {
      return node.map((entry) => prepare(entry, inheritedTagbox));
    }
    if (!node || typeof node !== 'object') return node;

    const isTagbox = inheritedTagbox || node.type === 'tagbox' || node.cellType === 'tagbox';
    const isPeopleSource = typeof node.name === 'string' && peopleChoiceSources.has(node.name);
    const prepared = Object.fromEntries(
      Object.entries(node).map(([key, nestedValue]) => [
        key,
        prepare(nestedValue, node.cellType === 'tagbox' && key === 'columns'),
      ])
    );

    // Current schema validation rejects remote choice URLs, but legacy surveys
    // may still contain private endpoints or embedded credentials.
    delete prepared.choicesByUrl;

    if (isTagbox || isPeopleSource) {
      prepared.choices = [];
      prepared.choicesLazyLoadEnabled = true;
      prepared.choicesLazyLoadPageSize = Number(node.choicesLazyLoadPageSize) > 0
        ? Math.min(Number(node.choicesLazyLoadPageSize), 100)
        : 25;
      prepared.allowAddNewTag = false;
      delete prepared.choicesFromQuestion;
      delete prepared.choicesFromQuestionMode;
      delete prepared.defaultValue;
      delete prepared.defaultValueExpression;
    }
    return prepared;
  };

  return prepare(value);
}

// Resend signatures cover the exact bytes; this route must precede JSON parsing.
app.post('/api/webhooks/resend', express.raw({ type: 'application/json', limit: '256kb' }), createResendWebhookHandler({ pool, env: process.env }));
const rosterJsonParser = express.json({ limit: '3mb' });
app.patch('/api/surveys/:surveyId/respondents', rosterJsonParser);
app.post('/api/updateTargets', rosterJsonParser);
app.delete('/api/user', rosterJsonParser);
app.use(express.json());
app.use((error, req, res, next) => {
  if (error?.type === 'entity.too.large') {
    return res.status(413).json({
      error: 'request_too_large',
      message: 'Request body exceeds the allowed size.',
    });
  }
  return next(error);
});

function configuredCorsOrigins(env = process.env) {
  const additionalSurveyOrigins = String(env.SURVEY_ALLOWED_ORIGINS || '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  return [...new Set([env.FRONTEND_URL, env.SURVEY_URL, ...additionalSurveyOrigins]
    .filter(Boolean)
    .map((origin) => origin.replace(/\/$/, '')))];
}

app.use(cors({
  origin: function(origin, callback) {
    const allowedOrigins = configuredCorsOrigins();
    const normalizedOrigin = origin ? origin.replace(/\/$/, '') : origin;

    if (!normalizedOrigin || allowedOrigins.includes(normalizedOrigin)) {
      callback(null, true);
    } else {
      console.warn(`CORS withheld for origin: ${origin} (Allowed: ${allowedOrigins.join(', ')})`);
      // Continue without CORS headers so authenticated mutation middleware can
      // return its stable 403 instead of Express converting a CORS error to 500.
      callback(null, false);
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Idempotency-Key'],
  exposedHeaders: ['X-Roster-Revision']
}));

app.set('trust proxy', 1);
function trustCloudFrontViewerProtocol(req, env = process.env) {
  if (String(env.TRUST_CLOUDFRONT_VIEWER_PROTO || '').toLowerCase() !== 'true') return false;
  const viewerProtocol = String(req.headers?.['cloudfront-forwarded-proto'] || '').trim().toLowerCase();
  if (viewerProtocol !== 'https') return false;
  req.headers['x-forwarded-proto'] = 'https';
  return true;
}
app.use((req, res, next) => {
  trustCloudFrontViewerProtocol(req);
  next();
});
function isHostedRuntimeEnvironment(env = process.env) {
  const nodeEnvironment = String(env.NODE_ENV || '').trim().toLowerCase();
  const workerEnvironment = String(env.EMAIL_WORKER_ENV || '').trim();
  const allowedWorkerEnvironments = new Set(['local', 'test', 'staging', 'prod', 'prod-secondary']);
  if (workerEnvironment && !allowedWorkerEnvironments.has(workerEnvironment)) {
    throw new Error('Unsupported EMAIL_WORKER_ENV');
  }
  return ['prod', 'production', 'prod-secondary'].includes(nodeEnvironment) || lifecycle.isHostedEnvironment(workerEnvironment);
}
// Session configuration with PostgreSQL
app.use(session({
  store: new pgSession({
    pool,
    tableName: 'sessions',
    createTableIfMissing: true,
    pruneSessionInterval: 60 * 15
  }),
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  // Host-only v2 cookie: sibling static hosts must never receive API sessions.
  name: process.env.SESSION_COOKIE_NAME || 'ona_session_v2',
  cookie: {
    secure: isHostedRuntimeEnvironment(),
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000, // 24 hours
    sameSite: 'lax',
    path: '/'
  }
}));
function isTrustedStateChangingOrigin({ stateChanging, userId, origin, dashboardOrigin, nodeEnv, workerEnvironment }) {
  if (!stateChanging || !userId) return true;
  const hosted = isHostedRuntimeEnvironment({ EMAIL_WORKER_ENV: workerEnvironment, NODE_ENV: nodeEnv });
  if (hosted) return Boolean(dashboardOrigin) && origin === dashboardOrigin;
  return !origin || (Boolean(dashboardOrigin) && origin === dashboardOrigin);
}

// Explicitly retire the old parent-domain cookie during the controlled re-login rollout.
app.use((req, res, next) => {
  if (isHostedRuntimeEnvironment()) {
    // Expire both legacy parent-domain names during the forced v2 re-login.
    // New Terraform config uses a distinct host-only SESSION_COOKIE_NAME.
    for (const legacyName of ['sessionId', 'sessionId-staging']) {
      res.append('Set-Cookie', `${legacyName}=; Max-Age=0; Path=/; Domain=.bennetts.work; Secure; HttpOnly; SameSite=Lax`);
    }
  }
  const trustedOrigin = isTrustedStateChangingOrigin({
    stateChanging: !['GET', 'HEAD', 'OPTIONS'].includes(req.method),
    userId: req.session?.userId,
    origin: req.get('Origin')?.replace(/\/$/, ''),
    dashboardOrigin: process.env.FRONTEND_URL?.replace(/\/$/, ''),
    nodeEnv: process.env.NODE_ENV,
    workerEnvironment: process.env.EMAIL_WORKER_ENV,
  });
  if (!trustedOrigin) {
    return res.status(403).json({ error: 'csrf_origin_invalid', message: 'A trusted dashboard Origin is required.' });
  }
  next();
});
const isLocalEnvironment = ['development', 'dev', 'local', 'test'].includes(process.env.NODE_ENV || 'development');
const allowPublicSignup = process.env.ALLOW_PUBLIC_SIGNUP === 'true' || (isLocalEnvironment && process.env.ALLOW_PUBLIC_SIGNUP !== 'false');

const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: Number(process.env.AUTH_RATE_LIMIT_MAX) || 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts, please try again later.' },
});

const respondentRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: Number(process.env.RESPONDENT_RATE_LIMIT_MAX) || 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later.' },
});

const demoEmailRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: Number(process.env.DEMO_EMAIL_RATE_LIMIT_MAX) || 10,
  keyGenerator: (req) => `user:${req.user.id}`,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many demo emails, please try again later.' },
});

const schemaCapabilityCache = new Map();

const ROLE_RANK = { viewer: 10, analyst: 20, editor: 30, admin: 40, owner: 50 };
const READ_SURVEY_ROLES = ['owner', 'admin', 'editor', 'analyst', 'viewer'];
const ANALYST_ROLES = ['owner', 'admin', 'editor', 'analyst'];
const EDITOR_ROLES = ['owner', 'admin', 'editor'];
const ADMIN_ROLES = ['owner', 'admin'];
const ORG_ROLES = ['owner', 'admin', 'editor', 'analyst', 'viewer'];
const USER_STATUSES = ['invited', 'active', 'disabled'];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function hasAnyRole(role, allowedRoles) {
  return Boolean(role && allowedRoles.includes(role));
}

function isPlatformAdmin(user) {
  return Boolean(user?.isPlatformAdmin || user?.is_platform_admin);
}

function legacySurveyPredicate(alias = '') {
  const prefix = alias ? `${alias}.` : '';
  return `(${prefix}survey_id = $1 OR (${prefix}survey_id IS NULL AND ${prefix}survey_name = $2))`;
}

function surveySummaryRespondentCount(value) {
  return String(Number(value || 0));
}

// Response-rate contract: current eligibility governs both counts. A completed
// response is any non-NULL response belonging to a currently eligible row.
function surveyResponseSummary(eligibleValue, completedValue) {
  const count = (value) => {
    const numeric = Number(value);
    return Number.isSafeInteger(numeric) && numeric >= 0 ? numeric : 0;
  };
  const eligibleCount = count(eligibleValue);
  const completedCount = Math.min(count(completedValue), eligibleCount);
  const responseRatePercent = eligibleCount === 0
    ? null
    : Math.floor(((completedCount * 100) + Math.floor(eligibleCount / 2)) / eligibleCount);
  return { eligibleCount, completedCount, responseRatePercent };
}

async function columnExists(tableName, columnName) {
  const cacheKey = `column:${tableName}.${columnName}`;
  if (schemaCapabilityCache.has(cacheKey)) {
    return schemaCapabilityCache.get(cacheKey);
  }

  try {
    const result = await pool.query(
      `SELECT 1
       FROM information_schema.columns
       WHERE table_schema = current_schema()
         AND table_name = $1
         AND column_name = $2
       LIMIT 1`,
      [tableName.toLowerCase(), columnName]
    );
    const exists = result.rows.length > 0;
    schemaCapabilityCache.set(cacheKey, exists);
    return exists;
  } catch (error) {
    console.warn(`Could not inspect schema column ${tableName}.${columnName}:`, error.message);
    return false;
  }
}

async function tableExists(tableName) {
  const cacheKey = `table:${tableName}`;
  if (schemaCapabilityCache.has(cacheKey)) {
    return schemaCapabilityCache.get(cacheKey);
  }

  try {
    const result = await pool.query(
      `SELECT 1
       FROM information_schema.tables
       WHERE table_schema = current_schema()
         AND table_name = $1
       LIMIT 1`,
      [tableName.toLowerCase()]
    );
    const exists = result.rows.length > 0;
    schemaCapabilityCache.set(cacheKey, exists);
    return exists;
  } catch (error) {
    console.warn(`Could not inspect schema table ${tableName}:`, error.message);
    return false;
  }
}

function toSafeUser(user) {
  if (!user) return null;

  return {
    id: user.id,
    username: user.username,
    email: user.email || null,
    displayName: user.display_name || null,
    status: user.status || 'active',
    isPlatformAdmin: Boolean(user.is_platform_admin),
    lastLoginAt: user.last_login_at || null,
  };
}

async function getUserById(userId) {
  const result = await pool.query('SELECT * FROM users WHERE id = $1', [userId]);
  return result.rows[0] || null;
}

async function getUserMemberships(userId) {
  if (!await tableExists('organization_memberships')) {
    return [];
  }

  const result = await pool.query(
    `SELECT om.organization_id AS "organizationId",
            om.role,
            o.name AS "organizationName",
            o.slug AS "organizationSlug"
     FROM organization_memberships om
     LEFT JOIN organizations o ON o.id = om.organization_id
     WHERE om.user_id = $1
     ORDER BY o.name NULLS LAST, om.role`,
    [userId]
  );

  return result.rows;
}

async function updateLastLoginIfSupported(userId) {
  if (!await columnExists('users', 'last_login_at')) {
    return;
  }

  try {
    await pool.query('UPDATE users SET last_login_at = CURRENT_TIMESTAMP WHERE id = $1', [userId]);
  } catch (error) {
    // Keep login backward-compatible if the column is not present in an older local DB.
    console.warn('Could not update users.last_login_at:', error.message);
  }
}

async function validateRespondentToken(surveyName, userId, queryable = pool, lockSurvey = false) {
  if (!surveyName || surveyName === 'undefined' || surveyName === 'null') {
    return { ok: false, status: 400, message: 'Survey name is required.' };
  }

  if (!userId) {
    return { ok: false, status: 400, message: 'User ID is required.' };
  }

  const result = await queryable.query(
    `SELECT r.respondent_id, r.response, r.can_respond, r.survey_id, s.lifecycle_status
     FROM Respondent r
     JOIN Survey s ON (r.survey_id = s.id OR (r.survey_id IS NULL AND r.survey_name = s.name))
     WHERE r.uuid = $1
       AND r.survey_name = $2
       AND s.archived_at IS NULL
       AND s.lifecycle_status = 'active'
       ${lockSurvey ? 'FOR SHARE OF s' : ''}`,
    [userId, surveyName]
  );

  if (result.rows.length === 0 || result.rows[0].can_respond !== true) {
    return { ok: false, status: 403, message: 'Invalid respondent token for survey.' };
  }

  return { ok: true, respondent: result.rows[0] };
}

// Register user endpoint
app.post('/api/register', authRateLimiter, async (req, res) => {
  try {
    if (!allowPublicSignup) {
      return res.status(403).json({ error: 'Public signup is disabled.' });
    }

    const { username, password, email, displayName, display_name: displayNameSnake } = req.body;

    // Validate input
    if (!username || !password) {
      return res.status(400).json({ 
        error: 'Username and password are required' 
      });
    }

    if (password.length < 6) {
      return res.status(400).json({ 
        error: 'Password must be at least 6 characters' 
      });
    }

    // Check if username already exists
    const existingUser = await pool.query(
      'SELECT * FROM users WHERE username = $1',
      [username]
    );

    if (existingUser.rows.length > 0) {
      return res.status(400).json({ 
        error: 'Username already exists' 
      });
    }

    // Hash password and create user
    const hashedPassword = await bcrypt.hash(password, 10);
    
    const insertColumns = ['username', 'password'];
    const insertValues = [username, hashedPassword];
    const placeholders = ['$1', '$2'];

    if (email && await columnExists('users', 'email')) {
      insertColumns.push('email');
      insertValues.push(email);
      placeholders.push(`$${insertValues.length}`);
    }

    const displayNameValue = displayName || displayNameSnake;
    if (displayNameValue && await columnExists('users', 'display_name')) {
      insertColumns.push('display_name');
      insertValues.push(displayNameValue);
      placeholders.push(`$${insertValues.length}`);
    }

    const result = await pool.query(
      `INSERT INTO users (${insertColumns.join(', ')}) VALUES (${placeholders.join(', ')}) RETURNING *`,
      insertValues
    );

    res.status(201).json({
      success: true,
      user: toSafeUser(result.rows[0])
    });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ 
      error: 'Failed to create account' 
    });
  }
});

app.post('/api/login', authRateLimiter, async (req, res) => {
  const { username, password } = req.body;
  
  try {
    const result = await pool.query(
      'SELECT * FROM users WHERE username = $1',
      [username]
    );
    
    const user = result.rows[0];
    
    if (!user || !await bcrypt.compare(password, user.password)) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    if ((user.status || 'active') === 'disabled') {
      return res.status(403).json({ error: 'Account is disabled' });
    }

    await updateLastLoginIfSupported(user.id);

    req.session.regenerate(err => {
      if (err) {
        console.error('Session regenerate error:', err);
        return res.status(500).json({ error: 'Session setup failed' });
      }

      req.session.userId = user.id;
      req.session.username = user.username;

      req.session.save(saveErr => {
        if (saveErr) {
          console.error('Session save error:', saveErr);
          return res.status(500).json({ error: 'Session save failed' });
        }

        getUserMemberships(user.id)
          .then(memberships => {
            res.json({
              success: true,
              user: toSafeUser({ ...user, last_login_at: new Date().toISOString() }),
              memberships
            });
          })
          .catch(error => {
            console.error('Membership lookup after login failed:', error);
            res.json({
              success: true,
              user: toSafeUser({ ...user, last_login_at: new Date().toISOString() }),
              memberships: []
            });
          });
      });
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Logout endpoint
app.post('/api/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      console.error('Logout error:', err);
      return res.status(500).json({ error: 'Error during logout' });
    }
    res.clearCookie(process.env.SESSION_COOKIE_NAME || 'ona_session_v2', {
      secure: isHostedRuntimeEnvironment(),
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
    });
    res.json({ success: true });
  });
});

// Modified check-auth endpoint with better error handling
app.get('/api/check-auth', async (req, res) => {

  if (!req.session) {
    return res.status(500).json({ 
      error: 'Session support not properly configured'
    });
  }

  if (!req.session.userId) {
    return res.status(401).json({ 
      isAuthenticated: false,
      message: 'No active session found'
    });
  }

  try {
    const user = await getUserById(req.session.userId);

    if (!user) {
      return res.status(401).json({ isAuthenticated: false, message: 'User not found' });
    }

    if ((user.status || 'active') === 'disabled') {
      return res.status(403).json({ isAuthenticated: false, message: 'Account is disabled' });
    }

    res.json({
      isAuthenticated: true,
      user: toSafeUser(user),
      memberships: await getUserMemberships(user.id)
    });
  } catch (error) {
    console.error('Check auth error:', error);
    res.status(500).json({ error: 'Failed to check authentication' });
  }
});

// Auth middleware for protected routes
const requireAuth = async (req, res, next) => {
  if (!req.session?.userId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const user = await getUserById(req.session.userId);

    if (!user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    if ((user.status || 'active') === 'disabled') {
      return res.status(403).json({ error: 'Account is disabled' });
    }

    req.user = toSafeUser(user);
    next();
  } catch (error) {
    console.error('Auth middleware error:', error);
    res.status(500).json({ error: 'Authentication check failed' });
  }
};

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function newRawToken() {
  return crypto.randomBytes(32).toString('base64url');
}

async function logAuditEvent({ organizationId = null, actorUserId = null, targetUserId = null, surveyId = null, eventType, metadata = {} }) {
  try {
    if (!await tableExists('audit_events')) return;
    await pool.query(
      `INSERT INTO audit_events (organization_id, actor_user_id, target_user_id, survey_id, event_type, metadata)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [organizationId, actorUserId, targetUserId, surveyId, eventType, JSON.stringify(metadata)]
    );
  } catch (error) {
    console.warn('Audit event write failed:', error.message);
  }
}

async function requireOrgAccess(req, res, organizationId, allowedRoles) {
  if (!organizationId) {
    res.status(400).json({ message: 'Organization ID is required.' });
    return null;
  }

  if (isPlatformAdmin(req.user)) {
    return { role: 'owner', organization_id: organizationId, platformAdmin: true };
  }

  const result = await pool.query(
    `SELECT role, organization_id
     FROM organization_memberships
     WHERE organization_id = $1 AND user_id = $2
     LIMIT 1`,
    [organizationId, req.user.id]
  );

  const membership = result.rows[0];
  if (!membership || !hasAnyRole(membership.role, allowedRoles)) {
    res.status(403).json({ message: 'Forbidden.' });
    return null;
  }
  return membership;
}

async function getDefaultOrganizationForUser(req, res, requestedOrganizationId = null) {
  if (requestedOrganizationId) {
    return requireOrgAccess(req, res, requestedOrganizationId, EDITOR_ROLES);
  }

  if (isPlatformAdmin(req.user)) {
    res.status(400).json({ message: 'Platform admins must provide organizationId when creating surveys.' });
    return null;
  }

  const result = await pool.query(
    `SELECT organization_id, role
     FROM organization_memberships
     WHERE user_id = $1
     ORDER BY created_at NULLS LAST, organization_id`,
    [req.user.id]
  );
  const memberships = result.rows.filter(row => hasAnyRole(row.role, EDITOR_ROLES));

  if (memberships.length === 0) {
    res.status(403).json({ message: 'No organization membership with survey creation permission.' });
    return null;
  }
  if (memberships.length > 1) {
    res.status(400).json({ message: 'organizationId is required when you belong to multiple organizations.' });
    return null;
  }
  return memberships[0];
}

async function getActiveOwnerCount(organizationId, excludeUserId = null, queryable = pool, { lockRows = false } = {}) {
  const values = [organizationId];
  let excludeSql = '';
  if (excludeUserId) {
    values.push(excludeUserId);
    excludeSql = ` AND u.id <> $${values.length}`;
  }

  if (lockRows) {
    const result = await queryable.query(
      `SELECT om.user_id
       FROM organization_memberships om
       JOIN users u ON u.id = om.user_id
       WHERE om.organization_id = $1
         AND om.role = 'owner'
         AND COALESCE(u.status, 'active') = 'active'
       ORDER BY om.user_id
       FOR UPDATE OF om, u`,
      [organizationId]
    );
    return result.rows.filter(row => Number(row.user_id) !== Number(excludeUserId)).length;
  }

  const result = await queryable.query(
    `SELECT COUNT(*)::int AS count
     FROM organization_memberships om
     JOIN users u ON u.id = om.user_id
     WHERE om.organization_id = $1
       AND om.role = 'owner'
       AND COALESCE(u.status, 'active') = 'active'${excludeSql}`,
    values
  );
  return Number(result.rows[0]?.count || 0);
}

app.get('/api/orgs', requireAuth, async (req, res) => {
  if (!isPlatformAdmin(req.user)) {
    return res.status(403).json({ message: 'Platform admin access is required.' });
  }

  try {
    const result = await pool.query(
      `SELECT o.id, o.name, o.slug, COUNT(om.user_id)::int AS "memberCount"
       FROM organizations o
       LEFT JOIN organization_memberships om ON om.organization_id = o.id
       GROUP BY o.id, o.name, o.slug
       ORDER BY o.name NULLS LAST, o.slug NULLS LAST, o.id`
    );
    res.json({ organizations: result.rows });
  } catch (error) {
    console.error('List organizations failed:', error);
    res.status(500).json({ message: 'Failed to list organizations.' });
  }
});

app.get('/api/orgs/:organizationId/members', requireAuth, async (req, res) => {
  const { organizationId } = req.params;
  const membership = await requireOrgAccess(req, res, organizationId, ADMIN_ROLES);
  if (!membership) return;

  try {
    const result = await pool.query(
      `SELECT u.id, u.username, u.email, u.display_name AS "displayName",
              COALESCE(u.status, 'active') AS status, om.role, om.created_at AS "memberSince"
       FROM organization_memberships om
       JOIN users u ON u.id = om.user_id
       WHERE om.organization_id = $1
       ORDER BY om.role DESC, u.username`,
      [organizationId]
    );
    res.json({ members: result.rows, actorRole: membership.role });
  } catch (error) {
    console.error('List members failed:', error);
    res.status(500).json({ message: 'Failed to list members.' });
  }
});

app.patch('/api/orgs/:organizationId/members/:userId', express.json(), requireAuth, async (req, res) => {
  const { organizationId, userId } = req.params;
  const actorMembership = await requireOrgAccess(req, res, organizationId, ADMIN_ROLES);
  if (!actorMembership) return;

  const nextRole = req.body.role;
  const nextStatus = req.body.status;
  if (nextRole !== undefined && !ORG_ROLES.includes(nextRole)) {
    return res.status(400).json({ message: 'Invalid role.' });
  }
  if (nextStatus !== undefined && !USER_STATUSES.includes(nextStatus)) {
    return res.status(400).json({ message: 'Invalid status.' });
  }

  const targetUserId = Number(userId);
  if (!Number.isInteger(targetUserId)) {
    return res.status(400).json({ message: 'Invalid user id.' });
  }
  if (targetUserId === req.user.id && nextStatus === 'disabled') {
    return res.status(400).json({ message: 'You cannot disable your own account.' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const actorResult = await client.query(
      `SELECT om.role
       FROM organization_memberships om
       JOIN users u ON u.id = om.user_id
       WHERE om.organization_id = $1 AND om.user_id = $2
         AND COALESCE(u.status, 'active') = 'active'
       FOR UPDATE`,
      [organizationId, req.user.id]
    );
    const lockedActorMembership = actorResult.rows[0];
    if (!actorMembership.platformAdmin && !hasAnyRole(lockedActorMembership?.role, ADMIN_ROLES)) {
      await client.query('ROLLBACK');
      return res.status(403).json({ message: 'Organization admin access is required.' });
    }

    const targetResult = await client.query(
      `SELECT om.role, u.status, u.username
       FROM organization_memberships om
       JOIN users u ON u.id = om.user_id
       WHERE om.organization_id = $1 AND om.user_id = $2
       FOR UPDATE`,
      [organizationId, targetUserId]
    );
    const target = targetResult.rows[0];
    if (!target) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Member not found.' });
    }

    const actorCanManageOwners = lockedActorMembership?.role === 'owner' || actorMembership.platformAdmin;
    if (target.role === 'owner' && !actorCanManageOwners) {
      await client.query('ROLLBACK');
      return res.status(403).json({ message: 'Only owners can modify owners.' });
    }
    if (nextRole === 'owner' && !actorCanManageOwners) {
      await client.query('ROLLBACK');
      return res.status(403).json({ message: 'Only owners can assign owner role.' });
    }

    const wouldRemoveActiveOwner = target.role === 'owner' && (nextRole && nextRole !== 'owner' || nextStatus === 'disabled');
    if (wouldRemoveActiveOwner && await getActiveOwnerCount(organizationId, targetUserId, client, { lockRows: true }) < 1) {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: 'Cannot remove the last active owner.' });
    }

    if (nextRole !== undefined) {
      await client.query('UPDATE organization_memberships SET role = $1 WHERE organization_id = $2 AND user_id = $3', [nextRole, organizationId, targetUserId]);
    }
    if (nextStatus !== undefined) {
      await client.query('UPDATE users SET status = $1 WHERE id = $2', [nextStatus, targetUserId]);
    }
    await client.query('COMMIT');

    await logAuditEvent({
      organizationId,
      actorUserId: req.user.id,
      targetUserId,
      eventType: 'member.updated',
      metadata: { previousRole: target.role, previousStatus: target.status, role: nextRole, status: nextStatus }
    });
    res.json({ success: true });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Update member failed:', error);
    res.status(500).json({ message: 'Failed to update member.' });
  } finally {
    client.release();
  }
});

app.post('/api/orgs/:organizationId/invites', express.json(), requireAuth, async (req, res) => {
  const { organizationId } = req.params;
  const actorMembership = await requireOrgAccess(req, res, organizationId, ADMIN_ROLES);
  if (!actorMembership) return;
  const { email, role = 'viewer', deliverEmail = false } = req.body;
  if (!email || !ORG_ROLES.includes(role)) return res.status(400).json({ message: 'Valid email and role are required.' });
  if (role === 'owner' && actorMembership.role !== 'owner' && !actorMembership.platformAdmin) return res.status(403).json({ message: 'Only owners can invite owners.' });

  try {
    const token = newRawToken();
    const result = await pool.query(
      `INSERT INTO organization_invites (organization_id, email, role, token_hash, expires_at, created_by_user_id)
       VALUES ($1, $2, $3, $4, NOW() + interval '7 days', $5)
       RETURNING id, email, role, expires_at AS "expiresAt"`,
      [organizationId, email, role, hashToken(token), req.user.id]
    );
    await logAuditEvent({ organizationId, actorUserId: req.user.id, eventType: 'invite.created', metadata: { email, role, inviteId: result.rows[0].id } });

    const acceptUrl = buildDashboardUrl(`/accept-invite?token=${token}`);
    const emailDelivery = deliverEmail
      ? await sendAccountEmail({
          to: email,
          subject: 'You have been invited to CLA Network Survey',
          text: `You have been invited to join CLA Network Survey. Accept your invite: ${acceptUrl}`,
          html: `<p>You have been invited to join CLA Network Survey.</p><p><a href="${acceptUrl}">Accept your invite</a></p><p>This invite expires in 7 days.</p>`,
        })
      : { sent: false, message: 'Email delivery was not requested; deliver the returned link manually.' };

    res.status(201).json({ invite: result.rows[0], token, acceptUrl, emailDelivery });
  } catch (error) {
    console.error('Create invite failed:', error);
    res.status(500).json({ message: 'Failed to create invite.' });
  }
});

app.post('/api/invites/accept', express.json(), authRateLimiter, async (req, res) => {
  const { token, username, password, displayName } = req.body;
  if (!token || !username || !password || password.length < 6) return res.status(400).json({ message: 'Token, username, and a 6+ character password are required.' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const inviteResult = await client.query(
      `SELECT * FROM organization_invites WHERE token_hash = $1 AND accepted_at IS NULL AND expires_at > NOW() FOR UPDATE`,
      [hashToken(token)]
    );
    const invite = inviteResult.rows[0];
    if (!invite) { await client.query('ROLLBACK'); return res.status(400).json({ message: 'Invite is invalid or expired.' }); }
    const existingUser = await client.query('SELECT id, username, email FROM users WHERE username = $1 OR email = $2 LIMIT 1', [username, invite.email]);
    if (existingUser.rows.length > 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: 'An account already exists for this username or invite email. Ask an admin to add the existing account directly.' });
    }
    const hashedPassword = await bcrypt.hash(password, 10);
    const userResult = await client.query(
      `INSERT INTO users (username, password, email, display_name, status, created_by_user_id)
       VALUES ($1, $2, $3, $4, 'active', $5)
       RETURNING id, username, email, display_name, status, is_platform_admin, last_login_at`,
      [username, hashedPassword, invite.email, displayName || username, invite.created_by_user_id]
    );
    const user = userResult.rows[0];
    await client.query(
      `INSERT INTO organization_memberships (organization_id, user_id, role, created_by_user_id)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (organization_id, user_id) DO UPDATE SET role = EXCLUDED.role`,
      [invite.organization_id, user.id, invite.role, invite.created_by_user_id]
    );
    await client.query('UPDATE organization_invites SET accepted_at = NOW(), accepted_by_user_id = $1 WHERE id = $2', [user.id, invite.id]);
    await client.query('COMMIT');
    await logAuditEvent({ organizationId: invite.organization_id, actorUserId: user.id, targetUserId: user.id, eventType: 'invite.accepted', metadata: { inviteId: invite.id } });
    res.json({ success: true, user: toSafeUser(user) });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Accept invite failed:', error);
    res.status(500).json({ message: 'Failed to accept invite.' });
  } finally { client.release(); }
});

app.post('/api/password-reset/request', express.json(), authRateLimiter, async (req, res) => {
  const { username, email } = req.body;
  try {
    const result = await pool.query('SELECT id, username, email FROM users WHERE username = $1 OR email = $2 LIMIT 1', [username || null, email || null]);
    const user = result.rows[0];
    if (!user) return res.json({ success: true });
    const token = newRawToken();
    await pool.query(`INSERT INTO password_reset_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, NOW() + interval '1 hour')`, [user.id, hashToken(token)]);
    await logAuditEvent({ actorUserId: user.id, targetUserId: user.id, eventType: 'password_reset.requested' });
    const devTokenPayload = process.env.RETURN_DEV_TOKENS === 'true'
      ? { token, resetUrl: buildDashboardUrl(`/reset-password?token=${token}`) }
      : {};
    res.json({ success: true, ...devTokenPayload });
  } catch (error) { console.error('Password reset request failed:', error); res.status(500).json({ message: 'Failed to request password reset.' }); }
});

app.post('/api/password-reset/complete', express.json(), authRateLimiter, async (req, res) => {
  const { token, password } = req.body;
  if (!token || !password || password.length < 6) return res.status(400).json({ message: 'Token and a 6+ character password are required.' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const tokenResult = await client.query(`SELECT * FROM password_reset_tokens WHERE token_hash = $1 AND used_at IS NULL AND expires_at > NOW() FOR UPDATE`, [hashToken(token)]);
    const row = tokenResult.rows[0];
    if (!row) { await client.query('ROLLBACK'); return res.status(400).json({ message: 'Reset token is invalid or expired.' }); }
    await client.query(`UPDATE users SET password = $1, password_changed_at = NOW(), status = CASE WHEN status = 'invited' THEN 'active' ELSE status END WHERE id = $2`, [await bcrypt.hash(password, 10), row.user_id]);
    await client.query('UPDATE password_reset_tokens SET used_at = NOW() WHERE id = $1', [row.id]);
    await client.query('COMMIT');
    await logAuditEvent({ actorUserId: row.user_id, targetUserId: row.user_id, eventType: 'password_reset.completed' });
    res.json({ success: true });
  } catch (error) { await client.query('ROLLBACK'); console.error('Password reset complete failed:', error); res.status(500).json({ message: 'Failed to reset password.' }); }
  finally { client.release(); }
});

function surveySlug(name) {
  return String(name || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'survey';
}

function surveyNameValidationError(name, { copied = false } = {}) {
  const value = typeof name === 'string' ? name : '';
  if (!value.trim()) return copied ? 'Copied survey name is required.' : 'Survey name is required.';
  if (!/^[A-Za-z0-9]+$/.test(value)) return 'Only letters and numbers are allowed in survey names.';
  if (value.length > 255) return `${copied ? 'Copied survey name' : 'Survey name'} must be 255 characters or fewer.`;
  return null;
}

async function copySurveyForUser({ actor, sourceSurveyId, name }) {
  const copiedName = typeof name === 'string' ? name : '';
  const validationError = surveyNameValidationError(copiedName, { copied: true });
  if (validationError) {
    const error = new Error(validationError);
    error.statusCode = 400;
    throw error;
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
    const platformAdmin = isPlatformAdmin(actor);
    const sourceResult = await client.query(
      platformAdmin
        ? `SELECT s.id, s.name, s.title, s.questions, s.instructions, s.organization_id, s.display_name,
                  'owner'::text AS role
           FROM Survey s
           WHERE (s.id::text = $1 OR s.name = $1)
             AND s.archived_at IS NULL
           ORDER BY (s.id::text = $1) DESC
           LIMIT 1
           FOR SHARE OF s`
        : `SELECT s.id, s.name, s.title, s.questions, s.instructions, s.organization_id,
                  s.display_name, om.role
           FROM Survey s
           JOIN organization_memberships om
             ON om.organization_id = s.organization_id
            AND om.user_id = $1
            AND om.role = ANY($3::text[])
           WHERE (s.id::text = $2 OR s.name = $2)
             AND s.archived_at IS NULL
           ORDER BY (s.id::text = $2) DESC
           LIMIT 1
           FOR SHARE OF s, om`,
      platformAdmin ? [sourceSurveyId] : [actor.id, sourceSurveyId, EDITOR_ROLES]
    );
    const source = sourceResult.rows[0];
    if (!source) {
      const error = new Error('Survey not found.');
      error.statusCode = 404;
      throw error;
    }

    // Survey.name remains a legacy global primary key, while slug uniqueness is
    // organization-scoped. Check both so callers get a stable collision response.
    const collision = await client.query(
      `SELECT 1 FROM Survey
       WHERE name = $1
          OR (organization_id = $2 AND slug = $3 AND archived_at IS NULL)
       LIMIT 1`,
      [copiedName, source.organization_id, surveySlug(copiedName)]
    );
    if (collision.rows.length > 0) {
      const error = new Error('A survey with that name already exists.');
      error.statusCode = 409;
      throw error;
    }

    const inserted = await client.query(
      `INSERT INTO Survey
         (name, title, creation_date, questions, instructions, organization_id, created_by_user_id, display_name, slug)
       VALUES ($1, $2, NOW(), $3, $4, $5, $6, $7, $8)
       RETURNING id, name, title, organization_id`,
      [copiedName, source.title, source.questions, source.instructions, source.organization_id, actor.id, copiedName, surveySlug(copiedName)]
    );
    const copied = inserted.rows[0];

    await client.query(
      `INSERT INTO EMAIL (survey_name, survey_id, lang, text, invitation_subject)
       SELECT $1, $2, lang, text, invitation_subject
       FROM EMAIL
       WHERE survey_id = $3 OR (survey_id IS NULL AND survey_name = $4)`,
      [copied.name, copied.id, source.id, source.name]
    );
    // Keep the exact internal placeholder expected by legacy status flows, but
    // never copy source roster rows or participant-linked state into the new survey.
    await client.query(
      `INSERT INTO Respondent
         (name, contact_info, survey_name, survey_id, can_respond, uuid, lang, response, email_sent)
       VALUES ('None', 'N/A', $1, $2, FALSE, gen_random_uuid()::text, 'English', NULL, FALSE)`,
      [copied.name, copied.id]
    );
    await client.query(
      `INSERT INTO audit_events
         (organization_id, actor_user_id, survey_id, event_type, metadata)
       VALUES ($1, $2, $3, 'survey.copied', $4::jsonb)`,
      [source.organization_id, actor.id, copied.id, JSON.stringify({ sourceSurveyId: source.id, sourceSurveyName: source.name, copiedSurveyName: copied.name })]
    );
    await client.query('COMMIT');
    return {
      id: copied.id,
      name: copied.name,
      title: copied.title,
      organizationId: copied.organization_id,
      sourceSurveyId: source.id,
      respondentsCopied: false,
      respondentStateReset: true,
    };
  } catch (error) {
    await client.query('ROLLBACK');
    if (error.code === '23505' && !error.statusCode) {
      error.statusCode = 409;
      error.message = 'A survey with that name already exists.';
    }
    throw error;
  } finally {
    client.release();
  }
}

async function resolveSurveyForUser(req, res, { surveyName, surveyId, allowedRoles = READ_SURVEY_ROLES, queryable = pool, lock = '' } = {}) {
  if (!surveyId && surveyName && UUID_RE.test(surveyName)) {
    surveyId = surveyName;
    surveyName = null;
  }

  if (!surveyName && !surveyId) {
    res.status(400).json({ message: 'Survey identifier is required.' });
    return null;
  }

  const values = [req.user.id];
  const predicates = ['s.archived_at IS NULL'];
  if (surveyId) {
    values.push(surveyId);
    predicates.push(`s.id = $${values.length}`);
  }
  if (surveyName) {
    values.push(surveyName);
    predicates.push(`s.name = $${values.length}`);
  }

  const result = await queryable.query(
    `SELECT s.id, s.name, s.title, s.creation_date, s.questions,
            s.organization_id, s.created_by_user_id, s.lifecycle_status, s.lifecycle_version,
            s.started_at, s.closed_at, s.archived_at, om.role
     FROM Survey s
     LEFT JOIN organization_memberships om
       ON om.organization_id = s.organization_id AND om.user_id = $1
     WHERE (${predicates.slice(1).join(' OR ')})
       AND s.archived_at IS NULL
     ORDER BY s.creation_date DESC NULLS LAST
     LIMIT 1
     ${lock ? `FOR ${lock} OF s` : ''}`,
    values
  );

  const survey = result.rows[0];
  if (!survey) {
    res.status(404).json({ message: 'Survey not found.' });
    return null;
  }
  if (!isPlatformAdmin(req.user) && !hasAnyRole(survey.role, allowedRoles)) {
    res.status(404).json({ message: 'Survey not found.' });
    return null;
  }
  return { ...survey, role: isPlatformAdmin(req.user) ? 'owner' : survey.role };
}


// Example usage: Adding a new survey
async function insertSurvey(name, title, organizationId, createdByUserId) {
  const query = `INSERT INTO Survey (name, title, creation_date, organization_id, created_by_user_id)
                 VALUES ($1, $2, NOW(), $3, $4)
                 RETURNING id, name, organization_id, created_by_user_id`;
  const result = await executeQuery(query, [name, title, organizationId, createdByUserId]);
  console.log('Survey added successfully!');
  return result.rows[0];
}
async function insertUsers(users, survey = null, transactionClient = null) {
  const client = transactionClient || await pool.connect();

  try {
    if (!transactionClient) await client.query('BEGIN');

    // This legacy helper is now limited to initial placeholder creation. Existing
    // roster rows may only be edited through respondent-roster.js by stable ID.
    // Insert/update the supplied rows
    for (const user of users) {
      const query = `
        INSERT INTO Respondent 
          (name, contact_info, uuid, survey_name, survey_id, can_respond, lang) 
        VALUES 
          ($1, $2, $3, $4, $5, $6, $7)
        ON CONFLICT (name, survey_name) 
        DO UPDATE SET
          contact_info = EXCLUDED.contact_info,
          can_respond = EXCLUDED.can_respond,
          survey_id = EXCLUDED.survey_id,
          lang = EXCLUDED.lang
      `;
      
      const values = [
        user.userName,
        user.email,
        nanoid(),  // Generate new UUID for all rows
        survey?.name || user.surveyName,
        survey?.id || user.surveyId || null,
        user.canRespond !== undefined ? user.canRespond : true, // Default to true if not specified
        user.language || 'English' // Default to English if not specified
      ];
      
      await client.query(query, values);
    }

    if (!transactionClient) await client.query('COMMIT');
  } catch (error) {
    if (!transactionClient) await client.query('ROLLBACK');
    console.error('Error in database operation:', error);
    throw error;
  } finally {
    if (!transactionClient) client.release();
  }
}
async function insertEmails(data, survey = null, transactionClient = null) {
  const client = transactionClient || await pool.connect();
  try {
    if (!transactionClient) await client.query('BEGIN');

    // Iterate through the emails and insert or update them
    for (const email of data) {
      const query = `
        INSERT INTO email (survey_name, survey_id, lang, text, invitation_subject)
        VALUES ($1, $2, $3, $4, COALESCE($5, 'CLA Network Survey'))
        ON CONFLICT (survey_name, lang) DO UPDATE
        SET text = EXCLUDED.text,
            survey_id = EXCLUDED.survey_id,
            invitation_subject = CASE
              WHEN $5 IS NULL THEN email.invitation_subject
              ELSE EXCLUDED.invitation_subject
            END
      `;
      const values = [
        survey?.name || email.surveyName,
        survey?.id || email.surveyId || null,
        normalizeInvitationLanguage(email.language),
        email.text,
        typeof email.subject === 'string' ? email.subject.trim() : null,
      ];
      await client.query(query, values);
    }

    if (!transactionClient) await client.query('COMMIT');
  } catch (error) {
    if (!transactionClient) await client.query('ROLLBACK');
    console.error('Error inserting or updating emails:', error);
    throw error;
  } finally {
    if (!transactionClient) client.release();
  }
}

async function insertQuestions(name, title, json, surveyId = null, transactionClient = null) {
  const client = transactionClient || await pool.connect();

  try {
    if (title === undefined || title === null || title === '') {
      // Preserve existing survey title; only update questions JSON
      const query = surveyId ? 'UPDATE Survey SET questions = $1 WHERE id = $2' : 'UPDATE Survey SET questions = $1 WHERE name = $2';
      const values = [json, surveyId || name];
      await client.query(query, values);
    } else {
      const query = surveyId ? 'UPDATE Survey SET title = $1, questions = $2 WHERE id = $3' : 'UPDATE Survey SET title = $1, questions = $2 WHERE name = $3';
      const values = [title, json, surveyId || name];
      await client.query(query, values);
    }

    console.log('Survey modified successfully!');
  } catch (error) {
    console.error('Error occurred:', error);
    throw error;
  } finally {
    if (!transactionClient) client.release();
  }
}
async function insertResponses(responses, userId, surveyName, surveyId = null) {
  const client = await pool.connect();

  try {
    const query = surveyId
      ? 'UPDATE Respondent SET response = $1 WHERE uuid = $2 AND (survey_id = $3 OR (survey_id IS NULL AND survey_name = $4))'
      : 'UPDATE Respondent SET response = $1 WHERE uuid = $2 AND survey_name = $3';
    const values = surveyId ? [responses, userId, surveyId, surveyName] : [responses, userId, surveyName];

    const result = await client.query(query, values);
    if (result.rowCount === 0) {
      throw new Error('No matching respondent found for survey.');
    }

    console.log('Survey modified successfully!');
  } catch (error) {
    console.error('Error occurred:', error);
    throw error;
  } finally {
    await client.release();
  }  
}

function parseRequiredCsvValue(value) {
  // A missing Required column is a legacy import and remains required. Once the
  // column exists, only the explicit value "true" is required; blank is false.
  if (value === undefined) return true;
  return String(value ?? '').trim().toLowerCase() === 'true';
}

const NESTED_QUESTIONS_UNSUPPORTED_MESSAGE = 'Nested SurveyJS questions, panels, and pages are not supported. Move every question into the survey\'s top-level elements array and remove panels/pages before saving.';

// This is the complete answer-bearing SurveyJS contract supported by response
// storage/results today. New types must define both their value shape and
// required-answer semantics here before schemas may persist them.
const SUPPORTED_QUESTION_TYPES = new Set([
  'text', 'comment', 'boolean', 'rating',
  'radiogroup', 'dropdown', 'checkbox', 'tagbox',
  'ranking', 'draggableranking', 'imagepicker', 'file',
  'matrix', 'matrixdropdown', 'matrixdynamic', 'multipletext'
]);
const SAFE_NESTED_NAME_RE = /^[A-Za-z0-9_][A-Za-z0-9 _-]{0,99}$/;
const UNSAFE_NESTED_NAMES = new Set(['__proto__', 'prototype', 'constructor']);
const SUPPORTED_MATRIX_CELL_TYPES = new Set([
  'default', 'dropdown', 'checkbox', 'radiogroup', 'tagbox', 'text',
  'comment', 'boolean', 'expression', 'rating', 'slider'
]);

function isPrimitiveDefinitionValue(value) {
  return typeof value === 'string' || typeof value === 'boolean' ||
    (typeof value === 'number' && Number.isFinite(value));
}

function validateItemDefinitions(items, label, { requireObjects = false } = {}) {
  if (!Array.isArray(items)) throw new Error(`${label} must be an array.`);
  items.forEach((item, index) => {
    if (isPrimitiveDefinitionValue(item) && !requireObjects) return;
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new Error(`${label} item ${index + 1} is malformed.`);
    }
    const hasValue = Object.prototype.hasOwnProperty.call(item, 'value');
    if (hasValue && !isPrimitiveDefinitionValue(item.value)) {
      throw new Error(`${label} item ${index + 1} value must be primitive.`);
    }
    const hasPrimitiveText = Object.prototype.hasOwnProperty.call(item, 'text') &&
      isPrimitiveDefinitionValue(item.text);
    if (!hasValue && !hasPrimitiveText) {
      throw new Error(`${label} item ${index + 1} must define a primitive value or text.`);
    }
  });
}

function validateNestedName(name, label, names) {
  if (typeof name !== 'string' || !SAFE_NESTED_NAME_RE.test(name) || UNSAFE_NESTED_NAMES.has(name)) {
    throw new Error(`${label} must have a nonempty safe name.`);
  }
  if (names.has(name)) throw new Error(`${label} names must be unique: ${name}.`);
  names.add(name);
}

function unsupportedChoicesByUrlMessage(label) {
  return `${label} defines unsupported property choicesByUrl. Remove choicesByUrl and provide local choices; server-side URL choice resolution is not supported.`;
}

function unsupportedChoicesLazyLoadMessage(label, type) {
  return `${label} defines unsupported property choicesLazyLoadEnabled for type ${type}. Remove choicesLazyLoadEnabled; lazy loading is supported only for tagbox questions.`;
}

function unsupportedAllowAddNewTagMessage(label) {
  return `${label} defines unsupported property allowAddNewTag=true. Set allowAddNewTag to false or remove it; respondent-created tagbox choices are not supported.`;
}

function validateColumnDefinitions(columns, questionLabel, parent) {
  if (!Array.isArray(columns)) throw new Error(`${questionLabel} columns must be an array.`);
  const names = new Set();
  columns.forEach((column, index) => {
    const label = `${questionLabel} column ${index + 1}`;
    if (!column || typeof column !== 'object' || Array.isArray(column)) {
      throw new Error(`${label} must be an object.`);
    }
    if (Object.prototype.hasOwnProperty.call(column, 'choicesByUrl')) {
      throw new Error(unsupportedChoicesByUrlMessage(label));
    }
    validateNestedName(column.name, label, names);
    if (column.cellType !== undefined &&
        (typeof column.cellType !== 'string' || !SUPPORTED_MATRIX_CELL_TYPES.has(column.cellType))) {
      throw new Error(`${label} has unsupported cell type: ${column.cellType}.`);
    }
    for (const property of ['choices', 'rateValues']) {
      if (column[property] !== undefined) validateItemDefinitions(column[property], `${label} ${property}`);
    }
    const cellType = !column.cellType || column.cellType === 'default'
      ? (parent.cellType || 'dropdown')
      : column.cellType;
    if (['default', 'dropdown', 'radiogroup', 'checkbox', 'tagbox'].includes(cellType)) {
      const choices = column.choices || parent.choices;
      if (!Array.isArray(choices) || choices.length === 0) {
        throw new Error(`${label} must define choices for cell type ${cellType}.`);
      }
    }
    if (column.isRequired !== undefined && typeof column.isRequired !== 'boolean') {
      throw new Error(`${label} required must be true or false.`);
    }
  });
}

function validateMultipleTextItems(items, questionLabel) {
  if (!Array.isArray(items)) throw new Error(`${questionLabel} items must be an array.`);
  const names = new Set();
  items.forEach((item, index) => {
    const label = `${questionLabel} item ${index + 1}`;
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new Error(`${label} must be an object.`);
    }
    validateNestedName(item.name, label, names);
    if (item.isRequired !== undefined && typeof item.isRequired !== 'boolean') {
      throw new Error(`${label} required must be true or false.`);
    }
  });
}

const SURVEYJS_RESERVED_EXPRESSION_ROOTS = new Set(['item', 'row', 'panel', 'composite', 'survey']);

function validateSurveyDefinition(json) {
  if (!json || typeof json !== 'object' || Array.isArray(json)) {
    throw new Error('Questions must be a SurveyJS schema object.');
  }
  if (json.claNextQuestionNumber !== undefined &&
      (!Number.isSafeInteger(json.claNextQuestionNumber) || json.claNextQuestionNumber < 1)) {
    throw new Error('claNextQuestionNumber must be a positive safe integer.');
  }
  if (!Array.isArray(json.elements)) {
    throw new Error('Questions schema must contain an elements array.');
  }
  if (Array.isArray(json.pages) || json.pages !== undefined) {
    throw new Error(NESTED_QUESTIONS_UNSUPPORTED_MESSAGE);
  }
  if (json.elements.length > 200) {
    throw new Error('A survey may contain at most 200 questions.');
  }

  const questionNames = new Set();
  return {
    ...json,
    elements: json.elements.map((element, index) => {
      if (!element || typeof element !== 'object' || Array.isArray(element)) {
        throw new Error(`Question ${index + 1} must be an object.`);
      }
      if (typeof element.type !== 'string' || !/^[a-z][a-z0-9-]{0,99}$/i.test(element.type)) {
        throw new Error(`Question ${index + 1} has an invalid type.`);
      }
      if (element.type === 'panel' || element.type === 'paneldynamic' ||
          element.elements !== undefined || element.templateElements !== undefined) {
        throw new Error(NESTED_QUESTIONS_UNSUPPORTED_MESSAGE);
      }
      if (!SUPPORTED_QUESTION_TYPES.has(element.type)) {
        throw new Error(`Question ${index + 1} has unsupported type: ${element.type}.`);
      }
      if (Object.prototype.hasOwnProperty.call(element, 'valueName')) {
        throw new Error(`Question ${index + 1} defines unsupported property valueName. Remove valueName so answers are stored under the question name.`);
      }
      if (Object.prototype.hasOwnProperty.call(element, 'choicesByUrl')) {
        throw new Error(unsupportedChoicesByUrlMessage(`Question ${index + 1}`));
      }
      if (element.type !== 'tagbox' &&
          Object.prototype.hasOwnProperty.call(element, 'choicesLazyLoadEnabled')) {
        throw new Error(unsupportedChoicesLazyLoadMessage(`Question ${index + 1}`, element.type));
      }
      if (element.type === 'tagbox' && element.allowAddNewTag === true) {
        throw new Error(unsupportedAllowAddNewTagMessage(`Question ${index + 1}`));
      }
      if (typeof element.name !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]{0,99}$/.test(element.name)) {
        throw new Error(`Question ${index + 1} must have a nonempty safe name.`);
      }
      if (SURVEYJS_RESERVED_EXPRESSION_ROOTS.has(element.name.toLowerCase())) {
        throw new Error(`Question ${index + 1} name "${element.name}" conflicts with the reserved SurveyJS expression variable "${element.name.toLowerCase()}". Choose a different question name.`);
      }
      if (questionNames.has(element.name)) {
        throw new Error(`Question names must be unique: ${element.name}.`);
      }
      questionNames.add(element.name);
      if (element.title !== undefined && (typeof element.title !== 'string' || element.title.length > 4000)) {
        throw new Error(`Question ${index + 1} has an invalid title.`);
      }
      if (element.isRequired !== undefined && typeof element.isRequired !== 'boolean') {
        throw new Error(`Question ${index + 1} required must be true or false.`);
      }

      const questionLabel = `Question ${index + 1}`;
      for (const property of ['choices', 'rateValues']) {
        if (element[property] !== undefined) {
          validateItemDefinitions(element[property], `${questionLabel} ${property}`);
        }
      }
      for (const property of ['otherItemValue', 'noneItemValue', 'refuseItemValue', 'dontKnowItemValue']) {
        if (element[property] !== undefined && !isPrimitiveDefinitionValue(element[property])) {
          throw new Error(`${questionLabel} ${property} must be a primitive value.`);
        }
      }
      if (element.type === 'matrix') {
        validateItemDefinitions(element.rows, `${questionLabel} rows`);
        validateItemDefinitions(element.columns, `${questionLabel} columns`);
      } else if (element.type === 'matrixdropdown' || element.type === 'matrixdynamic') {
        if (element.cellType !== undefined &&
            (typeof element.cellType !== 'string' || !SUPPORTED_MATRIX_CELL_TYPES.has(element.cellType))) {
          throw new Error(`${questionLabel} has unsupported matrix cell type: ${element.cellType}.`);
        }
        if (element.type === 'matrixdropdown') {
          validateItemDefinitions(element.rows, `${questionLabel} rows`);
        }
        validateColumnDefinitions(element.columns, questionLabel, element);
      }
      if (element.type === 'matrixdynamic') {
        if (element.minRowCount !== undefined &&
            (!Number.isInteger(element.minRowCount) || element.minRowCount < 0)) {
          throw new Error(`${questionLabel} minRowCount must be a nonnegative integer.`);
        }
        if (element.maxRowCount !== undefined &&
            (!Number.isInteger(element.maxRowCount) || element.maxRowCount < 1)) {
          throw new Error(`${questionLabel} maxRowCount must be a positive integer.`);
        }
        if (element.minRowCount !== undefined && element.maxRowCount !== undefined &&
            element.minRowCount > element.maxRowCount) {
          throw new Error(`${questionLabel} minRowCount cannot exceed maxRowCount.`);
        }
      } else if (element.type === 'multipletext') {
        validateMultipleTextItems(element.items, questionLabel);
      }
      // Materialize SurveyJS's false default, making the persisted contract explicit.
      return { ...element, isRequired: element.isRequired === true };
    })
  };
}

function isEmptyAnswer(value) {
  if (value === undefined || value === null || value === '') return true;
  if (Array.isArray(value)) return value.length === 0 || value.every(isEmptyAnswer);
  if (typeof value === 'object') {
    const nestedValues = Object.values(value);
    return nestedValues.length === 0 || nestedValues.every(isEmptyAnswer);
  }
  return false;
}

function configuredItemValues(items) {
  if (!Array.isArray(items)) return null;
  return items.map((item) => (
    item && typeof item === 'object' && !Array.isArray(item)
      ? (item.value !== undefined ? item.value : item.text)
      : item
  ));
}

function configuredChoiceValues(element) {
  let values = configuredItemValues(element.choices);
  const specialItems = [
    ['showOtherItem', 'otherItemValue', 'other'],
    ['showNoneItem', 'noneItemValue', 'none'],
    ['showRefuseItem', 'refuseItemValue', 'refused'],
    ['showDontKnowItem', 'dontKnowItemValue', 'dontknow'],
  ];
  specialItems.forEach(([showProperty, valueProperty, defaultValue]) => {
    if (element[showProperty] === true) {
      values ||= [];
      values.push(element[valueProperty] ?? defaultValue);
    }
  });
  return values;
}

function hasDuplicateValues(values) {
  return new Set(values).size !== values.length;
}

const FREE_FORM_OTHER_TYPES = new Set(['radiogroup', 'dropdown', 'checkbox', 'tagbox']);

function allowsFreeFormOther(schema, element) {
  if (!FREE_FORM_OTHER_TYPES.has(element.type) || element.showOtherItem !== true) return false;
  if (element.storeOthersAsComment === true) return false;
  return element.storeOthersAsComment === false || schema.storeOthersAsComment === false;
}

function isValidFreeFormOther(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= 4000;
}

function validateChoiceValues(values, configuredChoices, allowFreeFormOther) {
  if (values.length === 0) return true;
  if (!Array.isArray(configuredChoices)) return false;
  const unknown = values.filter((value) => !configuredChoices.includes(value));
  return unknown.length === 0 ||
    (allowFreeFormOther && unknown.length === 1 && isValidFreeFormOther(unknown[0]));
}

function validateTextValue(configuration, value) {
  return configuration.inputType === 'number'
    ? typeof value === 'number' && Number.isFinite(value)
    : typeof value === 'string';
}

function validateBooleanValue(configuration, value) {
  const valueTrue = configuration.valueTrue ?? true;
  const valueFalse = configuration.valueFalse ?? false;
  return value === valueTrue || value === valueFalse;
}

function validateRatingValue(configuration, value, modelQuestion) {
  // SurveyJS may generate values from a combination of rateCount, rateMin,
  // rateMax, rateStep, and rateType. Use the same rendered model values for
  // top-level ratings rather than trying to duplicate that generation logic.
  if (Array.isArray(modelQuestion?.visibleRateValues)) {
    return modelQuestion.visibleRateValues.some((item) => item.value === value);
  }
  const rateValues = configuredItemValues(configuration.rateValues);
  if (rateValues) return rateValues.includes(value);
  const min = Number.isFinite(configuration.rateMin) ? configuration.rateMin : 1;
  const max = Number.isFinite(configuration.rateMax) ? configuration.rateMax : 5;
  const step = Number.isFinite(configuration.rateStep) && configuration.rateStep > 0
    ? configuration.rateStep
    : 1;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) return false;
  const stepsFromMin = (value - min) / step;
  return Math.abs(stepsFromMin - Math.round(stepsFromMin)) < 1e-9;
}

function validateSelectionCount(configuration, value, includeClaMaxSelections = false) {
  if (!Array.isArray(value)) return false;
  const min = Number.isFinite(configuration.minSelectedChoices) && configuration.minSelectedChoices > 0
    ? configuration.minSelectedChoices
    : 0;
  const configuredMaxima = [configuration.maxSelectedChoices];
  if (includeClaMaxSelections) configuredMaxima.push(configuration.claMaxSelections);
  const maxima = configuredMaxima.filter((limit) => Number.isFinite(limit) && limit > 0);
  const max = maxima.length > 0 ? Math.min(...maxima) : Infinity;
  return value.length >= min && value.length <= max;
}

function modelChoiceValues(question, element) {
  const modelChoiceItems = Array.isArray(question?.enabledChoices)
    ? question.enabledChoices
    : (Array.isArray(question?.visibleChoices) ? question.visibleChoices : null);
  const specialValues = configuredChoiceValues({ ...element, choices: undefined }) || [];
  if (modelChoiceItems) {
    return [...new Set([...modelChoiceItems.map((choice) => choice.value), ...specialValues])];
  }
  return configuredChoiceValues(element);
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isScalar(value) {
  return value === null || ['string', 'number', 'boolean'].includes(typeof value);
}

function validateMatrixCell(column, parent, value) {
  const type = !column.cellType || column.cellType === 'default'
    ? (parent.cellType || 'dropdown')
    : column.cellType;
  const choiceSource = Array.isArray(column.choices) ? column : parent;
  const choices = configuredChoiceValues(choiceSource);
  if (type === 'checkbox' || type === 'tagbox') {
    return validateSelectionCount(column, value, type === 'tagbox') && !hasDuplicateValues(value) &&
      value.every((item) => isScalar(item) && Array.isArray(choices) && choices.includes(item));
  }
  if (type === 'text') return validateTextValue(column, value);
  if (type === 'comment') return typeof value === 'string';
  if (type === 'boolean') return validateBooleanValue(column, value);
  if (type === 'rating') return validateRatingValue(column, value);
  if (type === 'slider') return typeof value === 'number' && Number.isFinite(value);
  if (type === 'expression') return isScalar(value);
  if (choices) return isScalar(value) && choices.includes(value);
  return isScalar(value);
}

function validateStructuredAnswer(element, value) {
  if (element.type === 'matrix') {
    if (!isPlainObject(value)) return false;
    const rows = configuredItemValues(element.rows);
    const columns = configuredItemValues(element.columns);
    if (!rows || !columns) return false;
    const rowKeys = new Set(rows.map(String));
    return Object.entries(value).every(([row, choice]) => rowKeys.has(row) && isScalar(choice) && columns.includes(choice));
  }

  if (element.type === 'matrixdropdown') {
    if (!isPlainObject(value) || !Array.isArray(element.rows) || !Array.isArray(element.columns)) return false;
    const rowKeys = new Set(configuredItemValues(element.rows).map(String));
    const columns = new Map(element.columns.map((column) => [String(column?.name), column]));
    return Object.entries(value).every(([row, cells]) => rowKeys.has(row) && isPlainObject(cells) &&
      Object.entries(cells).every(([columnName, cell]) => {
        const column = columns.get(columnName);
        return Boolean(column) && validateMatrixCell(column, element, cell);
      }));
  }

  if (element.type === 'matrixdynamic') {
    if (!Array.isArray(value) || !Array.isArray(element.columns)) return false;
    if (element.minRowCount !== undefined && value.length < element.minRowCount) return false;
    if (element.maxRowCount !== undefined && value.length > element.maxRowCount) return false;
    const columns = new Map(element.columns.map((column) => [String(column?.name), column]));
    return value.every((row) => isPlainObject(row) && Object.entries(row).every(([columnName, cell]) => {
      const column = columns.get(columnName);
      return Boolean(column) && validateMatrixCell(column, element, cell);
    }));
  }

  if (element.type === 'multipletext') {
    if (!isPlainObject(value) || !Array.isArray(element.items)) return false;
    const items = new Map(element.items.map((item) => [String(item?.name), item]));
    return Object.entries(value).every(([itemName, itemValue]) => {
      const item = items.get(itemName);
      return Boolean(item) && validateTextValue(item, itemValue);
    });
  }

  if (element.type === 'file') {
    if (!Array.isArray(value)) return false;
    const allowedKeys = new Set(['name', 'type', 'content', 'size', 'lastModified']);
    return value.every((file) => isPlainObject(file) && typeof file.name === 'string' && file.name.length > 0 &&
      Object.keys(file).every((key) => allowedKeys.has(key)) &&
      (file.type === undefined || typeof file.type === 'string') &&
      (file.content === undefined || typeof file.content === 'string') &&
      (file.size === undefined || (typeof file.size === 'number' && Number.isFinite(file.size) && file.size >= 0)) &&
      (file.lastModified === undefined || (typeof file.lastModified === 'number' && Number.isFinite(file.lastModified))));
  }

  return null;
}

function validateRequiredAnswers(schema, answers, options = {}) {
  if (!answers || typeof answers !== 'object' || Array.isArray(answers)) {
    return ['Answers must be an object.'];
  }
  const elements = Array.isArray(schema?.elements) ? schema.elements : [];
  const allowedNames = new Set(elements.map((element) => element?.name).filter(Boolean));
  const otherCommentTypes = new Set([
    'radiogroup', 'dropdown', 'checkbox', 'tagbox', 'ranking', 'imagepicker'
  ]);
  const commentNames = new Set(elements
    .filter((element) => element?.name && (element.showCommentArea === true ||
      (element.showOtherItem === true && otherCommentTypes.has(element.type) &&
        !allowsFreeFormOther(schema, element))))
    .map((element) => `${element.name}-Comment`));
  const errors = [];
  const addInvalid = (name) => errors.push(`Invalid response: ${name}`);
  Object.entries(answers).forEach(([name, value]) => {
    if (name === 'timeStamp') return;
    if (commentNames.has(name)) {
      if (typeof value !== 'string' || value.length > 4000) addInvalid(name);
    } else if (!allowedNames.has(name)) {
      errors.push(`Unknown question: ${name}`);
    }
  });

  // Reject URL-backed choices in legacy persisted schemas before constructing a
  // SurveyJS model, so response validation never attempts URL choice resolution.
  elements.forEach((element, index) => {
    if (Object.prototype.hasOwnProperty.call(element || {}, 'choicesByUrl')) {
      errors.push(unsupportedChoicesByUrlMessage(`Question ${index + 1}`));
    }
    if (element?.type !== 'tagbox' &&
        Object.prototype.hasOwnProperty.call(element || {}, 'choicesLazyLoadEnabled')) {
      errors.push(unsupportedChoicesLazyLoadMessage(`Question ${index + 1}`, element.type || '(missing)'));
    }
    if (element?.type === 'tagbox' && element.allowAddNewTag === true) {
      errors.push(unsupportedAllowAddNewTagMessage(`Question ${index + 1}`));
    }
    if (Array.isArray(element?.columns)) {
      element.columns.forEach((column, columnIndex) => {
        if (Object.prototype.hasOwnProperty.call(column || {}, 'choicesByUrl')) {
          errors.push(unsupportedChoicesByUrlMessage(`Question ${index + 1} column ${columnIndex + 1}`));
        }
      });
    }
  });
  if (errors.some((error) => error.includes('unsupported property'))) {
    return [...new Set(errors)];
  }

  // Let SurveyJS compute visibleIf against submitted data. Validation below still
  // iterates the schema, rather than only model questions, so a custom question
  // omitted by SurveyJS cannot bypass explicit requiredness checks.
  const model = new Model(schema);
  model.data = answers;
  model.validate();
  model.getAllQuestions().forEach((question) => {
    // Parent question.errors omits required multipletext items and matrix cells.
    // getAllErrors includes those nested editor errors.
    if (question.getAllErrors().length > 0) addInvalid(question.name);
  });

  const arrayTypes = new Set(['checkbox', 'tagbox', 'ranking', 'draggableranking', 'file', 'matrixdynamic']);
  const objectTypes = new Set(['matrix', 'matrixdropdown', 'multipletext']);
  const singleChoiceTypes = new Set(['radiogroup', 'dropdown']);
  const multiChoiceTypes = new Set(['checkbox', 'ranking', 'draggableranking']);

  elements.forEach((element, index) => {
    if (!element?.name) return;
    if (!SUPPORTED_QUESTION_TYPES.has(element.type)) {
      errors.push(`Unsupported question type: ${element.type || '(missing)'}`);
      return;
    }
    if (Object.prototype.hasOwnProperty.call(element, 'valueName')) {
      errors.push(`Unsupported question property: valueName (question ${index + 1}, ${element.name}). Remove valueName so answers use the question name.`);
      return;
    }
    const hasAnswer = Object.prototype.hasOwnProperty.call(answers, element.name);
    const value = answers[element.name];
    const modelQuestion = model.getQuestionByName(element.name);
    const isVisible = modelQuestion ? modelQuestion.isVisible : true;
    const isEnabled = modelQuestion ? !modelQuestion.isReadOnly : true;

    if (element.isRequired === true && isVisible && isEnabled && isEmptyAnswer(value)) {
      addInvalid(element.name);
    }
    if (!hasAnswer) return;

    let valid = true;
    if (element.type === 'text') {
      valid = validateTextValue(element, value);
    } else if (element.type === 'comment') {
      valid = typeof value === 'string';
    } else if (element.type === 'boolean') {
      valid = validateBooleanValue(element, value);
    } else if (element.type === 'rating') {
      valid = validateRatingValue(element, value, modelQuestion);
    } else if (singleChoiceTypes.has(element.type)) {
      const choices = modelChoiceValues(modelQuestion, element);
      valid = !Array.isArray(value) && value !== null && typeof value !== 'object' &&
        validateChoiceValues([value], choices, allowsFreeFormOther(schema, element));
    } else if (multiChoiceTypes.has(element.type)) {
      const choices = modelChoiceValues(modelQuestion, element);
      valid = validateSelectionCount(element, value) && !hasDuplicateValues(value) &&
        validateChoiceValues(value, choices, allowsFreeFormOther(schema, element));
    } else if (element.type === 'tagbox') {
      const configuredChoices = modelChoiceValues(modelQuestion, element) || [];
      const choices = element.choicesLazyLoadEnabled === true && options.lazyTagboxChoices instanceof Set
        ? [...new Set([...configuredChoices, ...options.lazyTagboxChoices])]
        : configuredChoices;
      valid = validateSelectionCount(element, value, true) && !hasDuplicateValues(value) &&
        validateChoiceValues(value, choices, allowsFreeFormOther(schema, element));
    } else if (element.type === 'imagepicker') {
      const choices = modelChoiceValues(modelQuestion, element);
      valid = element.multiSelect === true
        ? validateSelectionCount(element, value) && !hasDuplicateValues(value) &&
          Array.isArray(choices) && value.every((item) => choices.includes(item))
        : !Array.isArray(value) && value !== null && typeof value !== 'object' &&
          Array.isArray(choices) && choices.includes(value);
    } else if (arrayTypes.has(element.type) || objectTypes.has(element.type)) {
      valid = validateStructuredAnswer(element, value);
    }
    if (!valid) addInvalid(element.name);
  });
  return [...new Set(errors)];
}

function csvToJson(csvString, title) {
    let json = {
        "elements": [],
        "showQuestionNumbers": false
    };

    // Parse CSV string
    let result = Papa.parse(csvString, {
        header: true,
        skipEmptyLines: true,
    });

    // Legacy files may omit names. Preserve supplied canonical identities, while
    // letting the endpoint normalizer allocate identities for arbitrary names.
    result.data.forEach((item, index) => {
      item['Question name'] = item['Question name'] || `question_${index + 1}`;
    });

    // Iterate through each parsed data and create the corresponding question object
    result.data.forEach(item => {
      console.log(item);
    let questionObject = {
            "type": item['Question type'],
            "name": item['Question name'],
            "title": item['Question title'],
            "isRequired": parseRequiredCsvValue(item['Required']),
            ...(item['Question type'] === 'tagbox' ? {
              "choicesLazyLoadEnabled": true,
              "choicesLazyLoadPageSize": 25,
            } : {}),
            "maxSelectedChoices": item['Max answers'] ? parseInt(item['Max answers']) : null,
         };

        json.elements.push(questionObject);
    });

    return {questions: json, title: result.data[0]['Title']};
}


// PUT API endpoint for creating a new survey
app.post('/api/survey', express.json(), requireAuth, async (req, res) => {
  const data  = req.body;
  const surveyName = typeof data.surveyName === 'string' ? data.surveyName : '';

  const validationError = surveyNameValidationError(surveyName);
  if (validationError) {
    res.status(400).json({ message: validationError });
    return;
  }

  try {
    // The placeholder respondent references Survey(name), so the survey row
    // must be committed first
    const org = await getDefaultOrganizationForUser(req, res, data.organizationId || data.organization_id || null);
    if (!org) return;
    const survey = await insertSurvey(surveyName, '', org.organization_id, req.user.id);
    await insertUsers([{userName: 'None', email: 'N/A', surveyName: surveyName, canRespond: false, language: 'English'}], survey);
    res.status(200).json({ message: 'Survey created successfully!', survey: { id: survey.id, name: survey.name, organizationId: survey.organization_id } });
  } catch (error) {
    console.error(error);
    if (error.code === '23505') {
      return res.status(409).json({ message: 'A survey with that name already exists.' });
    }
    res.status(500).json({ message: 'Failed to create survey.' });
  }
});

app.post('/api/surveys/:surveyId/copy', express.json(), requireAuth, async (req, res) => {
  try {
    const survey = await copySurveyForUser({
      actor: req.user,
      sourceSurveyId: req.params.surveyId,
      name: req.body?.name,
    });
    res.status(201).json({
      message: `Survey copied successfully as "${survey.name}".`,
      survey,
    });
  } catch (error) {
    if ((error.statusCode || 500) >= 500) console.error('Failed to copy survey:', error);
    res.status(error.statusCode || 500).json({
      message: error.statusCode ? error.message : 'Failed to copy survey.',
    });
  }
});

app.post('/api/testEmail', express.json(), requireAuth, async (_req, res) => {
  // Real-respondent reminders must not bypass durable delivery history.
  // Phase 3 replaces this compatibility route with an audited reminder run.
  res.status(410).json({
    error: 'reminders_not_available',
    message: 'Respondent reminders are temporarily unavailable while durable reminder tracking is being introduced.',
  });
});

app.post('/api/surveys/:surveyId/demo-email', express.json(), requireAuth, demoEmailRateLimiter, async (req, res) => {
  const { email, language } = req.body;
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ message: 'A valid email address is required.' });
  }
  if (!language) {
    return res.status(400).json({ message: 'Language is required.' });
  }

  try {
    const survey = await resolveSurveyForUser(req, res, {
      surveyName: req.params.surveyId,
      allowedRoles: EDITOR_ROLES,
    });
    if (!survey) return;

    const templateResult = await pool.query(
      `SELECT text, invitation_subject FROM email WHERE ${legacySurveyPredicate()} AND lang = $3 LIMIT 1`,
      [survey.id, survey.name, language]
    );
    if (templateResult.rows.length === 0) {
      return res.status(404).json({ message: `No ${language} email template is configured for this survey.` });
    }

    const demoToken = createDemoToken(survey.id, survey.name);
    await sendDemoMail(
      email.trim(), survey, templateResult.rows[0].text, demoToken,
      templateResult.rows[0].invitation_subject
    );
    res.status(200).json({ message: `Demo survey sent to ${email.trim()}.` });
  } catch (error) {
    console.error('Failed to send demo survey:', error);
    res.status(500).json({ message: 'Failed to send demo survey email.' });
  }
});

function sendLifecycleError(res, error) {
  if (error instanceof lifecycle.LifecycleError) return res.status(error.status).json(lifecycle.publicError(error));
  console.error('Lifecycle operation failed:', String(error.message || error).slice(0, 500));
  return res.status(500).json({ error: 'internal_error', message: 'Lifecycle operation failed.' });
}
function launchResponse(res, launch) {
  const location = `/api/surveys/${launch.survey_id}/launches/${launch.id}`;
  const label = launch.kind === 'reminder' ? 'Reminder campaign' : 'Invitation launch';
  return res.status(launch.replayed ? 200 : 202).location(location).json({
    launch,
    lifecycleStatus: launch.lifecycleStatus,
    message: launch.replayed ? `Existing ${label.toLowerCase()} returned; no new work was queued.` : `${label} queued.`,
  });
}

app.get('/api/surveys/:surveyId/instructions', requireAuth, async (req, res) => {
  res.set('Cache-Control', 'no-store');
  try {
    res.json(await lifecycle.getSurveyInstructions(pool, req.user, req.params.surveyId));
  } catch (error) {
    sendLifecycleError(res, error);
  }
});
app.put('/api/surveys/:surveyId/instructions', express.json(), requireAuth, async (req, res) => {
  res.set('Cache-Control', 'no-store');
  if (!req.body || !Object.prototype.hasOwnProperty.call(req.body, 'instructions')) {
    return res.status(400).json({ error: 'instructions_required', message: 'Instructions must be provided explicitly as a string or null.' });
  }
  if (!Object.prototype.hasOwnProperty.call(req.body, 'expectedInstructions')) {
    return res.status(400).json({ error: 'expected_instructions_required', message: 'The previously loaded instructions must be provided explicitly as a string or null.' });
  }
  try {
    res.json(await lifecycle.updateSurveyInstructions(pool, req.user, req.params.surveyId, req.body.instructions, req.body.expectedInstructions));
  } catch (error) {
    if (error instanceof TypeError && error.code) return res.status(400).json({ error: error.code, message: error.message });
    sendLifecycleError(res, error);
  }
});

app.get('/api/surveys/:surveyId/launch-readiness', requireAuth, async (req, res) => {
  try {
    const readiness = await lifecycle.getReadiness(pool, req.user, req.params.surveyId);
    if (process.env.SURVEY_DELIVERY_V2_ENABLED !== 'true') {
      readiness.blockers.push({ code: 'launch_disabled', message: 'Durable survey launch is not enabled.' });
      readiness.blockerCount = Number(readiness.blockerCount || 0) + 1;
      readiness.canLaunch = false;
    }
    res.json(readiness);
  }
  catch (error) { sendLifecycleError(res, error); }
});
app.get('/api/surveys/:surveyId/reminder-readiness', requireAuth, async (req, res) => {
  try {
    const readiness = await lifecycle.getReminderReadiness(pool, req.user, req.params.surveyId);
    if (process.env.SURVEY_DELIVERY_V2_ENABLED !== 'true') {
      readiness.blockers.push({code:'launch_disabled',message:'Durable survey delivery is not enabled.'});
      readiness.blockerCount += 1; readiness.canLaunch=false;
    }
    res.json(readiness);
  } catch(error) { sendLifecycleError(res,error); }
});
app.get('/api/surveys/:surveyId/reminder-templates', requireAuth, async (req,res)=>{
  try { res.json(await lifecycle.listReminderTemplates(pool,req.user,req.params.surveyId)); }
  catch(error){ sendLifecycleError(res,error); }
});
app.put('/api/surveys/:surveyId/reminder-templates/:language', express.json(), requireAuth, async (req,res)=>{
  try { res.json({template:await lifecycle.saveReminderTemplate(pool,req.user,req.params.surveyId,{...req.body,language:req.params.language})}); }
  catch(error){ sendLifecycleError(res,error); }
});
app.post('/api/surveys/:surveyId/launches', express.json(), requireAuth, async (req, res) => {
  if (process.env.SURVEY_DELIVERY_V2_ENABLED !== 'true') return res.status(503).json({ error: 'launch_disabled', message: 'Survey launch is temporarily disabled.' });
  try { launchResponse(res, await lifecycle.launchSurvey(pool, req.user, req.params.surveyId, { kind: req.body?.kind, idempotencyKey: req.get('Idempotency-Key') })); }
  catch (error) { sendLifecycleError(res, error); }
});
app.get('/api/surveys/:surveyId/launches', requireAuth, async (req, res) => {
  try { res.json({ launches: await lifecycle.listLaunches(pool, req.user, req.params.surveyId) }); }
  catch (error) { sendLifecycleError(res, error); }
});
app.get('/api/surveys/:surveyId/launches/:launchId', requireAuth, async (req, res) => {
  try { res.json({ launch: await lifecycle.listLaunches(pool, req.user, req.params.surveyId, req.params.launchId) }); }
  catch (error) { sendLifecycleError(res, error); }
});
app.get('/api/surveys/:surveyId/deliveries', requireAuth, async (req, res) => {
  try { res.json(await lifecycle.listDeliveries(pool, req.user, req.params.surveyId, req.query)); }
  catch (error) { sendLifecycleError(res, error); }
});
app.post('/api/surveys/:surveyId/close', express.json(), requireAuth, async (req, res) => {
  try { res.json(await lifecycle.transitionSurvey(pool, req.user, req.params.surveyId, 'close')); }
  catch (error) { sendLifecycleError(res, error); }
});
app.post('/api/surveys/:surveyId/reopen', express.json(), requireAuth, async (req, res) => {
  try { res.json(await lifecycle.transitionSurvey(pool, req.user, req.params.surveyId, 'reopen')); }
  catch (error) { sendLifecycleError(res, error); }
});

// Deprecated compatibility adapter. It uses a stable server business key and
// never performs provider I/O in the request.
app.post('/api/startSurvey', express.json(), requireAuth, async (req, res) => {
  if (process.env.LEGACY_START_ENABLED !== 'true' || process.env.SURVEY_DELIVERY_V2_ENABLED !== 'true') return res.status(503).json({ error: 'launch_disabled', message: 'Legacy survey launch is disabled.' });
  if (!req.body?.surveyName) return res.status(400).json({ message: 'Survey name is required.' });
  try {
    const survey = await resolveSurveyForUser(req, res, { surveyName: req.body.surveyName, allowedRoles: EDITOR_ROLES });
    if (!survey) return;
    launchResponse(res, await lifecycle.launchSurvey(pool, req.user, survey.id, { kind: 'initial', legacy: true }));
  } catch (error) { sendLifecycleError(res, error); }
});

const INVITATION_LANGUAGE_NAMES = new Map([
  ['en', 'English'], ['es', 'Spanish'], ['fr', 'French'], ['de', 'German'],
  ['it', 'Italian'], ['pt', 'Portuguese'], ['nl', 'Dutch'], ['pl', 'Polish'],
  ['ru', 'Russian'], ['ja', 'Japanese'], ['zh', 'Chinese'], ['ko', 'Korean'],
]);
for (const name of INVITATION_LANGUAGE_NAMES.values()) INVITATION_LANGUAGE_NAMES.set(name.toLowerCase(), name);

function normalizeInvitationLanguage(language) {
  const trimmed = typeof language === 'string' ? language.trim() : '';
  return INVITATION_LANGUAGE_NAMES.get(trimmed.toLowerCase()) || trimmed;
}

const SUPPORTED_INVITATION_LANGUAGES = new Set(INVITATION_LANGUAGE_NAMES.values());

function normalizeInvitationTemplates(templates) {
  if (!Array.isArray(templates) || templates.length === 0) {
    throw new Error('At least one invitation template is required.');
  }
  const normalized = templates.map(template => ({
    ...template,
    language: normalizeInvitationLanguage(template?.language),
  }));
  if (normalized.some(template => (
    !template || !SUPPORTED_INVITATION_LANGUAGES.has(template.language)
    || typeof template.text !== 'string'
    || template.text.length > 2555
    || (template.subject !== undefined && (
      typeof template.subject !== 'string' || !template.subject.trim() || template.subject.trim().length > 255
    ))
  ))) {
    throw new Error('Each invitation template requires a supported language and a body of 2555 characters or fewer; any included subject must be non-empty and 255 characters or fewer.');
  }
  if (new Set(normalized.map(template => template.language)).size !== normalized.length) {
    throw new Error('Invitation template languages must be unique.');
  }
  return normalized;
}

function parseInvitationTemplateCsv(csvData) {
  const parsed = Papa.parse(csvData, { header: true, skipEmptyLines: 'greedy', transformHeader: header => header.replace(/^\uFEFF/, '').trim() });
  if (parsed.errors.length > 0) {
    const firstError = parsed.errors[0];
    throw new Error(`Invalid CSV${firstError.row === undefined ? '' : ` on row ${firstError.row + 2}`}: ${firstError.message}`);
  }
  return parsed.data.map((row) => {
    const fields = Object.fromEntries(Object.entries(row).map(([key, value]) => [key.trim().toLowerCase(), value]));
    return {
      language: normalizeInvitationLanguage(fields.language ?? fields.language_code ?? ''),
      text: fields.text ?? fields.notification_text ?? '',
    };
  });
}

app.post('/api/updateEmails', express.json(), requireAuth, async (req, res) => {
  const data  = req.body;
  const surveyName = data.surveyName;
  const csvData = data.csvData;

  if (!surveyName) {
    res.status(400).json({ message: 'Survey name is required.' });
    return;
  }

  const templates = data.templates;
  if (!csvData && !Array.isArray(templates)) {
    res.status(400).json({ message: 'CSV data or invitation templates are required.' });
    return;
  }

  let emailTemplates;
  try {
    const suppliedTemplates = Array.isArray(templates) ? templates : parseInvitationTemplateCsv(csvData);
    emailTemplates = normalizeInvitationTemplates(suppliedTemplates);
  } catch (error) {
    return res.status(400).json({ message: error.message });
  }

  try {
    const survey = await resolveSurveyForUser(req, res, { surveyName, allowedRoles: EDITOR_ROLES });
    if (!survey) return;
    await lifecycle.withEditableSurvey(pool, req.user, survey.id, (client, lockedSurvey) => insertEmails(emailTemplates, lockedSurvey, client));
    res.status(200).json({ message: 'Email data updated successfully.' });
  } catch (error) {
    if (error instanceof lifecycle.LifecycleError) return sendLifecycleError(res, error);
    console.error('Error updating email templates:', error);
    res.status(500).json({ message: 'Failed to update email data.' });
  } 
});
app.patch('/api/surveys/:surveyId/respondents', express.json(), requireAuth, async (req, res) => {
  try {
    const result = await respondentRoster.mutateRoster(pool, req.user, req.params.surveyId, req.body || {});
    res.set('X-Roster-Revision', String(result.revision));
    res.status(200).json({ message: 'Respondent roster updated.', ...result });
  } catch (error) {
    if (error instanceof lifecycle.LifecycleError) return sendLifecycleError(res, error);
    console.error('Error updating respondent roster:', error);
    res.status(500).json({ error: 'roster_update_failed', message: 'Failed to update respondent roster.' });
  }
});

// The old single-row route renamed respondents by deleting and reinserting them.
// It is deliberately retired so no client can bypass stable-ID batch editing.
app.post('/api/updateTarget', requireAuth, (_req, res) => res.status(410).json({
  error: 'legacy_roster_edit_retired',
  message: 'Single-row respondent updates are no longer supported. Refresh the dashboard and save the roster as one batch.',
}));

app.put('/api/survey-notifications/:surveyId/subject', express.json(), requireAuth, async (req, res) => {
  const { language, subject } = req.body || {};
  if (typeof language !== 'string' || !language.trim() || typeof subject !== 'string' || !subject.trim()) {
    return res.status(400).json({ message: 'Language and invitation email subject are required.' });
  }
  if (subject.trim().length > 255) {
    return res.status(400).json({ message: 'Invitation email subject must be 255 characters or fewer.' });
  }

  try {
    const survey = await resolveSurveyForUser(req, res, {
      surveyName: req.params.surveyId,
      surveyId: UUID_RE.test(req.params.surveyId) ? req.params.surveyId : null,
      allowedRoles: EDITOR_ROLES,
    });
    if (!survey) return;
    const updated = await lifecycle.withEditableSurvey(pool, req.user, survey.id, (client, lockedSurvey) => client.query(
      `UPDATE EMAIL
       SET survey_id = $2, invitation_subject = $4
       WHERE (survey_id = $2 OR (survey_id IS NULL AND survey_name = $1))
         AND lang = $3
       RETURNING lang`,
      [lockedSurvey.name, lockedSurvey.id, language.trim(), subject.trim()]
    ));
    if (updated.rowCount === 0) {
      return res.status(404).json({ message: 'Create the invitation body for this language before setting its subject.' });
    }
    res.json({ message: 'Invitation email subject saved.' });
  } catch (error) {
    if (error instanceof lifecycle.LifecycleError) return sendLifecycleError(res, error);
    console.error('Failed to update invitation email subject:', error);
    res.status(500).json({ message: 'Failed to save invitation email subject.' });
  }
});

// GET API endpoint for retrieving email texts and available languages
app.get('/api/survey-notifications/:surveyId', requireAuth, async (req, res) => {
  const surveyId = req.params.surveyId;
  if (!surveyId) {
    res.status(400).json({ message: 'Survey ID is required.' });
    return;
  }

  const client = await pool.connect();

  try {
    const survey = await resolveSurveyForUser(req, res, { surveyName: surveyId, surveyId: UUID_RE.test(surveyId) ? surveyId : null, allowedRoles: ANALYST_ROLES });
    if (!survey) return;
    const query = `
      SELECT lang, text, invitation_subject
      FROM EMAIL
      WHERE ${legacySurveyPredicate()}
    `;

    const result = await client.query(query, [survey.id, survey.name]);

    const notifications = {};
    const notificationSubjects = {};
    for (const row of result.rows) {
      notifications[row.lang] = row.text;
      notificationSubjects[row.lang] = row.invitation_subject;
    }

    res.status(200).json({ notifications, notificationSubjects });
  } catch (error) {
    console.error('Error retrieving email texts:', error);
    res.status(500).json({ message: 'Failed to retrieve email texts.' });
  } finally {
    client.release();
  }
});

// CSV imports are additions only: mutable names must never select an existing
// respondent. Occupied names are rejected by complete-roster validation.
app.post('/api/updateTargets', express.json(), requireAuth, async (req, res) => {
  try {
    const { surveyName, csvData, expectedRevision } = req.body || {};
    if (!surveyName) return res.status(400).json({ error: 'survey_required', message: 'Survey identifier is required.' });
    const additions = respondentRoster.parseRespondentCsv(csvData);
    const survey = await resolveSurveyForUser(req, res, { surveyName, allowedRoles: EDITOR_ROLES });
    if (!survey) return;
    const result = await respondentRoster.mutateRoster(pool, req.user, survey.id, { expectedRevision, additions });
    res.set('X-Roster-Revision', String(result.revision));
    res.status(200).json({ message: 'Respondents imported successfully.', ...result, processedCount: additions.length });
  } catch (error) {
    if (error instanceof lifecycle.LifecycleError) return sendLifecycleError(res, error);
    console.error('Error importing respondent CSV:', error);
    res.status(500).json({ error: 'roster_import_failed', message: 'Failed to import respondent CSV.' });
  }
});


// PUT API endpoint for uploading a json file of questions
const EXACT_QUESTION_REFERENCE_PROPERTIES = new Set([
  'choicesFromQuestion',
  // Survey-level set-value/run-expression/copy-value triggers.
  'setToName',
  'fromName',
]);
const SPECIAL_DOTTED_REFERENCE_ROOTS = SURVEYJS_RESERVED_EXPRESSION_ROOTS;

function rewriteSurveyExpressions(value, nameMap, propertyName = '') {
  if (typeof value === 'string') {
    // Some SurveyJS references are exact question names rather than expressions.
    // Rewrite them from the original map in one pass for collision-safe reorders.
    if (EXACT_QUESTION_REFERENCE_PROPERTIES.has(propertyName)) {
      return nameMap.get(value) || value;
    }
    // Only rewrite expression-bearing properties; titles and choice labels are data.
    if (!/(If$|Expression$|^expression$)/.test(propertyName)) return value;
    // Replace complete SurveyJS references from the original map in one pass so
    // assigned names can never cascade through a second replacement.
    return value.replace(/\{([^{}]+)\}/g, (match, reference) => {
      const dotIndex = reference.indexOf('.');
      const root = dotIndex === -1 ? reference : reference.slice(0, dotIndex);
      if (!nameMap.has(root) ||
          (dotIndex !== -1 && SPECIAL_DOTTED_REFERENCE_ROOTS.has(root.toLowerCase()))) return match;
      const suffix = dotIndex === -1 ? '' : reference.slice(dotIndex);
      return `{${nameMap.get(root)}${suffix}}`;
    });
  }
  if (Array.isArray(value)) return value.map((item) => rewriteSurveyExpressions(item, nameMap, propertyName));
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, rewriteSurveyExpressions(item, nameMap, key)]));
}

// Preserve canonical identities and assign monotonically increasing identities to
// imported/new questions. In particular, never renumber questions or reuse a gap
// merely because elements were reordered, inserted, or deleted.
function normalizeQuestionNames(json, {
  minimumNextQuestionNumber = 1n,
  preserveCanonicalNames,
  currentCanonicalNames,
  persistedNextQuestionNumber,
} = {}) {
  const validated = validateSurveyDefinition(json);
  const canonicalName = /^question_([1-9]\d*)$/;
  let minimumNext;
  try {
    minimumNext = BigInt(minimumNextQuestionNumber);
  } catch {
    throw new Error('minimumNextQuestionNumber must be a positive integer.');
  }
  if (minimumNext < 1n || String(minimumNextQuestionNumber).trim() !== minimumNext.toString()) {
    throw new Error('minimumNextQuestionNumber must be a positive integer.');
  }
  const effectivePersistedCounter = persistedNextQuestionNumber === undefined
    ? validated.claNextQuestionNumber
    : persistedNextQuestionNumber;
  let persistedMinimum = 1n;
  if (effectivePersistedCounter !== undefined) {
    if (!Number.isSafeInteger(effectivePersistedCounter) || effectivePersistedCounter < 1) {
      throw new Error('claNextQuestionNumber must be a positive safe integer.');
    }
    persistedMinimum = BigInt(effectivePersistedCounter);
  }

  // Without this option, retain the legacy direct-call behavior of trusting
  // canonical names. Updates always supply the persisted schema's names.
  const suppliedCanonicalNames = currentCanonicalNames ?? preserveCanonicalNames;
  let canonicalNamesToPreserve = null;
  if (suppliedCanonicalNames !== undefined) {
    if (typeof suppliedCanonicalNames === 'string' || !suppliedCanonicalNames?.[Symbol.iterator]) {
      throw new Error('currentCanonicalNames must be an iterable of canonical question names.');
    }
    canonicalNamesToPreserve = new Set(
      [...suppliedCanonicalNames].filter((name) => typeof name === 'string' && canonicalName.test(name))
    );
  }

  const reservedCanonicalNames = canonicalNamesToPreserve || new Set(
    validated.elements.map(({ name }) => name).filter((name) => canonicalName.test(name))
  );
  const currentMaximum = [...reservedCanonicalNames].reduce((maximum, name) => {
    const number = BigInt(canonicalName.exec(name)[1]);
    return number > maximum ? number : maximum;
  }, 0n);
  let nextQuestionNumber = [currentMaximum + 1n, minimumNext, persistedMinimum]
    .reduce((maximum, candidate) => candidate > maximum ? candidate : maximum, 1n);
  const nameMap = new Map(validated.elements.map((element) => {
    if (canonicalName.test(element.name) && reservedCanonicalNames.has(element.name)) {
      return [element.name, element.name];
    }
    while (reservedCanonicalNames.has(`question_${nextQuestionNumber}`)) nextQuestionNumber += 1n;
    const assignedName = `question_${nextQuestionNumber}`;
    reservedCanonicalNames.add(assignedName);
    nextQuestionNumber += 1n;
    return [element.name, assignedName];
  }));
  if (nextQuestionNumber > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error('claNextQuestionNumber exceeds the supported safe integer range.');
  }
  return {
    ...rewriteSurveyExpressions(validated, nameMap),
    claNextQuestionNumber: Number(nextQuestionNumber),
    elements: validated.elements.map((element) => ({
      ...rewriteSurveyExpressions(element, nameMap),
      name: nameMap.get(element.name)
    }))
  };
}

app.post('/api/updateQuestions', express.json(), requireAuth, async (req, res) => {
  const data  = req.body;
  const surveyQuestions = data.questions;
  const surveyName = data.surveyName;

  const survey = await resolveSurveyForUser(req, res, { surveyName, allowedRoles: EDITOR_ROLES });
  if (!survey) return;

  try {
    let submittedQuestions;
    let title = '';
    if (typeof surveyQuestions === 'string') {
      // Compatibility import: absent Required remains required, matching legacy CSV behavior.
      const surveyData = csvToJson(surveyQuestions);
      submittedQuestions = surveyData.questions;
      title = surveyData.title;
    } else if (typeof surveyQuestions === 'object' && surveyQuestions !== null) {
      submittedQuestions = surveyQuestions;
    } else {
      return res.status(400).json({ message: 'Invalid questions format.' });
    }
    // Reject malformed definitions before taking the lifecycle write lock; the
    // same definition is normalized again inside the transaction.
    validateSurveyDefinition(submittedQuestions);

    const savedQuestions = await lifecycle.withEditableSurvey(pool, req.user, survey.id, async (client, lockedSurvey) => {
      const historicalMaximumResult = await client.query(
        `SELECT COALESCE(MAX((matched.parts[1])::numeric), 0)::text AS max_question_number
         FROM Respondent r
         CROSS JOIN LATERAL jsonb_object_keys(CASE WHEN jsonb_typeof(r.response) = 'object' THEN r.response ELSE '{}'::jsonb END) AS response_key(key)
         CROSS JOIN LATERAL regexp_match(response_key.key, '^question_([1-9][0-9]*)$') AS matched(parts)
         WHERE ${legacySurveyPredicate('r')}`,
        [lockedSurvey.id, lockedSurvey.name]
      );
      const historicalMaximum = BigInt(historicalMaximumResult.rows[0]?.max_question_number || 0);
      const currentCanonicalNames = new Set((lockedSurvey.questions?.elements || []).map((question) => question?.name).filter((name) => typeof name === 'string' && /^question_[1-9]\d*$/.test(name)));
      const normalized = normalizeQuestionNames(submittedQuestions, {
        minimumNextQuestionNumber: historicalMaximum + 1n,
        currentCanonicalNames,
        persistedNextQuestionNumber: Object.prototype.hasOwnProperty.call(lockedSurvey.questions || {}, 'claNextQuestionNumber') ? lockedSurvey.questions.claNextQuestionNumber : 1,
      });
      await insertQuestions(lockedSurvey.name, title, normalized, lockedSurvey.id, client);
      return normalized;
    });
    res.status(200).json({ message: 'Questions created successfully.', questions: savedQuestions });
  } catch (error) {
    if (error instanceof lifecycle.LifecycleError) return sendLifecycleError(res, error);
    res.status(400).json({ message: error.message || 'Invalid questions schema.' });
  }
});

// PUT API endpoint for answer submission
app.post('/api/user', express.json(), respondentRateLimiter, async (req, res) => {
  let client;
  let committed = false;
  try {
    const data = req.body;
    const userId = data.userId;
    const surveyName = data.surveyName;
    // Cheap denial avoids reserving a connection for invalid public traffic;
    // authorization is repeated under the lifecycle lock before any write.
    const preliminary = await validateRespondentToken(surveyName, userId);
    if (!preliminary.ok) return res.status(preliminary.status).json({ message: preliminary.message });
    let answers;
    try {
      answers = JSON.parse(data.answers);
    } catch {
      return res.status(400).json({ message: 'Answers must be valid JSON.' });
    }
    if (!answers || typeof answers !== 'object' || Array.isArray(answers)) {
      return res.status(400).json({ message: 'Invalid survey responses.', errors: ['Answers must be an object.'] });
    }
    client = await pool.connect();
    await client.query('BEGIN');
    // Serialize response completion with reminder snapshot/provider boundaries.
    // The survey ID comes only from the server-authoritative preliminary lookup;
    // token authorization is repeated after taking the boundary lock.
    await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, [`survey-provider-boundary:${preliminary.respondent.survey_id}`]);
    const validation = await validateRespondentToken(surveyName, userId, client, true);
    if (!validation.ok) return res.status(validation.status).json({ message: validation.message });

    const schemaResult = await client.query(
      validation.respondent.survey_id
        ? 'SELECT questions FROM Survey WHERE id = $1'
        : 'SELECT questions FROM Survey WHERE name = $1',
      [validation.respondent.survey_id || surveyName]
    );
    if (schemaResult.rows.length === 0) {
      return res.status(404).json({ message: 'Survey not found.' });
    }
    const schema = schemaResult.rows[0].questions;
    let lazyTagboxChoices;
    const requestedLazyTagboxValues = new Set();
    if (Array.isArray(schema?.elements)) {
      const choiceModel = new Model(schema);
      choiceModel.data = answers;
      schema.elements.forEach((element) => {
        if (element?.type !== 'tagbox' || element.choicesLazyLoadEnabled !== true) return;
        const submitted = answers[element.name];
        if (!Array.isArray(submitted)) return;
        const configuredChoices = modelChoiceValues(choiceModel.getQuestionByName(element.name), element) || [];
        submitted.forEach((value) => {
          // Respondent-backed choices are exact strings. Primitive local/model
          // choices are already trusted and must not trigger a database lookup.
          if (typeof value === 'string' && !configuredChoices.includes(value)) {
            requestedLazyTagboxValues.add(value);
          }
        });
      });
    }
    if (requestedLazyTagboxValues.size > 0) {
      const requestedValues = [...requestedLazyTagboxValues];
      const choicesResult = await client.query(
        `SELECT r.name, r.contact_info
         FROM Respondent r
         WHERE ${legacySurveyPredicate('r')}
           AND ${displayedRespondentPredicate('r')}
           AND r.uuid != $3
           AND CONCAT(COALESCE(r.name, ''), ' (', COALESCE(r.contact_info, ''), ')') = ANY($4::text[])`,
        [validation.respondent.survey_id, surveyName, userId, requestedValues]
      );
      lazyTagboxChoices = new Set(choicesResult.rows.map(formatRespondentChoice));
    }
    const answerErrors = validateRequiredAnswers(schema, answers, { lazyTagboxChoices });
    if (answerErrors.length > 0) {
      return res.status(400).json({ message: 'Invalid survey responses.', errors: answerErrors });
    }
    const answerTimeStamp = new Date().toLocaleString();
    answers.timeStamp = answerTimeStamp;

    const updateResult = await client.query('UPDATE respondent SET response=$1 WHERE uuid=$2 AND survey_id=$3', [answers, userId, validation.respondent.survey_id]);
    if (!updateResult.rowCount) throw new Error('No matching respondent found for survey.');
    await client.query('COMMIT');
    committed = true;
    res.status(200).json({ success: true });
  } catch (error) {
    console.error('Error submitting response:', error);
    res.status(500).json({ message: 'Failed to submit response.' });
  } finally {
    if (client && !committed) await client.query('ROLLBACK').catch(() => {});
    if (client) client.release();
  }
});

// Authenticated dashboard preview endpoint for lazy loading respondent choices.
app.get('/api/admin/names', requireAuth, async (req, res) => {
  const { skip = 0, take = 10, filter = '', surveyName = '' } = req.query;

  if (!surveyName || surveyName === 'undefined' || surveyName === 'null') {
    return res.status(400).json({ message: 'Survey name is required.' });
  }

  const client = await pool.connect();

  try {
    const survey = await resolveSurveyForUser(req, res, { surveyName, allowedRoles: ANALYST_ROLES });
    if (!survey) return;
    const query = `
      SELECT r.name, r.contact_info, COUNT(*) OVER() AS total_count
      FROM Respondent r
      WHERE ${legacySurveyPredicate('r')}
      AND ${displayedRespondentPredicate('r')}
      AND (r.name ILIKE $3 OR r.contact_info ILIKE $3)
      ORDER BY r.name
      OFFSET $4
      LIMIT $5;
    `;

    const result = await client.query(query, [survey.id, survey.name, `%${filter}%`, skip, take]);
    const filteredNames = result.rows.map(user => `${user.name} (${user.contact_info})`);
    const total = result.rows.length > 0 ? Number(result.rows[0].total_count) : 0;

    res.status(200).json({
      names: filteredNames,
      total: Number.isFinite(total) && total >= 0 ? total : filteredNames.length
    });
  } catch (error) {
    console.error('Error fetching admin preview names:', error);
    res.status(500).json({ error: 'Failed to fetch names' });
  } finally {
    client.release();
  }
});

function formatRespondentChoice(respondent) {
  return `${respondent.name ?? ''} (${respondent.contact_info ?? ''})`;
}

// GET API endpoint for lazy loading the names list
app.get('/api/names', respondentRateLimiter, async (req, res) => {
  const { skip = 0, take = 10, filter = '', surveyName = '', userId = '', demoToken = '' } = req.query;
  const parsedSkip = Number(skip);
  const parsedTake = Number(take);
  if (
    !Number.isInteger(parsedSkip)
    || parsedSkip < 0
    || !Number.isInteger(parsedTake)
    || parsedTake < 1
  ) {
    return res.status(400).json({ message: 'Invalid pagination parameters.' });
  }
  const safeTake = Math.min(parsedTake, 100);

  let client;
  try {
    const demoClaims = demoToken ? verifyDemoToken(demoToken) : null;
    if (demoToken && (!demoClaims || demoClaims.surveyName !== surveyName)) {
      return res.status(403).json({ message: 'This demo link is invalid or has expired.' });
    }
    if (demoClaims) {
      const activeSurvey = await pool.query(
        'SELECT 1 FROM Survey WHERE id = $1 AND name = $2 AND archived_at IS NULL',
        [demoClaims.surveyId, demoClaims.surveyName]
      );
      if (activeSurvey.rows.length === 0) {
        return res.status(404).json({ message: 'Survey not found.' });
      }
    }

    const validation = demoClaims ? null : await validateRespondentToken(surveyName, userId);
    if (validation && !validation.ok) {
      return res.status(validation.status).json({ message: validation.message });
    }

    const surveyId = demoClaims?.surveyId || validation.respondent.survey_id;
    client = await pool.connect();
    const query = `
      SELECT r.name, r.contact_info, COUNT(*) OVER() AS total_count
      FROM Respondent r
      WHERE ${legacySurveyPredicate('r')}
      AND ${displayedRespondentPredicate('r')}
      AND ($3::text IS NULL OR r.uuid != $3)
      AND (r.name ILIKE $4 OR r.contact_info ILIKE $4)
      ORDER BY r.name
      OFFSET $5
      LIMIT $6;
    `;

    const values = [surveyId, surveyName, demoClaims ? null : userId, `%${filter}%`, parsedSkip, safeTake];
    const result = await client.query(query, values);
    const filteredNames = result.rows.map(formatRespondentChoice);
    const total = result.rows.length > 0 ? Number(result.rows[0].total_count) : 0;

    res.status(200).json({
      names: filteredNames,
      total: Number.isFinite(total) && total >= 0 ? total : filteredNames.length
    });
  } catch (error) {
    console.error('Error fetching names:', error);
    res.status(500).json({ error: 'Failed to fetch names' });
  } finally {
    client?.release();
  }
});

// GET API list questions for dashboard
app.get('/api/listQuestions', requireAuth, async (req, res) => {
  const { surveyName = '' } = req.query;

  if(surveyName === '' || surveyName === 'undefined' || surveyName === null || surveyName === 'null') {
    res.status(404).json({ message: 'Survey name not found.' });
    return;
  }

  // NEW DB CODE
  const client = await pool.connect();

  const survey = await resolveSurveyForUser(req, res, { surveyName, allowedRoles: READ_SURVEY_ROLES });
  if (!survey) { client.release(); return; }

  // Query the database for json question data
  Promise.resolve({ rows: [survey] })
    .then(result => {
      const elements = result.rows[0]?.questions?.elements || [];
      const questions = elements.map((q, index) => {
        const rawName = typeof q?.name === 'string' ? q.name.trim() : '';
        const safeName = rawName || `q_${index + 1}`; // fallback so UI doesn’t crash; persisted on next save
        const title = typeof q?.title === 'string' ? q.title : (safeName || `Question ${index + 1}`);
        return {
          id: String(index + 1), // keep legacy id non-breaking
          name: safeName, // canonical key
          text: title,
          type: q?.type,
          required: q?.isRequired === true,
          max: q?.maxSelectedChoices ? q.maxSelectedChoices : null,
          order: index + 1,
        };
      });
      res.status(200).json({ questions });
    })
    .catch(error => {
      console.error(error);
      res.status(500).json({ error: 'Failed to fetch questions' });
    })
    .finally(() => {
      client.release();

  });
});


// Authenticated dashboard preview endpoint for full SurveyJS question JSON.
app.get('/api/admin/questions', requireAuth, async (req, res) => {
  const { surveyName = '' } = req.query;

  if (!surveyName || surveyName === 'undefined' || surveyName === 'null') {
    return res.status(400).json({ message: 'Survey name is required.' });
  }

  const client = await pool.connect();

  try {
    const survey = await resolveSurveyForUser(req, res, { surveyName, allowedRoles: READ_SURVEY_ROLES });
    if (!survey) return;

    res.status(200).json({ title: survey.title, questions: survey.questions });
  } catch (error) {
    console.error('Error fetching admin survey questions:', error);
    res.status(500).json({ message: 'Failed to fetch survey questions.' });
  } finally {
    client.release();
  }
});

// GET API endpoint for survey questions
app.get('/api/questions', respondentRateLimiter, async (req, res) => {
  const { surveyName = '', userId = '', demoToken = '' } = req.query;

  const demoClaims = demoToken ? verifyDemoToken(demoToken) : null;
  if (demoToken && (!demoClaims || demoClaims.surveyName !== surveyName)) {
    return res.status(403).json({ message: 'This demo link is invalid or has expired.' });
  }
  const validation = demoClaims ? null : await validateRespondentToken(surveyName, userId);
  if (validation && !validation.ok) {
    return res.status(validation.status).json({ message: validation.message });
  }

  const surveyId = demoClaims?.surveyId || validation.respondent.survey_id;
  let client;

  try {
    client = await pool.connect();
    const query = `
      SELECT questions, title, name, instructions
      FROM Survey
      WHERE (id = $1 OR ($1::uuid IS NULL AND name = $2))
        AND archived_at IS NULL;
    `;

    const result = await client.query(query, [surveyId, surveyName]);
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Survey not found.' });
    }

    res.set('Cache-Control', 'no-store');
    res.status(200).json({
      title: result.rows[0].title,
      instructions: effectiveInstructions(result.rows[0].instructions, result.rows[0].name, result.rows[0].title),
      questions: demoClaims
        ? prepareSurveyForDemo(result.rows[0].questions)
        : result.rows[0].questions,
    });
  } catch (error) {
    console.error('Error fetching survey questions:', error);
    res.status(500).json({ message: 'Failed to fetch survey questions.' });
  } finally {
    client?.release();
  }
});

// GET API endpoint for survey results
app.get('/api/results', requireAuth, async (req, res) => {
  const { surveyName = '' } = req.query;
  

  // NEW DB CODE
  const client = await pool.connect();
  

  const survey = await resolveSurveyForUser(req, res, { surveyName, allowedRoles: ANALYST_ROLES });
  if (!survey) { client.release(); return; }

  const query = `SELECT name, can_respond, response FROM Respondent WHERE ${legacySurveyPredicate()}`;
  const values = [survey.id, survey.name];
  client.query(query, values)
    .then(response => {
        const responses = response.rows.reduce((combined, row) => {
          if (row.response === null) return combined;
          return {...combined, [row.name]: row.response};
        }, {});
        const users = response.rows.map(row => {
          return {name: row.name, isRespondent: row.can_respond}
        });
        console.log(users);
        res.status(200).json({responses, users});
    })
    .catch(e => console.error(e.stack))
    .finally(() => client.release());

});

// GET API endpoint for a list of survey targets and the status of their responses
app.get('/api/targets', requireAuth, async (req, res) => {
  const { surveyName = '' } = req.query;
  let client;
  try {
    client = await pool.connect();
    await client.query('BEGIN');
    const survey = await resolveSurveyForUser(req, res, {
      surveyName,
      allowedRoles: ANALYST_ROLES,
      queryable: client,
      lock: 'SHARE',
    });
    if (!survey) {
      await client.query('ROLLBACK');
      return;
    }
    const query = `SELECT r.name, r.contact_info, r.respondent_id, r.can_respond, r.lang, r.response IS NULL AS response_status,
                   r.email_sent, d.status AS email_status, d.provider_outcome, d.provider_outcome_at, a.started_at AS last_email_attempt
                 FROM Respondent r
                 LEFT JOIN LATERAL (SELECT status,id,
                   CASE WHEN provider_complained_at IS NOT NULL THEN 'complained' WHEN provider_bounced_at IS NOT NULL THEN 'bounced' WHEN provider_suppressed_at IS NOT NULL THEN 'suppressed' WHEN provider_failed_at IS NOT NULL THEN 'failed' WHEN provider_delivered_at IS NOT NULL THEN 'delivered' WHEN provider_delayed_at IS NOT NULL THEN 'delayed' WHEN provider_sent_at IS NOT NULL THEN 'sent' WHEN status='accepted' THEN 'accepted_unverified' ELSE NULL END AS provider_outcome,
                   CASE WHEN provider_complained_at IS NOT NULL THEN provider_complained_at WHEN provider_bounced_at IS NOT NULL THEN provider_bounced_at WHEN provider_suppressed_at IS NOT NULL THEN provider_suppressed_at WHEN provider_failed_at IS NOT NULL THEN provider_failed_at WHEN provider_delivered_at IS NOT NULL THEN provider_delivered_at WHEN provider_delayed_at IS NOT NULL THEN provider_delayed_at WHEN provider_sent_at IS NOT NULL THEN provider_sent_at ELSE dispatch_accepted_at END AS provider_outcome_at
                   FROM survey_email_deliveries WHERE respondent_id=r.respondent_id AND survey_id=r.survey_id ORDER BY created_at DESC LIMIT 1) d ON true
                 LEFT JOIN LATERAL (SELECT started_at FROM survey_email_attempts WHERE delivery_id=d.id ORDER BY attempt_number DESC LIMIT 1) a ON true
                 WHERE ${legacySurveyPredicate('r')}`;
    const response = await client.query(query, [survey.id, survey.name]);
    const respondents = response.rows.filter((row) => !isLegacyPlaceholderRespondent(row)).map((row) => ({
      id: row.respondent_id,
      name: row.name,
      email: row.contact_info,
      language: row.lang,
      canRespond: row.can_respond,
      status: row.response_status ? 'Incomplete' : 'Complete',
      responseStatus: row.response_status ? 'incomplete' : 'complete',
      emailStatus: row.email_status || (row.email_sent ? 'legacy_assumed_accepted' : 'not_queued'),
      dispatchStatus: row.email_status || (row.email_sent ? 'legacy_assumed_accepted' : 'not_queued'),
      providerOutcome: row.provider_outcome || (row.email_sent ? 'accepted_unverified' : null),
      providerOutcomeAt: row.provider_outcome_at || null,
      lastEmailAttempt: row.last_email_attempt || null,
    }));
    await client.query('COMMIT');
    res.set('X-Roster-Revision', String(Number(survey.lifecycle_version) || 0));
    res.status(200).json(respondents);
  } catch (error) {
    if (client) await client.query('ROLLBACK').catch(() => {});
    console.error(error);
    if (!res.headersSent) res.status(500).json({ message: 'Failed to retrieve survey targets.' });
  } finally {
    client?.release();
  }
});

// GET API endpoint for a list of current surveys
app.get('/api/surveys', requireAuth, async (req, res) => {
  // NEW DB CODE
  let client;
  try { client = await pool.connect(); }
  catch (error) {
    console.error(error);
    return res.status(500).json({ message: 'Failed to retrieve surveys.' });
  }

  const query = (isPlatformAdmin(req.user) ? `
  SELECT s.id, s.name, s.organization_id, o.name AS organization_name,
         'owner'::text AS role,
         s.creation_date, s.lifecycle_status, s.started_at, s.closed_at,
         COALESCE(starter.display_name, starter.username) AS started_by_name,
         (SELECT jsonb_build_object(
           'id', l.id, 'kind', l.kind, 'targetCount', count(d.id),
           'pendingCount', count(*) FILTER (WHERE d.status IN ('pending','reminder_pending')),
           'leasedCount', count(*) FILTER (WHERE d.status IN ('leased','reminder_leased')),
           'retryWaitCount', count(*) FILTER (WHERE d.status IN ('retry_wait','reminder_retry_wait')),
           'acceptedCount', count(*) FILTER (WHERE d.status='accepted'),
           'failedCount', count(*) FILTER (WHERE d.status='failed'),
           'uncertainCount', count(*) FILTER (WHERE d.status='uncertain'),
           'cancelledCount', count(*) FILTER (WHERE d.status='cancelled'),
           'providerSentCount', count(*) FILTER (WHERE d.provider_sent_at IS NOT NULL),
           'providerDeliveredCount', count(*) FILTER (WHERE d.provider_delivered_at IS NOT NULL),
           'providerDelayedCount', count(*) FILTER (WHERE d.provider_delayed_at IS NOT NULL),
           'providerBouncedCount', count(*) FILTER (WHERE d.provider_bounced_at IS NOT NULL),
           'providerComplainedCount', count(*) FILTER (WHERE d.provider_complained_at IS NOT NULL),
           'providerSuppressedCount', count(*) FILTER (WHERE d.provider_suppressed_at IS NOT NULL),
           'providerFailedCount', count(*) FILTER (WHERE d.provider_failed_at IS NOT NULL),
           'providerProblemCount', count(*) FILTER (WHERE d.provider_bounced_at IS NOT NULL OR d.provider_complained_at IS NOT NULL OR d.provider_suppressed_at IS NOT NULL OR d.provider_failed_at IS NOT NULL),
           'providerWaitingCount', count(*) FILTER (WHERE d.status='accepted' AND d.provider_delivered_at IS NULL AND d.provider_bounced_at IS NULL AND d.provider_complained_at IS NULL AND d.provider_suppressed_at IS NULL AND d.provider_failed_at IS NULL),
           'acceptedUnverifiedCount', count(*) FILTER (WHERE d.status='accepted' AND d.provider_sent_at IS NULL AND d.provider_delivered_at IS NULL AND d.provider_delayed_at IS NULL AND d.provider_bounced_at IS NULL AND d.provider_complained_at IS NULL AND d.provider_suppressed_at IS NULL AND d.provider_failed_at IS NULL)
         ) FROM survey_launches l JOIN survey_email_deliveries d ON d.launch_id=l.id WHERE l.survey_id=s.id GROUP BY l.id,l.created_at ORDER BY l.created_at DESC LIMIT 1) AS latest_launch,
         COUNT(r.respondent_id) AS number_of_respondents,
         COUNT(r.respondent_id) FILTER (WHERE r.can_respond IS TRUE) AS eligible_respondent_count,
         COUNT(r.respondent_id) FILTER (WHERE r.can_respond IS TRUE AND r.response IS NOT NULL) AS completed_response_count,
         COALESCE(jsonb_array_length(s.questions->'elements'), 0) AS number_of_questions
  FROM Survey s
  LEFT JOIN organizations o ON o.id = s.organization_id
  LEFT JOIN users starter ON starter.id = s.started_by_user_id
  LEFT JOIN Respondent r ON (r.survey_id = s.id OR (r.survey_id IS NULL AND r.survey_name = s.name))
  WHERE s.archived_at IS NULL
  GROUP BY s.id, s.name, s.organization_id, o.name, starter.display_name, starter.username, s.creation_date, s.questions, s.lifecycle_status, s.started_at, s.closed_at
  ORDER BY s.creation_date DESC NULLS LAST
  ` : `
  SELECT s.id, s.name, s.organization_id, o.name AS organization_name,
         om.role,
         s.creation_date, s.lifecycle_status, s.started_at, s.closed_at,
         COALESCE(starter.display_name, starter.username) AS started_by_name,
         (SELECT jsonb_build_object(
           'id', l.id, 'kind', l.kind, 'targetCount', count(d.id),
           'pendingCount', count(*) FILTER (WHERE d.status IN ('pending','reminder_pending')),
           'leasedCount', count(*) FILTER (WHERE d.status IN ('leased','reminder_leased')),
           'retryWaitCount', count(*) FILTER (WHERE d.status IN ('retry_wait','reminder_retry_wait')),
           'acceptedCount', count(*) FILTER (WHERE d.status='accepted'),
           'failedCount', count(*) FILTER (WHERE d.status='failed'),
           'uncertainCount', count(*) FILTER (WHERE d.status='uncertain'),
           'cancelledCount', count(*) FILTER (WHERE d.status='cancelled'),
           'providerSentCount', count(*) FILTER (WHERE d.provider_sent_at IS NOT NULL),
           'providerDeliveredCount', count(*) FILTER (WHERE d.provider_delivered_at IS NOT NULL),
           'providerDelayedCount', count(*) FILTER (WHERE d.provider_delayed_at IS NOT NULL),
           'providerBouncedCount', count(*) FILTER (WHERE d.provider_bounced_at IS NOT NULL),
           'providerComplainedCount', count(*) FILTER (WHERE d.provider_complained_at IS NOT NULL),
           'providerSuppressedCount', count(*) FILTER (WHERE d.provider_suppressed_at IS NOT NULL),
           'providerFailedCount', count(*) FILTER (WHERE d.provider_failed_at IS NOT NULL),
           'providerProblemCount', count(*) FILTER (WHERE d.provider_bounced_at IS NOT NULL OR d.provider_complained_at IS NOT NULL OR d.provider_suppressed_at IS NOT NULL OR d.provider_failed_at IS NOT NULL),
           'providerWaitingCount', count(*) FILTER (WHERE d.status='accepted' AND d.provider_delivered_at IS NULL AND d.provider_bounced_at IS NULL AND d.provider_complained_at IS NULL AND d.provider_suppressed_at IS NULL AND d.provider_failed_at IS NULL),
           'acceptedUnverifiedCount', count(*) FILTER (WHERE d.status='accepted' AND d.provider_sent_at IS NULL AND d.provider_delivered_at IS NULL AND d.provider_delayed_at IS NULL AND d.provider_bounced_at IS NULL AND d.provider_complained_at IS NULL AND d.provider_suppressed_at IS NULL AND d.provider_failed_at IS NULL)
         ) FROM survey_launches l JOIN survey_email_deliveries d ON d.launch_id=l.id WHERE l.survey_id=s.id GROUP BY l.id,l.created_at ORDER BY l.created_at DESC LIMIT 1) AS latest_launch,
         COUNT(r.respondent_id) AS number_of_respondents,
         COUNT(r.respondent_id) FILTER (WHERE r.can_respond IS TRUE) AS eligible_respondent_count,
         COUNT(r.respondent_id) FILTER (WHERE r.can_respond IS TRUE AND r.response IS NOT NULL) AS completed_response_count,
         COALESCE(jsonb_array_length(s.questions->'elements'), 0) AS number_of_questions
  FROM Survey s
  JOIN organization_memberships om ON om.organization_id = s.organization_id AND om.user_id = $1
  LEFT JOIN organizations o ON o.id = s.organization_id
  LEFT JOIN users starter ON starter.id = s.started_by_user_id
  LEFT JOIN Respondent r ON (r.survey_id = s.id OR (r.survey_id IS NULL AND r.survey_name = s.name))
  WHERE s.archived_at IS NULL
  GROUP BY s.id, s.name, s.organization_id, o.name, om.role, starter.display_name, starter.username, s.creation_date, s.questions, s.lifecycle_status, s.started_at, s.closed_at
  ORDER BY s.creation_date DESC NULLS LAST
  `).replace('COUNT(r.respondent_id) AS number_of_respondents', `${displayedRespondentCountExpression('r')} AS number_of_respondents`);

  client.query(query, isPlatformAdmin(req.user) ? [] : [req.user.id])
    .then(result => {
      const surveys = result.rows.map((row) => {
        const responseSummary = surveyResponseSummary(row.eligible_respondent_count, row.completed_response_count);
        return {
          id: row.id,
          name: row.name,
          organizationId: row.organization_id,
          organizationName: row.organization_name,
          role: row.role,
          respondents: surveySummaryRespondentCount(row.number_of_respondents),
          eligibleRespondents: responseSummary.eligibleCount,
          completedResponses: responseSummary.completedCount,
          responseRatePercent: responseSummary.responseRatePercent,
          questions: row.number_of_questions + "",
          date: row.creation_date,
          lifecycleStatus: row.lifecycle_status,
          startedAt: row.started_at,
          startedByName: row.started_by_name,
          closedAt: row.closed_at,
          latestLaunch: row.latest_launch,
        };
      });
      // Process the returned JSON data
      res.status(200).json({ surveys });
    })
    .catch(error => {
      console.error(error);
      if (!res.headersSent) res.status(500).json({ message: 'Failed to retrieve surveys.' });
    })
    .finally(() => client.release());
});

// GET API endpoint for status of survey creation
app.get('/api/surveyStatus', requireAuth, async (req, res) => {
  const { surveyName = '' } = req.query;

  if(surveyName === '' || surveyName === 'undefined' || surveyName === null || surveyName === 'null') {
    res.status(404).json({ message: 'Survey name not found.' });
    return;
  }
  const client = await pool.connect();

  const survey = await resolveSurveyForUser(req, res, { surveyName, allowedRoles: READ_SURVEY_ROLES });
  if (!survey) { client.release(); return; }

  // NEW DB CODE
  const query = `
  SELECT ${displayedRespondentCountExpression('r')} AS number_of_respondents
  FROM Respondent r
  WHERE ${legacySurveyPredicate('r')};
  `;


  const values = [survey.id, survey.name];

  client.query(query, values)
    .then(result => {
      const number_of_respondents = result.rows[0]?.number_of_respondents || 0;
      const is_questions_null = survey.questions === null;
      // Process the returned values
      res.status(200).json( {
        userDataStatus: Number(number_of_respondents) > 0,
        questionDataStatus: !is_questions_null
      });
    })
    .catch(error => {
      // Handle the error
      console.error(error);
    })
    .finally(() => client.release());

});

// GET API endpoint for checking if a user has a prior response
app.get('/api/user/status', respondentRateLimiter, async (req, res) => {
  const { userId, surveyName } = req.query;
  try {
    const validation = await validateRespondentToken(surveyName, userId);
    if (!validation.ok) {
      return res.status(validation.status).json({ message: validation.message });
    }

    res.status(200).json({ hasResponse: validation.respondent.response !== null });
  } catch (error) {
    console.error('Error checking user status:', error);
    res.status(500).json({ message: 'Failed to check user status.' });
  }
});

// Delete survey endpoint (soft archive with atomic cancellation/audit).
app.delete('/api/survey/:surveyName', requireAuth, async (req, res) => {
  try {
    const survey = await resolveSurveyForUser(req, res, { surveyName: req.params.surveyName, allowedRoles: ADMIN_ROLES });
    if (!survey) return;
    const result = await lifecycle.transitionSurvey(pool, req.user, survey.id, 'archive');
    res.status(200).json({ message: 'Survey archived successfully.', archivedSurvey: survey.name, ...result });
  } catch (error) { sendLifecycleError(res, error); }
});

// Delete a respondent by stable identity through the same serialized/versioned
// roster transaction used by edits and imports.
app.delete('/api/user', requireAuth, async (req, res) => {
  try {
    const { respondentId, surveyName, expectedRevision } = req.body || {};
    if (!surveyName) return res.status(400).json({ error: 'survey_required', message: 'Survey identifier is required.' });
    const survey = await resolveSurveyForUser(req, res, { surveyName, allowedRoles: EDITOR_ROLES });
    if (!survey) return;
    const result = await respondentRoster.mutateRoster(pool, req.user, survey.id, {
      expectedRevision,
      deletions: [respondentId],
    });
    res.set('X-Roster-Revision', String(result.revision));
    res.status(200).json({ message: 'Respondent deleted successfully.', ...result });
  } catch (error) {
    if (error instanceof lifecycle.LifecycleError) return sendLifecycleError(res, error);
    console.error('Error deleting respondent:', error);
    res.status(500).json({ error: 'respondent_delete_failed', message: 'Failed to delete respondent.' });
  }
});


// Delete question endpoint
app.delete('/api/question', requireAuth, async (req, res) => {
  const { questionName, surveyName } = req.body;

  if (!questionName || !surveyName) {
    return res.status(400).json({ 
      message: 'Both question name and survey name are required.' 
    });
  }

  const client = await pool.connect();

  try {
    // First, get the current questions
    const survey = await resolveSurveyForUser(req, res, { surveyName, allowedRoles: EDITOR_ROLES });
    if (!survey) return;
    const updateResult = await lifecycle.withEditableSurvey(pool, req.user, survey.id, async (transactionClient, lockedSurvey) => {
      const currentCanonicalNames = new Set((lockedSurvey.questions?.elements || []).map((question) => question?.name).filter((name) => typeof name === 'string' && /^question_[1-9]\d*$/.test(name)));
      const questions = normalizeQuestionNames(lockedSurvey.questions, { currentCanonicalNames });
      const questionIndex = questions.elements.findIndex((question) => question.name === questionName);
      if (questionIndex === -1) throw new lifecycle.LifecycleError(404, 'question_not_found', 'Question not found in survey.');
      questions.elements.splice(questionIndex, 1);
      return transactionClient.query('UPDATE survey SET questions=$1 WHERE id=$2 RETURNING name', [questions, lockedSurvey.id]);
    });

    res.status(200).json({
      message: 'Question deleted successfully.',
      surveyName: updateResult.rows[0].name,
      deletedQuestion: questionName
    });

  } catch (error) {
    if (error instanceof lifecycle.LifecycleError) return sendLifecycleError(res, error);
    console.error('Error deleting question:', error);
    res.status(500).json({ message: 'Failed to delete question' });
  } finally {
    client.release();
  }
});

app.get('/', async (req, res) => {
  res.status(200).json({ message: 'Health Check: All Good!.' });
});

app.get('/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.status(200).json({ status: 'ok', database: 'ok' });
  } catch (error) {
    console.error('Health check failed:', error.message);
    res.status(503).json({ status: 'error', database: 'unavailable' });
  }
});


if (require.main === module) {
  app.listen(port, () => {
    console.log(`Server is running on port: ${port}`);
  });
}

module.exports = {
  app,
  pool,
  validateRespondentToken,
  requireAuth,
  toSafeUser,
  columnExists,
  tableExists,
  hasAnyRole,
  isPlatformAdmin,
  resolveSurveyForUser,
  copySurveyForUser,
  surveySlug,
  surveyNameValidationError,
  requireOrgAccess,
  getDefaultOrganizationForUser,
  hashToken,
  logAuditEvent,
  getActiveOwnerCount,
  getDashboardBaseUrl,
  buildDashboardUrl,
  createDemoToken,
  verifyDemoToken,
  prepareSurveyForDemo,
  READ_SURVEY_ROLES,
  ANALYST_ROLES,
  EDITOR_ROLES,
  ADMIN_ROLES,
  ORG_ROLES,
  USER_STATUSES,
  parseRequiredCsvValue,
  csvToJson,
  NESTED_QUESTIONS_UNSUPPORTED_MESSAGE,
  SUPPORTED_QUESTION_TYPES,
  validateSurveyDefinition,
  validateRequiredAnswers,
  normalizeQuestionNames,
  formatRespondentChoice,
  isTrustedStateChangingOrigin,
  trustCloudFrontViewerProtocol,
  parseInvitationTemplateCsv,
  normalizeInvitationLanguage,
  normalizeInvitationTemplates,
  insertEmails,
  configuredCorsOrigins,
  buildSurveyUrl,
  displayedRespondentCountExpression,
  isLegacyPlaceholderRespondent,
  surveySummaryRespondentCount,
  surveyResponseSummary,
};
