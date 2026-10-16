'use strict';

const crypto = require('crypto');
const { runtimePool } = require('./runtime-pool');
const pool = runtimePool();
const { HOSTED_ENVIRONMENTS_DESCRIPTION, isHostedEnvironment } = require('./hosted-environments');

const [enabledArg, revisionArg, actorArg, ...reasonParts] = process.argv.slice(2);
if (!['true', 'false'].includes(enabledArg) || !/^\d+$/.test(revisionArg || '') || !actorArg || reasonParts.length === 0) {
  throw new Error('usage: set-webhook-processing.js <true|false> <expected-control-revision> <actor> <reason>');
}
const enabled = enabledArg === 'true';
const expectedControlRevision = Number(revisionArg);
const environment = process.env.EMAIL_WORKER_ENV;
const release = process.env.EXPECTED_RELEASE_REVISION || '';
const deploymentId = process.env.EXPECTED_DEPLOYMENT_ID || '';
const actor = actorArg.slice(0, 255);
const reason = reasonParts.join(' ').slice(0, 500);
if (!isHostedEnvironment(environment)) throw new Error(`EMAIL_WORKER_ENV must be one of: ${HOSTED_ENVIRONMENTS_DESCRIPTION}`);
if (enabled && (!release || !deploymentId)) throw new Error('enabling requires EXPECTED_RELEASE_REVISION and EXPECTED_DEPLOYMENT_ID');

(async () => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`webhook-processing-control:${environment}`]);
    const currentResult = await client.query('SELECT * FROM email_webhook_worker_control WHERE environment=$1 FOR UPDATE', [environment]);
    const current = currentResult.rows[0];
    if (!current) throw new Error(`webhook worker control row not found for ${environment}`);
    if (Number(current.control_revision) !== expectedControlRevision) throw new Error(`control revision changed; current revision is ${current.control_revision}`);
    if (enabled) {
      const heartbeat = await client.query(
        `SELECT 1 FROM email_webhook_worker_heartbeats WHERE environment=$1 AND release_revision=$2
           AND worker_instance LIKE $3||'/%' AND enabled=true AND heartbeat_at>now()-interval '45 seconds' LIMIT 1`,
        [environment, release, deploymentId]
      );
      if (!heartbeat.rowCount) throw new Error('no fresh exact-deployment webhook worker heartbeat');
    }
    const nextRevision = expectedControlRevision + 1;
    const updated = await client.query(
      `UPDATE email_webhook_worker_control SET processing_enabled=$3, claiming_enabled=$3,
         minimum_release=CASE WHEN $3 THEN $4 ELSE minimum_release END, release_revision=$4,
         control_revision=$5, updated_at=now(), updated_by_actor=$6, reason=$7
       WHERE environment=$1 AND control_revision=$2 RETURNING *`,
      [environment, expectedControlRevision, enabled, release, nextRevision, actor, reason]
    );
    if (!updated.rowCount) throw new Error('stale webhook processing control revision');
    await client.query(
      `INSERT INTO email_control_audit(environment,control_name,control_revision,operation_id,previous_value,new_value,actor,reason)
       VALUES($1,'webhook_processing',$2,$3,$4,$5,$6,$7)`,
      [environment, nextRevision, crypto.randomUUID(), current, updated.rows[0], actor, reason]
    );
    await client.query('COMMIT');
    console.log(`webhook processing ${enabled ? 'enabled' : 'disabled'} for ${environment}; control revision ${nextRevision}`);
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
})().catch((error) => { console.error(error.message); process.exit(1); });
