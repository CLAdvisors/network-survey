#!/usr/bin/env node
/*
 * Deploy-time initial dashboard administrator bootstrap. The password is
 * passed transiently from SSM and is never written to the release env file.
 */
const fs = require('fs');
const path = require('path');

const releaseApiDir = path.join(__dirname, '..', 'api');
const apiDir = fs.existsSync(releaseApiDir) ? releaseApiDir : path.join(__dirname, '..', '..', 'api');
const { Client } = require(path.join(apiDir, 'node_modules', 'pg'));
const bcrypt = require(path.join(apiDir, 'node_modules', 'bcrypt'));

const username = String(process.env.BOOTSTRAP_ADMIN_USERNAME || '').trim();
const password = String(process.env.BOOTSTRAP_ADMIN_PASSWORD || '');
const email = String(process.env.BOOTSTRAP_ADMIN_EMAIL || '').trim() || null;
const organizationName = String(process.env.BOOTSTRAP_ORGANIZATION_NAME || 'Default / Imported').trim();
const organizationSlug = String(process.env.BOOTSTRAP_ORGANIZATION_SLUG || 'default-imported').trim();
const isPlatformAdmin = String(process.env.BOOTSTRAP_PLATFORM_ADMIN || 'true').toLowerCase() === 'true';
const accountMode = String(process.env.BOOTSTRAP_ACCOUNT_MODE || 'ensure').trim().toLowerCase();

if (!username) throw new Error('BOOTSTRAP_ADMIN_USERNAME is required.');
if (password.length < 12) throw new Error('BOOTSTRAP_ADMIN_PASSWORD must be at least 12 characters.');
if (!organizationName) throw new Error('BOOTSTRAP_ORGANIZATION_NAME is required.');
if (!organizationSlug) throw new Error('BOOTSTRAP_ORGANIZATION_SLUG is required.');
if (!['ensure', 'create-or-verify'].includes(accountMode)) throw new Error('BOOTSTRAP_ACCOUNT_MODE must be ensure or create-or-verify.');

const client = new Client({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME || 'ONA',
  ssl: process.env.DB_SSL === 'true'
    ? {
        ca: process.env.DB_SSL_CA ? fs.readFileSync(process.env.DB_SSL_CA, 'utf8') : undefined,
        rejectUnauthorized: Boolean(process.env.DB_SSL_CA),
      }
    : undefined,
});

async function main() {
  await client.connect();
  try {
    await client.query('BEGIN');
    let userResult;
    if (accountMode === 'create-or-verify') {
      const existing = await client.query(
        `SELECT id, username, password, email, status, is_platform_admin
         FROM users
         WHERE username = $1 OR ($2::citext IS NOT NULL AND email = $2::citext)
         FOR UPDATE`,
        [username, email]
      );
      if (existing.rowCount > 1) {
        throw new Error('Bootstrap owner username and email resolve to different users.');
      }
      if (existing.rowCount === 1) {
        const user = existing.rows[0];
        const exactIdentity = user.username === username
          && String(user.email || '').toLowerCase() === String(email || '').toLowerCase()
          && user.status === 'active'
          && Boolean(user.is_platform_admin) === isPlatformAdmin;
        if (!exactIdentity || !await bcrypt.compare(password, user.password)) {
          throw new Error('Existing bootstrap owner does not match the approved identity, role scope, and credential.');
        }
        userResult = { rows: [{ id: user.id }] };
      } else {
        const passwordHash = await bcrypt.hash(password, 12);
        userResult = await client.query(
          `INSERT INTO users (username, password, email, display_name, status, is_platform_admin)
           VALUES ($1::varchar, $2, $3, $1::text, 'active', $4)
           RETURNING id`,
          [username, passwordHash, email, isPlatformAdmin]
        );
      }
    } else {
      const passwordHash = await bcrypt.hash(password, 12);
      userResult = await client.query(
        `INSERT INTO users (username, password, email, display_name, status, is_platform_admin)
         VALUES ($1::varchar, $2, $3, $1::text, 'active', $4)
         ON CONFLICT (username) DO UPDATE
           SET email = COALESCE(EXCLUDED.email, users.email),
               status = 'active',
               is_platform_admin = EXCLUDED.is_platform_admin
         RETURNING id`,
        [username, passwordHash, email, isPlatformAdmin]
      );
    }
    const organizationResult = await client.query(
      `INSERT INTO organizations (name, slug)
       VALUES ($1, $2)
       ON CONFLICT (slug) DO UPDATE
         SET name = EXCLUDED.name, updated_at = CURRENT_TIMESTAMP, archived_at = NULL
       RETURNING id`,
      [organizationName, organizationSlug]
    );
    await client.query(
      `INSERT INTO organization_memberships (organization_id, user_id, role, created_by_user_id)
       VALUES ($1, $2, 'owner', $2)
       ON CONFLICT (organization_id, user_id) DO UPDATE SET role = 'owner'`,
      [organizationResult.rows[0].id, userResult.rows[0].id]
    );
    await client.query('COMMIT');
    console.log('Bootstrap dashboard administrator access ensured.');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(`Bootstrap administrator failed: ${error.message}`);
  process.exit(1);
});
