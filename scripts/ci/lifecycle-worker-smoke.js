'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const { createRequire } = require('node:module');
const apiRequire = createRequire(path.resolve(process.cwd(), 'api/package.json'));
const { Pool } = apiRequire('pg');
const { DeliveryWorker } = require('../../api/email-worker');
const { reserveProviderRate } = require('../../api/email');
const lifecycle = require('../../api/lifecycle');

const pool = new Pool({
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT),
  database: process.env.DB_NAME,
});

(async () => {
  const actor = (await pool.query("SELECT id FROM users WHERE username='ci-smoke'")).rows[0];
  let signalProviderStarted;
  const providerStarted = new Promise((resolve) => { signalProviderStarted = resolve; });
  let acceptProviderRequest;
  let providerObserved = false;
  const accepted = new Promise((resolve) => { acceptProviderRequest = resolve; });
  const provider = {
    send: async () => {
      const marker = await pool.query(`SELECT 1 FROM survey_email_attempts a JOIN survey_email_deliveries d ON d.id=a.delivery_id WHERE d.survey_id=$1 AND a.outcome='in_progress' AND a.provider_started_at IS NOT NULL LIMIT 1`, [process.env.SURVEY_ID]);
      assert.equal(marker.rowCount, 1, 'provider boundary marker must commit before provider invocation');
      providerObserved = true;
      signalProviderStarted();
      return accepted;
    },
  };
  const worker = new DeliveryWorker({
    pool,
    provider,
    env: {
      NODE_ENV: 'test',
      EMAIL_WORKER_ENV: 'test',
      EMAIL_RATE_BUDGET_ENV: 'test',
      RELEASE_REVISION: 'local',
      SURVEY_URL: process.env.SURVEY_URL,
      EMAIL_RATE_PER_SECOND: '5',
    },
  });

  const competingWorker = new DeliveryWorker({ pool, provider, env: worker.env, instanceId: 'ci-competing-worker' });
  const [firstClaim, secondClaim] = await Promise.all([worker.claim(), competingWorker.claim()]);
  assert.ok(firstClaim && secondClaim);
  assert.notEqual(firstClaim.id, secondClaim.id, 'SKIP LOCKED must allocate distinct deliveries');
  await worker.finalizeAccepted({ ...firstClaim, lease_token: '00000000-0000-4000-8000-000000000000' }, 'stale-provider-id');
  assert.equal((await pool.query('SELECT status FROM survey_email_deliveries WHERE id=$1', [firstClaim.id])).rows[0].status, 'leased');
  await pool.query('DELETE FROM survey_email_attempts WHERE delivery_id=ANY($1::uuid[])', [[firstClaim.id, secondClaim.id]]);
  await pool.query(`UPDATE survey_email_deliveries SET status='pending',attempt_count=0,lease_owner=NULL,lease_token=NULL,lease_expires_at=NULL WHERE id=ANY($1::uuid[])`, [[firstClaim.id, secondClaim.id]]);

  await pool.query(`DELETE FROM email_rate_reservations WHERE environment='test'`);
  const reservations = await Promise.all(Array.from({ length: 8 }, () => reserveProviderRate(pool, 'test', 3)));
  assert.equal(reservations.filter(Boolean).length, 3, 'sliding provider budget must serialize concurrent reservations');
  await pool.query(`DELETE FROM email_rate_reservations WHERE environment='test'`);

  const boundaryBlocker = await pool.connect();
  await boundaryBlocker.query(`SELECT pg_advisory_lock(hashtextextended($1,0))`, [`survey-provider-boundary:${process.env.SURVEY_ID}`]);
  const processing = worker.processOne();
  await new Promise((resolve) => setTimeout(resolve, 100));
  let closeResolved = false;
  const closeRequest = lifecycle.transitionSurvey(pool, actor, process.env.SURVEY_ID, 'close').then((value) => { closeResolved = true; return value; });
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(providerObserved, false);
  assert.equal(closeResolved, false, 'close must wait behind an earlier provider-boundary waiter');
  await boundaryBlocker.query(`SELECT pg_advisory_unlock(hashtextextended($1,0))`, [`survey-provider-boundary:${process.env.SURVEY_ID}`]);
  boundaryBlocker.release();
  await providerStarted;
  assert.equal(closeResolved,false,'close must remain fenced for the full provider invocation');
  acceptProviderRequest({ id: 'ci-provider-message-id' });
  const closed = await closeRequest;
  assert.equal(closed.lifecycleStatus, 'closed');
  await processing;

  const delivery = (await pool.query(
    "SELECT status,cancellation_requested_at,provider_message_id FROM survey_email_deliveries WHERE survey_id=$1 AND provider_message_id='ci-provider-message-id'",
    [process.env.SURVEY_ID]
  )).rows[0];
  const attempt = (await pool.query(
    "SELECT provider_started_at,outcome FROM survey_email_attempts WHERE delivery_id=(SELECT id FROM survey_email_deliveries WHERE survey_id=$1 AND provider_message_id='ci-provider-message-id')",
    [process.env.SURVEY_ID]
  )).rows[0];
  assert.equal(delivery.status, 'accepted');
  // Close waited for the provider invocation. Depending on finalizer scheduling,
  // it either observed an accepted delivery or recorded a cancellation request.
  assert.equal(delivery.provider_message_id, 'ci-provider-message-id');
  assert.ok(attempt.provider_started_at);
  assert.equal(attempt.outcome, 'accepted');

  const concurrentSurvey = (await pool.query(`INSERT INTO survey(name,title,creation_date,questions,organization_id) SELECT 'CI Concurrent Launch','Concurrent',now(),'{"elements":[{"type":"text","name":"question_1"}]}'::jsonb,organization_id FROM survey WHERE id=$1 RETURNING *`, [process.env.SURVEY_ID])).rows[0];
  await pool.query(`INSERT INTO respondent(name,contact_info,survey_name,survey_id,can_respond,uuid,lang,email_sent) VALUES('Concurrent Person','concurrent@example.test',$1,$2,true,'ci-concurrent-token','English',false)`, [concurrentSurvey.name, concurrentSurvey.id]);
  await pool.query(`INSERT INTO email(survey_name,survey_id,lang,text) VALUES($1,$2,'English','Concurrent launch')`, [concurrentSurvey.name, concurrentSurvey.id]);
  const launches = await Promise.allSettled([
    lifecycle.launchSurvey(pool, actor, concurrentSurvey.id, { kind:'initial',idempotencyKey:'22222222-2222-4222-8222-222222222222' }),
    lifecycle.launchSurvey(pool, actor, concurrentSurvey.id, { kind:'initial',idempotencyKey:'33333333-3333-4333-8333-333333333333' }),
  ]);
  assert.equal(launches.filter(({ status }) => status === 'rejected').length, 0);
  assert.equal(new Set(launches.map(({ value }) => value.id)).size, 1, 'concurrent initial launches must converge on one launch');
  assert.equal(launches.filter(({ value }) => value.replayed).length, 1);
  assert.equal((await pool.query('SELECT count(*)::int AS count FROM survey_launches WHERE survey_id=$1', [concurrentSurvey.id])).rows[0].count, 1);
})().finally(() => pool.end());
