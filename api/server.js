const express = require('express');
const fs = require('fs');
const path = require('path');
const cors = require('cors');
const { Resend } = require('resend');
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

const resendApiKey = process.env.RESEND_KEY || process.env.RESEND_API_KEY;

// Keep server-side validation in step with the respondent's custom SurveyJS type.
if (!Serializer.findClass('draggableranking')) {
  class QuestionDraggableRankingModel extends Question {
    getType() { return 'draggableranking'; }
  }
  Serializer.addClass('draggableranking', [], () => new QuestionDraggableRankingModel(''), 'question');
}

// Create a new instance of the Pool.
// DB_SSL enables TLS (RDS enforces it); DB_SSL_CA points at the RDS CA bundle
// so the server certificate is actually verified.
const pool = new Pool({
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  database: process.env.DB_NAME || 'ONA',
  ssl: process.env.DB_SSL === 'true'
    ? {
        ca: process.env.DB_SSL_CA ? fs.readFileSync(process.env.DB_SSL_CA, 'utf8') : undefined,
        rejectUnauthorized: Boolean(process.env.DB_SSL_CA),
      }
    : undefined,
});

const resend = resendApiKey ? new Resend(resendApiKey) : null;

const EMAIL_HTML = [`<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
<html lang="en">

  <head data-id="__react-email-head"></head>
  <div id="__react-email-preview" style="display:none;overflow:hidden;line-height:1px;opacity:0;max-height:0;max-width:0">You&#x27;re now ready to take your CLA survey!
  </div>

  <body data-id="__react-email-body" style="background-color:#f6f9fc;font-family:-apple-system,BlinkMacSystemFont,&quot;Segoe UI&quot;,Roboto,&quot;Helvetica Neue&quot;,Ubuntu,sans-serif">
    <table align="center" width="100%" data-id="__react-email-container" role="presentation" cellSpacing="0" cellPadding="0" border="0" style="max-width:37.5em;background-color:#ffffff;margin:0 auto;padding:20px 0 48px;margin-bottom:64px">
      <tbody>
        <tr style="width:100%">
          <td>
            <table align="center" width="100%" data-id="react-email-section" style="padding:0 48px" border="0" cellPadding="0" cellSpacing="0" role="presentation">
              <tbody>
                <tr>
                  <td><img data-id="react-email-img" alt="Logo" src="https://i.postimg.cc/4nkbg08K/logo.png" width="189" height="49" style="display:block;outline:none;border:none;text-decoration:none;margin-top:1.0rem;" />
                    <hr data-id="react-email-hr" style="width:100%;border:none;border-top:1px solid #eaeaea;border-color:#e6ebf1;margin:20px 0" />`, 
                    `<a href="`, `" data-id="react-email-button" target="_blank" style="background-color:#42B4AF;border-radius:5px;color:#fff;font-size:16px;font-weight:bold;text-decoration:none;text-align:center;display:inline-block;width:100%;line-height:100%;max-width:100%;padding:10px 10px"><span><!--[if mso]><i style="letter-spacing: 10px;mso-font-width:-100%;mso-text-raise:15" hidden>&nbsp;</i><![endif]--></span><span style="max-width:100%;display:inline-block;line-height:120%;mso-padding-alt:0px;mso-text-raise:7.5px">Start your survey</span><span><!--[if mso]><i style="letter-spacing: 10px;mso-font-width:-100%" hidden>&nbsp;</i><![endif]--></span></a>
                    <hr data-id="react-email-hr" style="width:100%;border:none;border-top:1px solid #eaeaea;border-color:#e6ebf1;margin:20px 0" />
                    <p data-id="react-email-text" style="font-size:16px;line-height:24px;margin:16px 0;color:#525f7f;text-align:left">View our <a href="https://stripe.com/docs" data-id="react-email-link" target="_blank" style="color:#556cd6;text-decoration:none">privacy policy</a> .</p>
                    <p data-id="react-email-text" style="font-size:16px;line-height:24px;margin:16px 0;color:#525f7f;text-align:left">Lorem ipsum dolor sit amet, consectetur adipiscing elit. Pellentesque vel rhoncus lacus. Nulla facilisi. Donec turpis sem, dictum a sollicitudin a, faucibus ac sem. Morbi sed erat non ex mollis pulvinar ut eu nisi.</p>
                    <p data-id="react-email-text" style="font-size:16px;line-height:24px;margin:16px 0;color:#525f7f;text-align:left">— The CLA team</p>
                    <hr data-id="react-email-hr" style="width:100%;border:none;border-top:1px solid #eaeaea;border-color:#e6ebf1;margin:20px 0" />
                    <p data-id="react-email-text" style="font-size:12px;line-height:16px;margin:16px 0;color:#8898aa">Contemporary Leadership Advisors, 299 Park Ave, New York, NY 10171</p>
                  </td>
                </tr>
              </tbody>
            </table>
          </td>
        </tr>
      </tbody>
    </table>
  </body>

</html>`];

const loremIpsum = `<p>Lorem ipsum dolor sit amet, consectetur adipiscing elit. Pellentesque vel rhoncus lacus. Nulla facilisi. Donec turpis sem, dictum a sollicitudin a, faucibus ac sem.</p> 
<p>Morbi sed erat non ex mollis pulvinar ut eu nisi. Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed gravida cursus pellentesque. Aliquam in lectus et ex ultricies sodales a.</p>`; 

async function sendAccountEmail({ to, subject, html, text }) {
  if (!resend) {
    return { sent: false, message: 'Email delivery is not configured; deliver the returned link manually.' };
  }

  try {
    await resend.emails.send({
      from: 'CLA Survey <survey@cladvisors.com>',
      to,
      subject,
      html,
      text,
    });
    return { sent: true };
  } catch (error) {
    console.error(`Failed to send account email to ${to}:`, error.message);
    return { sent: false, message: 'Email delivery failed; deliver the returned link manually.' };
  }
}

function buildSurveyEmailHtml(text, link) {
  const formattedText = (`<p>${text.replace(/"/g, '')}</p>`)
    .replace(/<p>/g, '<p data-id="react-email-text" style="font-size:16px;line-height:24px;margin:16px 0;color:#525f7f;text-align:left">');
  return EMAIL_HTML[0] + formattedText + EMAIL_HTML[1] + link + EMAIL_HTML[2];
}

async function sendMail(email, id, surveyName, text) {
  try {
    if (!resend) {
      throw new Error('Missing RESEND_KEY or RESEND_API_KEY environment variable');
    }

    const customLink = `${process.env.SURVEY_URL}/?surveyName=${encodeURIComponent(surveyName)}&userId=${encodeURIComponent(id)}`;
    const emailData = {
      from: 'CLA Survey <survey@cladvisors.com>',
      to: email,
      subject: 'CLA Network Survey',
      html: buildSurveyEmailHtml(text, customLink),
      surveyName
    };

    // Add delay to respect rate limit
    await rateLimitedSend(emailData);

  } catch (error) {
    console.error(`Failed to send email to ${email}:`, error);
    throw error;
  }
}

async function sendDemoMail(email, survey, text, demoToken) {
  if (!resend) {
    throw new Error('Missing RESEND_KEY or RESEND_API_KEY environment variable');
  }
  if (!process.env.SURVEY_URL) {
    throw new Error('Missing SURVEY_URL environment variable');
  }

  const link = `${process.env.SURVEY_URL}/?surveyName=${encodeURIComponent(survey.name)}&demoToken=${encodeURIComponent(demoToken)}`;
  const result = await resend.emails.send({
    from: 'CLA Survey <survey@cladvisors.com>',
    to: email,
    subject: '[Demo] CLA Network Survey',
    html: buildSurveyEmailHtml(text, link),
  });
  if (result?.error) throw new Error(result.error.message || 'Email delivery failed');
}

// Queue for managing email sending with rate limiting
const emailQueue = [];
let isProcessing = false;
const RATE_LIMIT = 10; // emails per second
const DELAY = 1000; // 1 second delay between batches

async function rateLimitedSend(emailData) {
  // Add email to queue
  emailQueue.push(emailData);
  
  // Start processing if not already running
  if (!isProcessing) {
    isProcessing = true;
    await processEmailQueue();
  }
}

async function processEmailQueue() {
  while (emailQueue.length > 0) {
    // Process up to RATE_LIMIT emails at once
    const batch = emailQueue.splice(0, RATE_LIMIT);
    
    // Send batch of emails and track successful sends
    const results = await Promise.all(batch.map(async (emailData) => {
      try {
        await resend.emails.send(emailData);
        // Extract recipient email from emailData
        return { success: true, email: emailData.to };
      } catch (error) {
        console.error(`Failed to send email to ${emailData.to}:`, error);
        return { success: false, email: emailData.to };
      }
    }));

    // Update email_sent status for successful sends
    const successfulBySurvey = results.reduce((grouped, result) => {
      if (!result.success) return grouped;
      const surveyName = batch.find(emailData => emailData.to === result.email)?.surveyName;
      if (!surveyName) return grouped;
      grouped[surveyName] = grouped[surveyName] || [];
      grouped[surveyName].push(result.email);
      return grouped;
    }, {});
    for (const [surveyName, successfulEmails] of Object.entries(successfulBySurvey)) {
      if (successfulEmails.length > 0) {
        try {
          await pool.query(
            'UPDATE Respondent SET email_sent = true WHERE contact_info = ANY($1) AND survey_name = $2',
            [successfulEmails, surveyName]
          );
        } catch (error) {
          console.error('Failed to update email_sent status:', error);
        }
      }
    }

    // Wait for rate limit window if more emails remain
    if (emailQueue.length > 0) {
      await new Promise(resolve => setTimeout(resolve, DELAY));
    }
  }
  
  isProcessing = false;
}

// User test email function (allow admin user to send test email to themselves)
async function sendTestMail(email, survey, lang) {
  const client = await pool.connect();
  try {
    const query = `SELECT text FROM email WHERE ${legacySurveyPredicate()} AND lang = $3`;
    const values = [survey.id, survey.name, lang];
    const response = await client.query(query, values);
    
    if (!response.rows || response.rows.length === 0) {
      throw new Error(`Email template not found for survey '${survey.name}' in language '${lang}'`);
    }

    const text = response.rows[0].text;
    if (text === undefined || text === null) {
      throw new Error(`Email text is undefined for survey '${survey.name}'`);
    }

    const respondentResult = await client.query(
      `SELECT uuid FROM Respondent
       WHERE ${legacySurveyPredicate()}
         AND can_respond = true
         AND uuid IS NOT NULL
         AND lower(contact_info) = lower($3)
       ORDER BY respondent_id
       LIMIT 1`,
      [survey.id, survey.name, email]
    );
    const respondentToken = respondentResult.rows[0]?.uuid;
    if (!respondentToken) {
      const error = new Error(`No active respondent token found for '${email}' on survey '${survey.name}'. Reminders can only be sent to that respondent's own email address.`);
      error.statusCode = 404;
      throw error;
    }

    await sendMail(email, respondentToken, survey.name, text);
  } finally {
    client.release();
  }
}

async function startSurvey(survey){
  // Pull all users from the database
  const client = await pool.connect();
  const query = `SELECT name, contact_info, uuid, lang FROM Respondent WHERE ${legacySurveyPredicate()} AND can_respond = true`;
  const values = [survey.id, survey.name];
  let respondents = [];
  let emails = [];
  await client.query(query, values)
    .then(response => {
        respondents = response.rows.map(row => ({
            userName: row.name,
            email: row.contact_info,
            userId: row.uuid,
            language: row.lang
        }));
    });

  // Pull the email text from the database for each language
  const emailQuery = `SELECT lang, text FROM email WHERE ${legacySurveyPredicate()}`;
  const emailValues = [survey.id, survey.name];
  await client.query(emailQuery, emailValues)
    .then(response => {
        emails = response.rows.map(row => ({
            language: row.lang,
            text: row.text
        }));
    });
    // Create a map from language to email text
    const emailMap = emails.reduce((map, email) => {
      map[email.language.replace(/"/g, "").replace(/'/g, "")] = '<p>' + email.text + '</p>';
      return map;
    }, {});
    
    // Send the emails
    respondents.forEach(respondent => {
      sendMail(respondent.email, respondent.userId, survey.name, emailMap[respondent.language].replace(/"/g, "").replace(/'/g, ""));
    });
  }
// sendMail('bgarcia2324@gmail.com', 'byVHldRI2ZgaOXNhE-ih7', 'GEEEEEE');

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
const DEMO_RESPONDENT_CHOICES = Array.from({ length: 100 }, (_, index) => {
  const number = String(index + 1).padStart(3, '0');
  return `Demo Person ${number} (demo-person-${number}@example.com)`;
});

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

app.use(express.json());

app.use(cors({
  origin: function(origin, callback) {
    const allowedOrigins = [
      process.env.FRONTEND_URL?.replace(/\/$/, ''),
      process.env.SURVEY_URL?.replace(/\/$/, '')
    ].filter(Boolean); // Remote undefined values if any
    
    // Normalize origin by removing trailing slash if present
    const normalizedOrigin = origin ? origin.replace(/\/$/, '') : origin;
    
    if (!normalizedOrigin || allowedOrigins.includes(normalizedOrigin)) {
      callback(null, true);
    } else {
      console.warn(`CORS rejected origin: ${origin} (Allowed: ${allowedOrigins.join(', ')})`);
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.set('trust proxy', 1);
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
  // Per-environment cookie name: staging and prod share the .bennetts.work
  // cookie domain, so a shared name would let them clobber each other
  name: process.env.SESSION_COOKIE_NAME || 'sessionId',
  cookie: {
    secure: process.env.NODE_ENV === 'prod', // Only use secure in production
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000, // 24 hours
    sameSite: 'lax',  // Changed from 'strict' to 'lax' for better compatibility
    path: '/',
    domain: process.env.NODE_ENV === 'prod' ? '.bennetts.work' : undefined
  }
}));
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

async function validateRespondentToken(surveyName, userId) {
  if (!surveyName || surveyName === 'undefined' || surveyName === 'null') {
    return { ok: false, status: 400, message: 'Survey name is required.' };
  }

  if (!userId) {
    return { ok: false, status: 400, message: 'User ID is required.' };
  }

  const result = await pool.query(
    `SELECT r.respondent_id, r.response, r.can_respond, r.survey_id
     FROM Respondent r
     JOIN Survey s ON (r.survey_id = s.id OR (r.survey_id IS NULL AND r.survey_name = s.name))
     WHERE r.uuid = $1
       AND r.survey_name = $2
       AND s.archived_at IS NULL`,
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
    res.clearCookie(process.env.SESSION_COOKIE_NAME || 'sessionId');
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

async function resolveSurveyForUser(req, res, { surveyName, surveyId, allowedRoles = READ_SURVEY_ROLES } = {}) {
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

  const result = await pool.query(
    `SELECT s.id, s.name, s.title, s.creation_date, s.questions,
            s.organization_id, s.created_by_user_id, om.role
     FROM Survey s
     LEFT JOIN organization_memberships om
       ON om.organization_id = s.organization_id AND om.user_id = $1
     WHERE (${predicates.slice(1).join(' OR ')})
       AND s.archived_at IS NULL
     ORDER BY s.creation_date DESC NULLS LAST
     LIMIT 1`,
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
async function insertUsers(users, deleteRow = null, survey = null) {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // If there's a row to delete, delete it first
    if (deleteRow) {
      const deleteQuery = `
        DELETE FROM Respondent 
        WHERE name = $1 AND (survey_id = $2 OR (survey_id IS NULL AND survey_name = $3))
      `;
      await client.query(deleteQuery, [deleteRow.name, survey?.id || deleteRow.surveyId || null, survey?.name || deleteRow.surveyName]);
    }

    // Then insert/update the modified rows
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

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error in database operation:', error);
    throw error;
  } finally {
    client.release();
  }
}
async function insertEmails(data, survey = null) {
  // Start a PostgreSQL client from the pool
  const client = await pool.connect();
  console.log(data);
  try {
    // Begin a transaction
    await client.query('BEGIN');

    // Iterate through the emails and insert or update them
    for (const email of data) {
      const query = `
        INSERT INTO email (survey_name, survey_id, lang, text)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (survey_name, lang) DO UPDATE
        SET text = EXCLUDED.text,
            survey_id = EXCLUDED.survey_id
      `;
      const values = [survey?.name || email.surveyName, survey?.id || email.surveyId || null, email.language, email.text.replace(/"/g, "").replace(/'/g, "")];
      await client.query(query, values);
    }

    // Commit the transaction
    await client.query('COMMIT');

    // Release the client back to the pool
    client.release();

    console.log('Email data inserted or updated successfully!');
  } catch (error) {
    // If an error occurs, rollback the transaction
    console.log(error);
    await client.query('ROLLBACK');
    console.error('Error inserting or updating emails:', error);
    client.release();
  }
}

async function insertQuestions(name, title, json, surveyId = null) {
  const client = await pool.connect();

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
    await client.release();
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
  const surveyName = data.surveyName;

  if (!surveyName) {
    res.status(400).json({ message: 'Survey name is required.' });
    return;
  }

  try {
    // The placeholder respondent references Survey(name), so the survey row
    // must be committed first
    const org = await getDefaultOrganizationForUser(req, res, data.organizationId || data.organization_id || null);
    if (!org) return;
    const survey = await insertSurvey(surveyName, '', org.organization_id, req.user.id);
    await insertUsers([{userName: 'None', email: 'N/A', surveyName: surveyName, canRespond: false, language: 'English'}], null, survey);
    res.status(200).json({ message: 'Survey created successfully!', survey: { id: survey.id, name: survey.name, organizationId: survey.organization_id } });
  } catch (error) {
    console.error(error);
    if (error.code === '23505') {
      return res.status(409).json({ message: 'A survey with that name already exists.' });
    }
    res.status(500).json({ message: 'Failed to create survey.' });
  }
});

app.post('/api/testEmail', express.json(), requireAuth, async (req, res) => {
  const data  = req.body;
  const surveyName = data.surveyName;
  const language = data.language;
  const email = data.email;

  if (!surveyName) {
    res.status(400).json({ message: 'Survey name is required.' });
    return;
  }
  if (!language) {
    res.status(400).json({ message: 'Language name is required.' });
    return;
  }
  if (!email) {
    res.status(400).json({ message: 'Email name is required.' });
    return;
  }

  try {
    const survey = await resolveSurveyForUser(req, res, { surveyName, allowedRoles: EDITOR_ROLES });
    if (!survey) return;
    await sendTestMail(email, survey, language);
    res.status(200).json({ message: 'Test email sent successfully!' });
  } catch (error) {
    console.error(error);
    res.status(error.statusCode || 500).json({ message: error.message || 'Error occurred while sending test email.' });
  }
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
      `SELECT text FROM email WHERE ${legacySurveyPredicate()} AND lang = $3 LIMIT 1`,
      [survey.id, survey.name, language]
    );
    if (templateResult.rows.length === 0) {
      return res.status(404).json({ message: `No ${language} email template is configured for this survey.` });
    }

    const demoToken = createDemoToken(survey.id, survey.name);
    await sendDemoMail(email.trim(), survey, templateResult.rows[0].text, demoToken);
    res.status(200).json({ message: `Demo survey sent to ${email.trim()}.` });
  } catch (error) {
    console.error('Failed to send demo survey:', error);
    res.status(500).json({ message: 'Failed to send demo survey email.' });
  }
});

app.post('/api/startSurvey', express.json(), requireAuth, async (req, res) => {
  const data  = req.body;
  const surveyName = data.surveyName;

  if (!surveyName) {
    res.status(400).json({ message: 'Survey name is required.' });
    return;
  }

  try {
    const survey = await resolveSurveyForUser(req, res, { surveyName, allowedRoles: EDITOR_ROLES });
    if (!survey) return;
    await startSurvey(survey);
    res.status(200).json({ message: 'Survey started successfully!' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Failed to start survey.' });
  }
});

app.post('/api/updateEmails', express.json(), requireAuth, async (req, res) => {
  const data  = req.body;
  const surveyName = data.surveyName;
  const csvData = data.csvData;

  if (!surveyName) {
    res.status(400).json({ message: 'Survey name is required.' });
    return;
  }

  if (!csvData) {
    res.status(400).json({ message: 'CSV data is required.' });
    return;
  }

  let csvArray = csvData.split('\n');
  const header = csvArray.shift().split(',');

  csvArray = csvArray.map((row, index) => {
    const columns = row.split(',');
    // combine all strings after index 0
    columns[1] = columns.slice(1).join(',');
    return {
      surveyName: surveyName,
      language: columns[0].replace(/(\r\n|\n|\r)/gm, ""),
      text: columns[1].replace(/(\r\n|\n|\r)/gm, "")
    }
  });

  try {
    const survey = await resolveSurveyForUser(req, res, { surveyName, allowedRoles: EDITOR_ROLES });
    if (!survey) return;
    await insertEmails(csvArray, survey);
    res.status(200).json({ message: 'Email data updated successfully.' });
  } catch (error) {
    console.error('Error updating email templates:', error);
    res.status(500).json({ message: 'Failed to update email data.' });
  } 
});
// Modify the POST /api/updateTarget endpoint to handle the new fields
app.post('/api/updateTarget', requireAuth, async (req, res) => {
  const { csvData, surveyName, deleteRow } = req.body;

  if (!surveyName) {
    return res.status(400).json({ message: 'Survey name is required.' });
  }
  if (!csvData) {
    return res.status(400).json({ message: 'CSV data is required.' });
  }

  try {
    let csvArray = csvData.split('\n');
    const header = csvArray.shift().split(',');
    const headerDict = {};

    // Clean up header names and create dictionary
    header.forEach((name, index) => {
      const cleanName = name.replace(/(\r\n|\n|\r|")/gm, "").trim();
      headerDict[cleanName] = index;
    });

    if (csvArray.length === 0 || csvArray[0].length === 0) {
      return res.status(400).json({ message: 'CSV data is empty.' });
    }

    // Convert to json with safer column access
    const surveyTargets = csvArray
      .filter(x => x !== '')
      .map((row) => {
        const columns = row.split(',').map(col => col.replace(/(\r\n|\n|\r|")/gm, "").trim());
        
        // Safely access required columns
        const firstName = (columns[headerDict['First']] || '').trim();
        const lastName = (columns[headerDict['Last']] || '').trim();
        const email = (columns[headerDict['Email']] || '').trim();
        
        // Safely access optional columns with defaults
        const language = headerDict['Language'] !== undefined 
          ? (columns[headerDict['Language']] || 'English').trim()
          : 'English';
          
        // Check for either "Respondent" or "Can Respond" column
        const canRespond = headerDict['Respondent'] !== undefined
          ? (columns[headerDict['Respondent']] || 'true').toLowerCase() === 'true'
          : (headerDict['Can Respond'] !== undefined
              ? (columns[headerDict['Can Respond']] || 'true').toLowerCase() === 'true'
              : true);

        return {
          userName: `${firstName} ${lastName}`.trim(),
          email: email,
          language: language,
          canRespond: canRespond,
          surveyName: surveyName
        };
      })
      .filter(target => target.userName && target.email); // Filter out invalid entries

    // Validate that we have valid data
    if (surveyTargets.length === 0) {
      return res.status(400).json({ message: 'No valid respondent data found in CSV.' });
    }

    const survey = await resolveSurveyForUser(req, res, { surveyName, allowedRoles: EDITOR_ROLES });
    if (!survey) return;

    // Handle the database operations with potential deletion
    await insertUsers(surveyTargets, deleteRow, survey);

    res.status(200).json({ 
      message: 'Respondents updated successfully.',
      updatedCount: surveyTargets.length
    });

  } catch (error) {
    console.error('Error updating respondents:', error);
    res.status(500).json({ 
      message: 'Failed to update respondents', 
      error: error.message 
    });
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
      SELECT lang, text
      FROM EMAIL
      WHERE ${legacySurveyPredicate()}
    `;

    const result = await client.query(query, [survey.id, survey.name]);

    const notifications = result.rows.reduce((acc, row) => {
      acc[row.lang] = row.text;
      return acc;
    }, {});

    res.status(200).json({ notifications });
  } catch (error) {
    console.error('Error retrieving email texts:', error);
    res.status(500).json({ message: 'Failed to retrieve email texts.' });
  } finally {
    client.release();
  }
});

// Modify the POST /api/updateTargets endpoint to handle the new fields
app.post('/api/updateTargets', express.json(), requireAuth, async (req, res) => {
  const data = req.body;
  const csvData = data.csvData;
  const surveyName = data.surveyName;

  if (!surveyName) {
    res.status(400).json({ message: 'Survey name is required.' });
    return;
  }
  if (!csvData) {
    res.status(400).json({ message: 'CSV data is required.' });
    return;
  }

  try {
    let csvArray = csvData.split('\n');
    const header = csvArray.shift().split(',');
    const headerDict = {};

    // Clean up header names and create dictionary
    header.forEach((name, index) => {
      const cleanName = name.replace(/(\r\n|\n|\r|")/gm, "").trim();
      headerDict[cleanName] = index;
    });

    if (csvArray.length === 0 || csvArray[0].length === 0) {
      res.status(400).json({ message: 'CSV data is empty.' });
      return;
    }

    // Convert to json with safer column access
    const surveyTargets = csvArray
      .filter(x => x !== '')
      .map((row) => {
        const columns = row.split(',').map(col => col.replace(/(\r\n|\n|\r|")/gm, "").trim());
        
        // Safely access required columns
        const firstName = (columns[headerDict['First']] || '').trim();
        const lastName = (columns[headerDict['Last']] || '').trim();
        const email = (columns[headerDict['Email']] || '').trim();
        
        // Safely access optional columns with defaults
        const language = headerDict['Language'] !== undefined 
          ? (columns[headerDict['Language']] || 'English').trim()
          : 'English';
          
        // Check for either "Respondent" or "Can Respond" column
        const canRespond = headerDict['Respondent'] !== undefined
          ? (columns[headerDict['Respondent']] || 'true').toLowerCase() === 'true'
          : (headerDict['Can Respond'] !== undefined
              ? (columns[headerDict['Can Respond']] || 'true').toLowerCase() === 'true'
              : true);

        return {
          userName: `${firstName} ${lastName}`.trim(),
          email: email,
          language: language,
          canRespond: canRespond,
          surveyName: surveyName
        };
      })
      .filter(target => target.userName && target.email); // Filter out invalid entries

    // Validate that we have valid data
    if (surveyTargets.length === 0) {
      res.status(400).json({ message: 'No valid respondent data found in CSV.' });
      return;
    }

    const survey = await resolveSurveyForUser(req, res, { surveyName, allowedRoles: EDITOR_ROLES });
    if (!survey) return;

    // Insert the users into the database
    await insertUsers(surveyTargets, null, survey);

    res.status(200).json({ 
      message: 'Survey created successfully.',
      processedCount: surveyTargets.length
    }); 

  } catch (error) {
    console.error('Error processing CSV:', error);
    res.status(500).json({ 
      message: 'Failed to process CSV data',
      error: error.message
    });
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

    const historicalMaximumResult = await pool.query(
      `SELECT COALESCE(MAX((matched.parts[1])::numeric), 0)::text AS max_question_number
       FROM Respondent r
       CROSS JOIN LATERAL jsonb_object_keys(
         CASE WHEN jsonb_typeof(r.response) = 'object' THEN r.response ELSE '{}'::jsonb END
       ) AS response_key(key)
       CROSS JOIN LATERAL regexp_match(response_key.key, '^question_([1-9][0-9]*)$') AS matched(parts)
       WHERE ${legacySurveyPredicate('r')}`,
      [survey.id, survey.name]
    );
    const historicalMaximum = BigInt(historicalMaximumResult.rows[0]?.max_question_number || 0);
    const currentCanonicalNames = new Set(
      (Array.isArray(survey.questions?.elements) ? survey.questions.elements : [])
        .map((question) => question?.name)
        .filter((name) => typeof name === 'string' && /^question_[1-9]\d*$/.test(name))
    );
    const savedQuestions = normalizeQuestionNames(submittedQuestions, {
      minimumNextQuestionNumber: historicalMaximum + 1n,
      currentCanonicalNames,
      // Survey Creator may discard unknown top-level metadata. Never let its
      // submitted copy reset the allocation watermark held by the database.
      persistedNextQuestionNumber: Object.prototype.hasOwnProperty.call(
        survey.questions || {}, 'claNextQuestionNumber'
      ) ? survey.questions.claNextQuestionNumber : 1,
    });
    await insertQuestions(survey.name, title, savedQuestions, survey.id);

    res.status(200).json({ message: 'Questions created successfully.', questions: savedQuestions });
  } catch (error) {
    res.status(400).json({ message: error.message || 'Invalid questions schema.' });
  }
});

// PUT API endpoint for answer submission
app.post('/api/user', express.json(), respondentRateLimiter, async (req, res) => {
  try {
    const data = req.body;
    const userId = data.userId;
    const surveyName = data.surveyName;

    const validation = await validateRespondentToken(surveyName, userId);
    if (!validation.ok) {
      return res.status(validation.status).json({ message: validation.message });
    }

    let answers;
    try {
      answers = JSON.parse(data.answers);
    } catch {
      return res.status(400).json({ message: 'Answers must be valid JSON.' });
    }
    if (!answers || typeof answers !== 'object' || Array.isArray(answers)) {
      return res.status(400).json({
        message: 'Invalid survey responses.',
        errors: ['Answers must be an object.']
      });
    }

    const schemaResult = await pool.query(
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
      const choicesResult = await pool.query(
        `SELECT r.name, r.contact_info
         FROM Respondent r
         WHERE ${legacySurveyPredicate('r')}
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

    await insertResponses(answers, userId, surveyName, validation.respondent.survey_id);
    res.status(200).json({ success: true });
  } catch (error) {
    console.error('Error submitting response:', error);
    res.status(500).json({ message: 'Failed to submit response.' });
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

  const demoClaims = demoToken ? verifyDemoToken(demoToken) : null;
  if (demoToken && (!demoClaims || demoClaims.surveyName !== surveyName)) {
    return res.status(403).json({ message: 'This demo link is invalid or has expired.' });
  }
  // Demo recipients may be outside the organization. Supply synthetic choices
  // so people/tagbox questions remain testable without exposing respondent PII.
  if (demoClaims) {
    const normalizedFilter = String(filter).toLowerCase();
    const filteredChoices = DEMO_RESPONDENT_CHOICES.filter((choice) =>
      choice.toLowerCase().includes(normalizedFilter)
    );
    const safeSkip = Math.max(0, Number.parseInt(skip, 10) || 0);
    const safeTake = Math.min(100, Math.max(1, Number.parseInt(take, 10) || 10));
    return res.status(200).json({
      names: filteredChoices.slice(safeSkip, safeSkip + safeTake),
      total: filteredChoices.length,
    });
  }

  const validation = await validateRespondentToken(surveyName, userId);
  if (!validation.ok) {
    return res.status(validation.status).json({ message: validation.message });
  }

  const surveyId = validation.respondent.survey_id;
  const client = await pool.connect();
  
  try {
    const query = `
      SELECT r.name, r.contact_info, COUNT(*) OVER() AS total_count
      FROM Respondent r
      WHERE ${legacySurveyPredicate('r')}
      AND r.uuid != $3
      AND (r.name ILIKE $4 OR r.contact_info ILIKE $4)
      ORDER BY r.name
      OFFSET $5
      LIMIT $6;
    `;

    const values = [surveyId, surveyName, userId, `%${filter}%`, skip, take];
    const result = await client.query(query, values);

    const filteredNames = result.rows.map(formatRespondentChoice);

    const total = result.rows.length > 0 ? Number(result.rows[0].total_count) : 0;

    res.status(200).json({
      names: filteredNames,
      total: Number.isFinite(total) && total >= 0 ? total : filteredNames.length
    });

  } catch (error) {
    console.error('Error fetching names:', error);
    res.status(500).json({ 
      error: 'Failed to fetch names',
      message: error.message 
    });
  } finally {
    client.release();
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
  const client = await pool.connect();

  try {
    const query = `
      SELECT questions, title
      FROM Survey
      WHERE (id = $1 OR ($1::uuid IS NULL AND name = $2))
        AND archived_at IS NULL;
    `;

    const result = await client.query(query, [surveyId, surveyName]);
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Survey not found.' });
    }

    const jsonData = { title: result.rows[0].title, questions: result.rows[0].questions };
    res.status(200).json(jsonData);
  } catch (error) {
    console.error('Error fetching survey questions:', error);
    res.status(500).json({ message: 'Failed to fetch survey questions.' });
  } finally {
    client.release();
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
app.get('/api/targets', requireAuth, async(req, res) => {
  const { surveyName = '' } = req.query;

  const client = await pool.connect();

  const survey = await resolveSurveyForUser(req, res, { surveyName, allowedRoles: ANALYST_ROLES });
  if (!survey) { client.release(); return; }

  const query = `SELECT name, contact_info, respondent_id, can_respond, lang, response IS NULL AS response_status 
               FROM Respondent 
               WHERE ${legacySurveyPredicate()}`;
  client.query(query, [survey.id, survey.name])
    .then(response => {
        const respondents = response.rows.map((row, index) => ({
            id: row.respondent_id,
            name: row.name,
            email: row.contact_info,
            language: row.lang,
            canRespond: row.can_respond,
            status: row.response_status ? 'Incomplete' : 'Complete'
        }));
        res.status(200).json(respondents);
    })
    .catch(e => console.error(e.stack))
    .finally(() => client.release());
});

// GET API endpoint for a list of current surveys
app.get('/api/surveys', requireAuth, async (req, res) => {
  // NEW DB CODE
  const client = await pool.connect();

  const query = isPlatformAdmin(req.user) ? `
  SELECT s.id, s.name, s.organization_id, o.name AS organization_name,
         'owner'::text AS role,
         s.creation_date,
         COUNT(r.respondent_id) AS number_of_respondents,
         COALESCE(jsonb_array_length(s.questions->'elements'), 0) AS number_of_questions
  FROM Survey s
  LEFT JOIN organizations o ON o.id = s.organization_id
  LEFT JOIN Respondent r ON (r.survey_id = s.id OR (r.survey_id IS NULL AND r.survey_name = s.name))
  WHERE s.archived_at IS NULL
  GROUP BY s.id, s.name, s.organization_id, o.name, s.creation_date, s.questions
  ORDER BY s.creation_date DESC NULLS LAST
  ` : `
  SELECT s.id, s.name, s.organization_id, o.name AS organization_name,
         om.role,
         s.creation_date,
         COUNT(r.respondent_id) AS number_of_respondents,
         COALESCE(jsonb_array_length(s.questions->'elements'), 0) AS number_of_questions
  FROM Survey s
  JOIN organization_memberships om ON om.organization_id = s.organization_id AND om.user_id = $1
  LEFT JOIN organizations o ON o.id = s.organization_id
  LEFT JOIN Respondent r ON (r.survey_id = s.id OR (r.survey_id IS NULL AND r.survey_name = s.name))
  WHERE s.archived_at IS NULL
  GROUP BY s.id, s.name, s.organization_id, o.name, om.role, s.creation_date, s.questions
  ORDER BY s.creation_date DESC NULLS LAST
  `;

  client.query(query, isPlatformAdmin(req.user) ? [] : [req.user.id])
    .then(result => {
      const surveys = result.rows.map((row) => ({
        id: row.id,
        name: row.name,
        organizationId: row.organization_id,
        organizationName: row.organization_name,
        role: row.role,
        respondents: Math.max(0, Number(row.number_of_respondents || 0) - 1) + "",
        questions: row.number_of_questions + "",
        date: row.creation_date,
      }));
      // Process the returned JSON data
      res.status(200).json({ surveys });
    })
    .catch(error => {
      // Handle the error
      console.error(error);
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
  SELECT COUNT(r.respondent_id) AS number_of_respondents
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
        userDataStatus: number_of_respondents >  1 ? true : false,
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

// Delete survey endpoint
app.delete('/api/survey/:surveyName', requireAuth, async (req, res) => {
  const surveyName = req.params.surveyName;
  console.log("surveyName", surveyName);
  if (!surveyName) {
    return res.status(400).json({ message: 'Survey name is required.' });
  }

  const client = await pool.connect();

  try {
    const survey = await resolveSurveyForUser(req, res, { surveyName, allowedRoles: ADMIN_ROLES });
    if (!survey) return;
    await client.query('BEGIN');
    
    // Archive survey; keep respondents and email templates for rollback/audit.
    const result = await client.query(
      'UPDATE survey SET archived_at = CURRENT_TIMESTAMP, archived_by_user_id = $1 WHERE id = $2 AND archived_at IS NULL RETURNING name',
      [req.user.id, survey.id]
    );
    
    await client.query('COMMIT');

    await logAuditEvent({
      organizationId: survey.organization_id,
      actorUserId: req.user.id,
      surveyId: survey.id,
      eventType: 'survey.archived',
      metadata: { surveyName: survey.name }
    });

    if (result.rowCount === 0) {
      return res.status(404).json({ message: 'Survey not found.' });
    }

    res.status(200).json({ 
      message: 'Survey archived successfully.',
      archivedSurvey: result.rows[0].name
    });

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error deleting survey:', error);
    res.status(500).json({ 
      message: 'Failed to delete survey', 
      error: error.message 
    });
  } finally {
    client.release();
  }
});

// Delete user endpoint
app.delete('/api/user', requireAuth, async (req, res) => {
  const { userName, surveyName } = req.body;
  console.log("userName", userName);
  console.log("surveyName", surveyName);

  if (!userName || !surveyName) {
    return res.status(400).json({ 
      message: 'Both user name and survey name are required.' 
    });
  }

  const client = await pool.connect();

  try {
    const survey = await resolveSurveyForUser(req, res, { surveyName, allowedRoles: EDITOR_ROLES });
    if (!survey) return;
    const result = await client.query(
      'DELETE FROM respondent WHERE name = $1 AND (survey_id = $2 OR (survey_id IS NULL AND survey_name = $3)) RETURNING name, survey_name',
      [userName, survey.id, survey.name]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ 
        message: 'User not found in the specified survey.' 
      });
    }

    res.status(200).json({
      message: 'User deleted successfully from survey.',
      deletedUser: result.rows[0]
    });

  } catch (error) {
    console.error('Error deleting user:', error);
    res.status(500).json({ 
      message: 'Failed to delete user', 
      error: error.message 
    });
  } finally {
    client.release();
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
    const currentCanonicalNames = new Set(
      (Array.isArray(survey.questions?.elements) ? survey.questions.elements : [])
        .map((question) => question?.name)
        .filter((name) => typeof name === 'string' && /^question_[1-9]\d*$/.test(name))
    );
    // Normalize before removal so the highest allocated identity remains in
    // the persisted watermark even when it has never appeared in a response.
    const questions = normalizeQuestionNames(survey.questions, { currentCanonicalNames });

    // Find and remove the question
    const questionIndex = questions.elements.findIndex(q => q.name === questionName);
    
    if (questionIndex === -1) {
      return res.status(404).json({ message: 'Question not found in survey.' });
    }

    // Remove the question
    questions.elements.splice(questionIndex, 1);

    // Update the survey with the modified questions
    const updateResult = await client.query(
      'UPDATE survey SET questions = $1 WHERE id = $2 RETURNING name',
      [questions, survey.id]
    );

    res.status(200).json({
      message: 'Question deleted successfully.',
      surveyName: updateResult.rows[0].name,
      deletedQuestion: questionName
    });

  } catch (error) {
    console.error('Error deleting question:', error);
    res.status(500).json({ 
      message: 'Failed to delete question', 
      error: error.message 
    });
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
  requireOrgAccess,
  getDefaultOrganizationForUser,
  hashToken,
  logAuditEvent,
  getActiveOwnerCount,
  getDashboardBaseUrl,
  buildDashboardUrl,
  createDemoToken,
  verifyDemoToken,
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
};
