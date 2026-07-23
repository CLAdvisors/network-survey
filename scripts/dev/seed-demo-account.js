#!/usr/bin/env node
/*
 * Idempotent local demo seed. Refuses non-local DB hosts unless
 * DEMO_SEED_ALLOW_NONLOCAL=true is set explicitly.
 */
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const dotenvFlow = require('dotenv-flow');

const apiDir = path.join(__dirname, '../../api');
// Resolve through npm workspaces so this works whether dependencies are hoisted
// to the repository root or installed under api/.
const bcrypt = require('bcrypt');
dotenvFlow.config({ path: apiDir });

const host = process.env.DB_HOST || 'localhost';
const localHosts = new Set(['localhost', '127.0.0.1', '::1', 'db']);
if (!localHosts.has(host) && process.env.DEMO_SEED_ALLOW_NONLOCAL !== 'true') {
  console.error(`Refusing to seed demo data against non-local DB_HOST=${host}. Set DEMO_SEED_ALLOW_NONLOCAL=true to override intentionally.`);
  process.exit(1);
}

const pool = new Pool({
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  host,
  port: process.env.DB_PORT,
  database: process.env.DB_NAME || 'ONA',
  ssl: process.env.DB_SSL === 'true'
    ? { ca: process.env.DB_SSL_CA ? fs.readFileSync(process.env.DB_SSL_CA, 'utf8') : undefined, rejectUnauthorized: Boolean(process.env.DB_SSL_CA) }
    : undefined,
});

const surveyName = process.env.DEMO_SURVEY_NAME || 'cla-demo-survey';
const demoPassword = process.env.DEMO_DASHBOARD_PASSWORD || 'demo-password-123';
const tokens = ['demo-alex-token', 'demo-blair-token', 'demo-casey-token'];

async function main() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const org = (await client.query(
      `INSERT INTO organizations (name, slug) VALUES ('CLA Demo Organization', 'cla-demo')
       ON CONFLICT (slug) DO UPDATE SET updated_at = CURRENT_TIMESTAMP
       RETURNING id`
    )).rows[0];

    const passwordHash = await bcrypt.hash(demoPassword, 10);
    const user = (await client.query(
      `INSERT INTO users (username, password, email, display_name, status)
       VALUES ('demo-admin', $1, 'demo-admin@example.com', 'Demo Admin', 'active')
       ON CONFLICT (username) DO UPDATE SET password = EXCLUDED.password, email = EXCLUDED.email, display_name = EXCLUDED.display_name, status = 'active'
       RETURNING id`,
      [passwordHash]
    )).rows[0];

    await client.query(
      `INSERT INTO organization_memberships (organization_id, user_id, role, created_by_user_id)
       VALUES ($1, $2, 'owner', $2)
       ON CONFLICT (organization_id, user_id) DO UPDATE SET role = 'owner'`,
      [org.id, user.id]
    );

    const questions = { elements: [
      { type: 'text', name: 'role', title: 'What is your role?' },
      { type: 'rating', name: 'collaboration', title: 'How strongly do you collaborate with this person?', rateMin: 1, rateMax: 5 }
    ] };
    const survey = (await client.query(
      `INSERT INTO Survey (name, title, creation_date, questions, organization_id, created_by_user_id, display_name, slug)
       VALUES ($1, 'CLA Demo Network Survey', NOW(), $2, $3, $4, 'CLA Demo Network Survey', 'cla-demo-network-survey')
       ON CONFLICT (name) DO UPDATE SET title = EXCLUDED.title, questions = EXCLUDED.questions, organization_id = EXCLUDED.organization_id,
         created_by_user_id = EXCLUDED.created_by_user_id, display_name = EXCLUDED.display_name, slug = EXCLUDED.slug, archived_at = NULL
       RETURNING id, name`,
      [surveyName, questions, org.id, user.id]
    )).rows[0];

    await client.query(
      `INSERT INTO EMAIL (survey_name, survey_id, lang, text)
       VALUES ($1, $2, 'English', 'Please complete the CLA demo network survey.')
       ON CONFLICT (survey_name, lang) DO UPDATE SET survey_id = EXCLUDED.survey_id, text = EXCLUDED.text`,
      [survey.name, survey.id]
    );

    const respondents = [
      ['Alex Demo', 'alex.demo@example.com', tokens[0]],
      ['Blair Demo', 'blair.demo@example.com', tokens[1]],
      ['Casey Demo', 'casey.demo@example.com', tokens[2]],
    ];
    for (const [name, email, token] of respondents) {
      await client.query(
        `INSERT INTO Respondent (name, contact_info, uuid, survey_name, survey_id, can_respond, lang)
         VALUES ($1, $2, $3, $4, $5, true, 'English')
         ON CONFLICT (name, survey_name) DO UPDATE SET contact_info = EXCLUDED.contact_info, uuid = EXCLUDED.uuid, survey_id = EXCLUDED.survey_id, can_respond = true, lang = 'English'`,
        [name, email, token, survey.name, survey.id]
      );
    }

    await client.query('COMMIT');
    console.log('Demo seed complete.');
    console.log('Dashboard login: demo-admin / ' + demoPassword);
    console.log('Organization: CLA Demo Organization (cla-demo)');
    console.log('Survey: ' + survey.name + ' (' + survey.id + ')');
    console.log('Respondent links:');
    for (const token of tokens) console.log(`  ${process.env.SURVEY_URL || 'http://localhost:3000'}/?surveyName=${survey.name}&userId=${token}`);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
