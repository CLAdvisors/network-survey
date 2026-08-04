#!/usr/bin/env node
/*
 * Deploy-time initial dashboard administrator bootstrap. The password is
 * passed transiently from SSM and is never written to the release env file.
 */
const fs = require('fs');
const path = require('path');

const apiDir = path.join(__dirname, '..', 'api');
const { Client } = require(path.join(apiDir, 'node_modules', 'pg'));
const bcrypt = require(path.join(apiDir, 'node_modules', 'bcrypt'));

const username = String(process.env.BOOTSTRAP_ADMIN_USERNAME || '').trim();
const password = String(process.env.BOOTSTRAP_ADMIN_PASSWORD || '');

if (!username) throw new Error('BOOTSTRAP_ADMIN_USERNAME is required.');
if (password.length < 12) throw new Error('BOOTSTRAP_ADMIN_PASSWORD must be at least 12 characters.');

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
    const passwordHash = await bcrypt.hash(password, 12);
    const userResult = await client.query(
      `INSERT INTO users (username, password, status, is_platform_admin)
       VALUES ($1, $2, 'active', true)
       ON CONFLICT (username) DO UPDATE
         SET status = 'active', is_platform_admin = true
       RETURNING id`,
      [username, passwordHash]
    );
    const organizationResult = await client.query(
      `INSERT INTO organizations (name, slug)
       VALUES ('Default / Imported', 'default-imported')
       ON CONFLICT (slug) DO UPDATE SET updated_at = CURRENT_TIMESTAMP
       RETURNING id`
    );
    await client.query(
      `INSERT INTO organization_memberships (organization_id, user_id, role)
       VALUES ($1, $2, 'owner')
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
