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
      RESEND_PROVIDER_ACCOUNT_SCOPE: 'ci-test',
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

  // Real PostgreSQL reminder races: reject overlapping campaigns and let a
  // completion holding the shared survey boundary cancel before provider I/O.
  await pool.query(`UPDATE survey_email_deliveries SET status='cancelled',last_error_code='ci_cleanup' WHERE status IN ('pending','retry_wait','reminder_pending','reminder_retry_wait')`);
  const reminderSurvey=(await pool.query(`INSERT INTO survey(name,title,creation_date,questions,organization_id,lifecycle_status,started_at) SELECT 'CI Reminder Race','Reminder',now(),'{}'::jsonb,organization_id,'active',now() FROM survey WHERE id=$1 RETURNING *`,[process.env.SURVEY_ID])).rows[0];
  const reminderRespondent=(await pool.query(`INSERT INTO respondent(name,contact_info,survey_name,survey_id,can_respond,uuid,lang,email_sent) VALUES('Reminder Person','reminder@example.test',$1,$2,true,'ci-existing-reminder-token','English',true) RETURNING respondent_id`,[reminderSurvey.name,reminderSurvey.id])).rows[0];
  await pool.query(`INSERT INTO survey_reminder_templates(survey_id,language,subject,body_text,updated_by_user_id) VALUES($1,'english','Reminder','Please complete the survey.',$2)`,[reminderSurvey.id,actor.id]);
  worker.claiming=true;
  await worker.heartbeat();
  const reminderConfig={NODE_ENV:'test',SURVEY_DELIVERY_V2_ENABLED:'true',SURVEY_URL:process.env.SURVEY_URL,RESEND_API_KEY:'fake-only',RESEND_PROVIDER_ACCOUNT_SCOPE:'ci-test'};
  await assert.rejects(
    lifecycle.launchReminder(pool,actor,reminderSurvey.id,{idempotencyKey:'66666666-6666-4666-8666-666666666666'},{...reminderConfig,RESEND_PROVIDER_ACCOUNT_SCOPE:'wrong-scope'}),
    error=>error.code==='survey_not_ready'&&error.details?.blockers?.some(({code})=>code==='worker_unavailable'),
    'a heartbeat for another provider account must not make reminder launch ready'
  );
  const reminder=await lifecycle.launchReminder(pool,actor,reminderSurvey.id,{idempotencyKey:'44444444-4444-4444-8444-444444444444'},reminderConfig);
  assert.equal(reminder.target_count,1);
  const legacyVisible=await pool.query(`SELECT id FROM survey_email_deliveries WHERE launch_id=$1 AND ((status IN ('pending','retry_wait') AND next_attempt_at<=now()) OR (status='leased' AND lease_expires_at<=now()))`,[reminder.id]);
  assert.equal(legacyVisible.rowCount,0,'legacy worker claim SQL must not see reminder queue states');
  await assert.rejects(
    lifecycle.launchReminder(pool,actor,reminderSurvey.id,{idempotencyKey:'55555555-5555-4555-8555-555555555555'},reminderConfig),
    error=>error.code==='reminder_in_progress'
  );
  let reminderProviderCalls=0;
  const reminderWorker=new DeliveryWorker({pool,provider:{send:async()=>{reminderProviderCalls+=1;return{id:'must-not-send'};}},env:worker.env,instanceId:'ci-reminder-worker'});
  const completion=await pool.connect();
  await completion.query('BEGIN');
  await completion.query(`SELECT pg_advisory_xact_lock(hashtextextended($1,0))`,[`survey-provider-boundary:${reminderSurvey.id}`]);
  await completion.query(`UPDATE respondent SET response='{}'::jsonb WHERE respondent_id=$1`,[reminderRespondent.respondent_id]);
  const reminderProcessing=reminderWorker.processOne();
  await new Promise(resolve=>setTimeout(resolve,100));
  await completion.query('COMMIT');
  completion.release();
  await reminderProcessing;
  assert.equal(reminderProviderCalls,0,'completion before provider boundary must prevent provider I/O');
  const cancelled=(await pool.query(`SELECT status,last_error_code FROM survey_email_deliveries WHERE launch_id=$1`,[reminder.id])).rows[0];
  assert.deepEqual(cancelled,{status:'cancelled',last_error_code:'response_completed'});
})().finally(() => pool.end());
