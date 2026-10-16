'use strict';

const { runtimePool } = require('./runtime-pool');
const { HOSTED_ENVIRONMENTS_DESCRIPTION, isHostedEnvironment } = require('./hosted-environments');
const pool = runtimePool();

if (!['true', 'false'].includes(process.argv[2])) {
  throw new Error('usage: set-email-claiming.js <true|false> [reason]');
}

const enabled = process.argv[2] === 'true';
const environment = process.env.EMAIL_WORKER_ENV;
const expectedRevision = process.env.EXPECTED_RELEASE_REVISION;
if (!isHostedEnvironment(environment)) {
  throw new Error(`EMAIL_WORKER_ENV must be one of: ${HOSTED_ENVIRONMENTS_DESCRIPTION}`);
}
if (enabled && !expectedRevision) {
  throw new Error('EXPECTED_RELEASE_REVISION is required when enabling email claiming');
}

(async () => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, [`email-provider-boundary:${environment}`]);
    const control = await client.query(
      'SELECT environment FROM email_worker_control WHERE environment=$1 FOR UPDATE',
      [environment]
    );
    if (control.rowCount !== 1) throw new Error(`Worker control row not found for ${environment}`);

    if (enabled) {
      const heartbeat = await client.query(
        `SELECT 1 FROM email_worker_heartbeats
         WHERE environment=$1 AND release_revision=$2 AND enabled=true
           AND heartbeat_at>now()-interval '45 seconds'
         LIMIT 1`,
        [environment, expectedRevision]
      );
      if (heartbeat.rowCount !== 1) {
        throw new Error(`No fresh worker heartbeat for ${environment} revision ${expectedRevision}`);
      }
    }

    const update = await client.query(
      `UPDATE email_worker_control
       SET claiming_enabled=$2,
           minimum_release=CASE WHEN $2 THEN $3 ELSE minimum_release END,
           updated_at=now(),
           reason=$4
       WHERE environment=$1`,
      [environment, enabled, expectedRevision || '', String(process.argv[3] || 'operator change').slice(0, 500)]
    );
    if (update.rowCount !== 1) throw new Error(`Failed to update worker control for ${environment}`);
    await client.query('COMMIT');
    console.log(`email claiming ${enabled ? 'enabled' : 'disabled'} for ${environment}${enabled ? ` at ${expectedRevision}` : ''}`);
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
})().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
