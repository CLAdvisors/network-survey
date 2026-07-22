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

dotenvFlow.config();

const resendApiKey = process.env.RESEND_KEY || process.env.RESEND_API_KEY;

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

async function sendMail(email, id, surveyName, text) {
  try {
    if (!resend) {
      throw new Error('Missing RESEND_KEY or RESEND_API_KEY environment variable');
    }

    text = "<p>" + text.replace(/"/g, '') + "</p>";
    text = text.replace(/<p>/g, '<p data-id="react-email-text" style="font-size:16px;line-height:24px;margin:16px 0;color:#525f7f;text-align:left">');
    let customLink = `${process.env.SURVEY_URL}/?surveyName=${surveyName}&userId=${id}`;

    const emailData = {
      from: 'CLA Survey <survey@cladvisors.com>',
      to: email,
      subject: 'CLA Network Survey',
      html: EMAIL_HTML[0] + text + EMAIL_HTML[1] + customLink + EMAIL_HTML[2],
      surveyName
    };

    // Add delay to respect rate limit
    await rateLimitedSend(emailData);

  } catch (error) {
    console.error(`Failed to send email to ${email}:`, error);
    throw error;
  }
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

    // Force positional names regardless of provided value for consistency
    result.data.forEach((item, index) => {
      item['Question name'] = `question_${index + 1}`;
    });

    // Iterate through each parsed data and create the corresponding question object
    result.data.forEach(item => {
      console.log(item);
    let questionObject = {
            "type": item['Question type'],
            "name": item['Question name'],
            "title": item['Question title'],
            "isRequired": true,
            "choicesLazyLoadEnabled": true,
            "choicesLazyLoadPageSize": 25,
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
// Helper: normalize question names to positional pattern: question_{index+1}
function normalizeQuestionNames(json) {
  try {
    if (!json || typeof json !== 'object') return { elements: [] };
    const elements = Array.isArray(json.elements) ? json.elements : [];
    const safe = elements.map((el, idx) => ({
      ...el,
      name: `question_${idx + 1}`
    }));
    return { elements: safe };
  } catch (e) {
    console.error('normalizeQuestionNames failed:', e);
    return { elements: Array.isArray(json?.elements) ? json.elements : [] };
  }
}

app.post('/api/updateQuestions', express.json(), requireAuth, async (req, res) => {
  const data  = req.body;
  const surveyQuestions = data.questions;
  const surveyName = data.surveyName;

  // Debug logging
  console.log('updateQuestions typeof:', typeof surveyQuestions);
  console.log('updateQuestions value:', JSON.stringify(surveyQuestions));

  const survey = await resolveSurveyForUser(req, res, { surveyName, allowedRoles: EDITOR_ROLES });
  if (!survey) return;

  let surveyData;
  if (typeof surveyQuestions === 'string') {
    // CSV format
    surveyData = csvToJson(surveyQuestions);
    // csvToJson assigns positional names question_{i}
    await insertQuestions(survey.name, surveyData.title, surveyData.questions, survey.id);
  } else if (typeof surveyQuestions === 'object' && surveyQuestions !== null) {
    // JSON format (SurveyJS)
    const normalized = normalizeQuestionNames(surveyQuestions);
    await insertQuestions(survey.name, '', normalized, survey.id);
  } else {
    return res.status(400).json({ message: 'Invalid questions format.' });
  }

  res.status(200).json({ message: 'Questions created successfully.' });
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

    const answers = JSON.parse(data.answers);
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

// GET API endpoint for lazy loading the names list
app.get('/api/names', respondentRateLimiter, async (req, res) => {
  const { skip = 0, take = 10, filter = '', surveyName = '', userId = '' } = req.query;

  const validation = await validateRespondentToken(surveyName, userId);
  if (!validation.ok) {
    return res.status(validation.status).json({ message: validation.message });
  }

  const client = await pool.connect();
  
  try {
    // Modified query to exclude the current user based on UUID
    const query = `
      SELECT r.name, r.contact_info, COUNT(*) OVER() AS total_count
      FROM Respondent r
      JOIN Survey s ON r.survey_name = s.name
      WHERE s.name = $1
      AND r.uuid != $2
      AND (r.name ILIKE $3 OR r.contact_info ILIKE $3)
      ORDER BY r.name
      OFFSET $4
      LIMIT $5;
    `;

    const values = [surveyName, userId, `%${filter}%`, skip, take];
    const result = await client.query(query, values);

    const filteredNames = result.rows.map(user => 
      `${user.name} (${user.contact_info})`
    );

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
  const { surveyName = '', userId = '' } = req.query;

  const validation = await validateRespondentToken(surveyName, userId);
  if (!validation.ok) {
    return res.status(validation.status).json({ message: validation.message });
  }

  const client = await pool.connect();

  try {
    const query = `
      SELECT questions, title
      FROM Survey
      WHERE name = $1;
    `;

    const result = await client.query(query, [surveyName]);
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
    const questions = survey.questions;
    
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
  READ_SURVEY_ROLES,
  ANALYST_ROLES,
  EDITOR_ROLES,
  ADMIN_ROLES,
  ORG_ROLES,
  USER_STATUSES,
};
