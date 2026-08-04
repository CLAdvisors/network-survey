#!/usr/bin/env node
/*
 * Post-cutover account cleanup. Run in dry-run mode first and apply only after a
 * successful CLA-owner login plus exact preflight/snapshot confirmation. Legacy
 * users are retained for referential history, but disabled, detached, and logged out.
 */
const fs = require('fs');
const path = require('path');

const releaseApiDir = path.join(__dirname, '..', 'api');
const apiDir = fs.existsSync(releaseApiDir) ? releaseApiDir : path.join(__dirname, '..', '..', 'api');
const { Client } = require(path.join(apiDir, 'node_modules', 'pg'));

const required = (name) => {
  const value = String(process.env[name] || '').trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
};
const expectedInteger = (name) => {
  const value = required(name);
  if (!/^\d+$/.test(value)) throw new Error(`${name} must be a non-negative integer.`);
  return Number(value);
};

const ownerUsername = required('CLA_OWNER_USERNAME');
const organizationSlug = String(process.env.CLA_ORGANIZATION_SLUG || 'cla').trim();
const expectedDatabase = required('EXPECTED_DB_NAME');
const expectedSurveyCount = expectedInteger('EXPECTED_SURVEY_COUNT');
const expectedRespondentCount = expectedInteger('EXPECTED_RESPONDENT_COUNT');
const expectedEmailCount = expectedInteger('EXPECTED_EMAIL_COUNT');
const expectedLegacyUserIds = required('EXPECTED_LEGACY_USER_IDS')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean)
  .map((value) => {
    if (!/^\d+$/.test(value)) throw new Error('EXPECTED_LEGACY_USER_IDS must be comma-separated integer IDs.');
    return Number(value);
  })
  .sort((a, b) => a - b);
const snapshotId = required('FINAL_SNAPSHOT_ID');
const cutoverStartedAt = new Date(required('CLA_CUTOVER_STARTED_AT'));
const cleanupMode = String(process.env.CLEANUP_MODE || 'dry-run').trim().toLowerCase();

if (!organizationSlug) throw new Error('CLA_ORGANIZATION_SLUG is required.');
if (expectedSurveyCount < 1) throw new Error('EXPECTED_SURVEY_COUNT must be at least 1.');
if (Number.isNaN(cutoverStartedAt.getTime())) throw new Error('CLA_CUTOVER_STARTED_AT must be an ISO timestamp.');
if (!['dry-run', 'apply'].includes(cleanupMode)) throw new Error('CLEANUP_MODE must be dry-run or apply.');
if (cleanupMode === 'apply' && process.env.CONFIRM_FINAL_SNAPSHOT_ID !== snapshotId) {
  throw new Error('CONFIRM_FINAL_SNAPSHOT_ID must exactly match FINAL_SNAPSHOT_ID in apply mode.');
}

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

const sameIds = (actual, expected) => (
  actual.length === expected.length && actual.every((value, index) => value === expected[index])
);

async function main() {
  await client.connect();
  try {
    await client.query('BEGIN');
    const database = await client.query('SELECT current_database() AS name');
    if (database.rows[0]?.name !== expectedDatabase) {
      throw new Error(`Connected database ${database.rows[0]?.name || '<unknown>'} does not match ${expectedDatabase}.`);
    }

    const access = await client.query(
      `SELECT u.id AS user_id, u.status, u.is_platform_admin, u.last_login_at,
              o.id AS organization_id, om.role
       FROM users u
       JOIN organization_memberships om ON om.user_id = u.id
       JOIN organizations o ON o.id = om.organization_id
       WHERE u.username = $1 AND o.slug = $2
       FOR UPDATE OF u, om, o`,
      [ownerUsername, organizationSlug]
    );
    const owner = access.rows[0];
    if (!owner || owner.status !== 'active' || owner.role !== 'owner' || owner.is_platform_admin) {
      throw new Error('CLA owner-only access is not active and validated; refusing legacy account cleanup.');
    }
    if (!owner.last_login_at || new Date(owner.last_login_at) < cutoverStartedAt) {
      throw new Error('CLA owner has not completed a successful login since cutover began.');
    }

    const integrity = await client.query(
      `SELECT
         COUNT(*)::int AS survey_count,
         COUNT(*) FILTER (WHERE s.organization_id IS DISTINCT FROM $1)::int AS wrong_org_surveys,
         (SELECT COUNT(*)::int FROM Respondent r) AS respondent_count,
         (SELECT COUNT(*)::int FROM EMAIL e) AS email_count,
         (SELECT COUNT(*)::int FROM Respondent r
          LEFT JOIN Survey rs ON rs.id = r.survey_id
          WHERE r.survey_id IS NULL OR rs.id IS NULL OR r.survey_name IS DISTINCT FROM rs.name) AS respondent_gaps,
         (SELECT COUNT(*)::int FROM EMAIL e
          LEFT JOIN Survey es ON es.id = e.survey_id
          WHERE e.survey_id IS NULL OR es.id IS NULL OR e.survey_name IS DISTINCT FROM es.name) AS email_gaps
       FROM Survey s`,
      [owner.organization_id]
    );
    const counts = integrity.rows[0];
    if (
      counts.survey_count !== expectedSurveyCount
      || counts.respondent_count !== expectedRespondentCount
      || counts.email_count !== expectedEmailCount
      || counts.wrong_org_surveys
      || counts.respondent_gaps
      || counts.email_gaps
    ) {
      throw new Error(`Survey reconciliation/count manifest failed; refusing cleanup: ${JSON.stringify(counts)}`);
    }

    const legacyUsers = await client.query(
      `SELECT id, username, status
       FROM users
       WHERE id <> $1
       ORDER BY id
       FOR UPDATE`,
      [owner.user_id]
    );
    const actualLegacyIds = legacyUsers.rows.map(({ id }) => Number(id));
    if (!sameIds(actualLegacyIds, expectedLegacyUserIds)) {
      throw new Error(`Legacy user manifest mismatch; expected ${expectedLegacyUserIds.join(',')}, found ${actualLegacyIds.join(',')}.`);
    }

    const summary = {
      mode: cleanupMode,
      database: expectedDatabase,
      finalSnapshotId: snapshotId,
      ownerUserId: owner.user_id,
      organizationId: owner.organization_id,
      counts,
      legacyUsers: legacyUsers.rows,
    };
    console.log(JSON.stringify(summary, null, 2));

    if (cleanupMode === 'dry-run') {
      await client.query('ROLLBACK');
      console.log('Dry run complete; no account, membership, or session changes were committed.');
      return;
    }

    await client.query(
      'DELETE FROM organization_memberships WHERE user_id = ANY($1::int[])',
      [expectedLegacyUserIds]
    );
    await client.query(
      `DELETE FROM organization_memberships
       WHERE user_id = $1 AND organization_id <> $2`,
      [owner.user_id, owner.organization_id]
    );
    await client.query(
      `UPDATE users
       SET status = 'disabled', is_platform_admin = false
       WHERE id = ANY($1::int[])`,
      [expectedLegacyUserIds]
    );
    await client.query(
      `UPDATE users
       SET status = 'active', is_platform_admin = false, email = COALESCE(email, username::citext)
       WHERE id = $1`,
      [owner.user_id]
    );
    await client.query(
      `DELETE FROM sessions
       WHERE COALESCE(sess->>'userId', '') = ANY($1::text[])`,
      [expectedLegacyUserIds.map(String)]
    );

    await client.query('COMMIT');
    console.log('Legacy dashboard accounts disabled, detached, and logged out. CLA owner retained.');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(`Legacy account cleanup failed: ${error.message}`);
  process.exit(1);
});
