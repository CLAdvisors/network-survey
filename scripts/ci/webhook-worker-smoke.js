'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const path = require('node:path');
const { createRequire } = require('node:module');

const apiRequire = createRequire(path.resolve(process.cwd(), 'api/package.json'));
const { Pool } = apiRequire('pg');
const { Webhook } = apiRequire('standardwebhooks');
const lifecycle = require('../../api/lifecycle');
const { DeliveryWorker } = require('../../api/email-worker');
const { ProviderError } = require('../../api/email');
const { ResendWebhookIngress } = require('../../api/webhooks');
const { WebhookWorker, effectiveProviderOutcome } = require('../../api/webhook-worker');

const pool = new Pool({
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT),
  database: process.env.DB_NAME,
});
const environment = 'test';
const providerAccountScope = 'ci-shared-resend-team';
const secret = `whsec_${Buffer.from('ci-webhook-secret-ci-webhook-secret').toString('base64')}`;
const signer = new Webhook(secret);
let eventSequence = 0;

function signedEvent(type, data, createdAt = new Date()) {
  eventSequence += 1;
  const id = `msg_ci_${String(eventSequence).padStart(4, '0')}`;
  const payload = JSON.stringify({ type, created_at: createdAt.toISOString(), data });
  return {
    rawBody: Buffer.from(payload),
    headers: {
      'svix-id': id,
      'svix-timestamp': String(Math.floor(createdAt.getTime() / 1000)),
      'svix-signature': signer.sign(id, createdAt, payload),
    },
  };
}

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
async function waitForAdvisoryWaiters(minimum) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const count = Number((await pool.query(`SELECT count(*)::int AS count FROM pg_locks WHERE locktype='advisory' AND NOT granted`)).rows[0].count);
    if (count >= minimum) return;
    await sleep(20);
  }
  throw new Error(`Timed out waiting for ${minimum} advisory lock waiters`);
}

(async () => {
  const actor = (await pool.query("SELECT id FROM users WHERE username='ci-smoke'")).rows[0];
  assert.ok(actor, 'API smoke user must exist');
  const survey = (await pool.query(`INSERT INTO survey(name,title,creation_date,questions,organization_id,lifecycle_status)
    SELECT 'CIWebhookSurvey','Webhook',now(),'{"elements":[{"type":"text","name":"question_1"}]}'::jsonb,organization_id,'draft'
    FROM survey WHERE name='CISmokeSurvey' RETURNING *`)).rows[0];
  await pool.query(`INSERT INTO respondent(name,contact_info,survey_name,survey_id,can_respond,uuid,lang,email_sent)
    VALUES('Webhook Person','webhook-person@example.test',$1,$2,true,'ci-webhook-person-token','English',false)`, [survey.name,survey.id]);
  await pool.query(`INSERT INTO email(survey_name,survey_id,lang,text) VALUES($1,$2,'English','Webhook delivery truth')`, [survey.name,survey.id]);
  await pool.query(`UPDATE email_worker_control SET claiming_enabled=true,minimum_release='' WHERE environment=$1`, [environment]);
  await pool.query(`UPDATE email_sending_control SET sending_enabled=true,minimum_release='' WHERE environment=$1`, [environment]);
  await pool.query(`INSERT INTO email_worker_heartbeats(environment,worker_instance,release_revision,enabled,claiming,heartbeat_at)
    VALUES($1,'ci-phase2','local',true,true,now()) ON CONFLICT(environment,worker_instance) DO UPDATE SET heartbeat_at=now(),enabled=true,claiming=true`, [environment]);
  const launch = await lifecycle.launchSurvey(pool, actor, survey.id, {
    kind: 'initial', idempotencyKey: '77777777-7777-4777-8777-777777777777',
  }, {
    NODE_ENV:'test', EMAIL_WORKER_ENV:environment, SURVEY_URL:process.env.SURVEY_URL,
    RESEND_API_KEY:'ci-key', SURVEY_DELIVERY_V2_ENABLED:'true', RESEND_PROVIDER_ACCOUNT_SCOPE:providerAccountScope,
  });
  const delivery = (await pool.query('SELECT * FROM survey_email_deliveries WHERE launch_id=$1', [launch.id])).rows[0];
  assert.ok(delivery);

  await pool.query(`UPDATE email_webhook_worker_control SET claiming_enabled=true,processing_enabled=true,minimum_release='' WHERE environment=$1`, [environment]);
  await pool.query(`UPDATE email_suppression_control SET enforcement_enabled=true,activated_at=now(),activated_by_actor='ci',activation_release='local',minimum_release='' WHERE environment=$1`, [environment]);

  const ingress = new ResendWebhookIngress({ pool, env:{
    EMAIL_WORKER_ENV:environment, RESEND_PROVIDER_ACCOUNT_SCOPE:providerAccountScope,
    RESEND_WEBHOOK_INGEST_ENABLED:'true', RESEND_WEBHOOK_SECRET:secret,
  }});
  const webhookWorker = new WebhookWorker({ pool, env:{
    EMAIL_WORKER_ENV:environment, RESEND_PROVIDER_ACCOUNT_SCOPE:providerAccountScope, RELEASE_REVISION:'local',
  }, instanceId:'ci-webhook-worker' });
  let providerCalls = 0;
  const deliveryWorker = new DeliveryWorker({
    pool,
    provider:{ send:async()=>{ providerCalls += 1; return { id:'should-not-send' }; } },
    env:{ NODE_ENV:'test',EMAIL_WORKER_ENV:environment,EMAIL_RATE_BUDGET_ENV:environment,RELEASE_REVISION:'local',
      SURVEY_URL:process.env.SURVEY_URL,EMAIL_RATE_PER_SECOND:'10',RESEND_PROVIDER_ACCOUNT_SCOPE:providerAccountScope },
    instanceId:'ci-delivery-worker',
  });

  const suppression = signedEvent('suppression.added', {
    id:'supp_ci_1', email:delivery.to_address, origin:'manual', source_id:null, created_at:new Date().toISOString(),
  });
  const inserted = await ingress.ingest(suppression.rawBody, suppression.headers);
  assert.equal(inserted.duplicate, false);
  const duplicate = await ingress.ingest(suppression.rawBody, suppression.headers);
  assert.equal(duplicate.duplicate, true, 'same svix-id must be acknowledged once');

  await pool.query(`UPDATE survey_email_deliveries SET next_attempt_at='1970-01-01' WHERE id=$1`, [delivery.id]);
  const claimed = await deliveryWorker.claim();
  assert.equal(claimed.id,delivery.id);
  const blocker = await pool.connect();
  const addressKey = `email-suppression-boundary:${providerAccountScope}:${delivery.to_address}`;
  await blocker.query('SELECT pg_advisory_lock(hashtextextended($1,0))', [addressKey]);
  const projecting = webhookWorker.processOne();
  await waitForAdvisoryWaiters(1);
  assert.equal(providerCalls, 0);
  await blocker.query('SELECT pg_advisory_unlock(hashtextextended($1,0))', [addressKey]);
  blocker.release();
  const projectionResult = await projecting;
  assert.equal(projectionResult,true);
  const suppressionCount = Number((await pool.query(`SELECT count(*)::int AS count FROM email_suppressions WHERE provider_account_scope=$1 AND normalized_address=$2 AND (provider_active OR locally_overridden_at IS NULL)`,[providerAccountScope,delivery.to_address])).rows[0].count);
  assert.equal(suppressionCount,1,'suppression must commit before delivery final check');
  const sending = deliveryWorker.startProviderRequest(claimed);
  await sending;
  assert.equal(providerCalls, 0, 'suppression committed first must prevent provider invocation');
  const cancelled = (await pool.query('SELECT status,provider_suppressed_at FROM survey_email_deliveries WHERE id=$1', [delivery.id])).rows[0];
  assert.equal(cancelled.status, 'cancelled');
  assert.ok(cancelled.provider_suppressed_at);

  await pool.query(`UPDATE survey_email_deliveries SET status='uncertain',provider_message_id='ci-phase2-provider-id',dispatch_failed_at=now(),provider_suppressed_at=NULL WHERE id=$1`, [delivery.id]);
  const deliveredEvent = signedEvent('email.delivered', {
    email_id:'ci-phase2-provider-id', to:[delivery.to_address],
    tags:{ app:'network_survey',environment,delivery_id:delivery.id },
  });
  await ingress.ingest(deliveredEvent.rawBody,deliveredEvent.headers);
  await webhookWorker.processOne();
  const projected = (await pool.query(`SELECT d.*,r.email_sent FROM survey_email_deliveries d JOIN respondent r ON r.respondent_id=d.respondent_id WHERE d.id=$1`, [delivery.id])).rows[0];
  assert.equal(projected.status,'accepted');
  assert.equal(projected.dispatch_failed_at,null);
  assert.ok(projected.dispatch_accepted_at);
  assert.ok(projected.provider_delivered_at);
  assert.equal(projected.email_sent,true);
  assert.equal(effectiveProviderOutcome(projected),'delivered');

  const complainedEvent = signedEvent('email.complained', {
    email_id:'ci-phase2-provider-id', to:[delivery.to_address],
    tags:{ app:'network_survey',environment,delivery_id:delivery.id },
  });
  await ingress.ingest(complainedEvent.rawBody,complainedEvent.headers);
  await webhookWorker.processOne();
  const complained = (await pool.query('SELECT * FROM survey_email_deliveries WHERE id=$1',[delivery.id])).rows[0];
  assert.ok(complained.provider_complained_at);
  assert.equal(effectiveProviderOutcome(complained),'complained');
  assert.equal((await pool.query(`SELECT count(*)::int AS count FROM email_webhook_events WHERE provider_account_scope=$1`,[providerAccountScope])).rows[0].count,3);

  // Persist the opposite suppression ordering: an ambiguous attempt first
  // enters retry_wait, then reconciliation must terminalize it as uncertain.
  // Refresh readiness after the preceding lock/race checks so this launch does
  // not depend on an earlier heartbeat remaining inside the freshness window.
  deliveryWorker.claiming=true;
  await deliveryWorker.heartbeat();
  webhookWorker.processing=true;
  await webhookWorker.heartbeat();
  const retrySurvey=(await pool.query(`INSERT INTO survey(name,title,creation_date,questions,organization_id,lifecycle_status) SELECT 'CIWebhookRetrySuppression','Retry suppression',now(),'{"elements":[{"type":"text","name":"question_1"}]}'::jsonb,organization_id,'draft' FROM survey WHERE id=$1 RETURNING *`,[survey.id])).rows[0];
  await pool.query(`INSERT INTO respondent(name,contact_info,survey_name,survey_id,can_respond,uuid,lang,email_sent) VALUES('Retry Suppression Person','retry-suppression@example.test',$1,$2,true,'ci-retry-suppression-token','English',false)`,[retrySurvey.name,retrySurvey.id]);
  await pool.query(`INSERT INTO email(survey_name,survey_id,lang,text) VALUES($1,$2,'English','Retry suppression invitation')`,[retrySurvey.name,retrySurvey.id]);
  const retryLaunch=await lifecycle.launchSurvey(pool,actor,retrySurvey.id,{kind:'initial',idempotencyKey:'abababab-abab-4bab-8bab-abababababab'},{NODE_ENV:'test',EMAIL_WORKER_ENV:environment,SURVEY_URL:process.env.SURVEY_URL,RESEND_API_KEY:'ci-key',SURVEY_DELIVERY_V2_ENABLED:'true',RESEND_PROVIDER_ACCOUNT_SCOPE:providerAccountScope});
  const retryDelivery=(await pool.query(`SELECT * FROM survey_email_deliveries WHERE launch_id=$1`,[retryLaunch.id])).rows[0];
  await pool.query(`UPDATE survey_email_deliveries SET next_attempt_at='1970-01-01' WHERE id=$1`,[retryDelivery.id]);
  const retryWorker=new DeliveryWorker({pool,provider:{send:async()=>{throw new ProviderError('CI suppression retry response was lost',{code:'ci_suppression_timeout',uncertain:true});}},env:deliveryWorker.env,instanceId:'ci-retry-suppression-worker'});
  const retryClaim=await retryWorker.claim();
  assert.equal(retryClaim.id,retryDelivery.id);
  const retryStarted=await retryWorker.startProviderRequest(retryClaim);
  assert.equal(retryStarted.action,'send');
  assert.ok(retryStarted.providerResult.error?.uncertain);

  // Force the ambiguous finalizer to queue for the delivery row before
  // suppression reconciliation. Once released, reconciliation's locking SELECT
  // must wait for that commit and its subsequent fresh snapshot must observe the
  // newly persisted uncertain attempt rather than cancelling the delivery.
  const deliveryBlocker=await pool.connect();
  await deliveryBlocker.query('BEGIN');
  await deliveryBlocker.query('SELECT id FROM survey_email_deliveries WHERE id=$1 FOR UPDATE',[retryDelivery.id]);
  const finalizing=retryWorker.finalizeFailure(retryStarted.row,retryStarted.providerResult.error);
  await new Promise(resolve=>setTimeout(resolve,100));
  const lateSuppression=signedEvent('suppression.added',{id:'supp_ci_retry',email:retryDelivery.to_address,origin:'manual',source_id:null,created_at:new Date().toISOString()});
  await ingress.ingest(lateSuppression.rawBody,lateSuppression.headers);
  const reconciling=webhookWorker.processOne();
  await new Promise(resolve=>setTimeout(resolve,100));
  await deliveryBlocker.query('COMMIT');
  deliveryBlocker.release();
  await Promise.all([finalizing,reconciling]);
  const retryScheduled=(await pool.query(`SELECT d.status,d.last_error_code,a.outcome,a.provider_started_at FROM survey_email_deliveries d JOIN survey_email_attempts a ON a.delivery_id=d.id WHERE d.id=$1`,[retryDelivery.id])).rows[0];
  assert.equal(retryScheduled.outcome,'uncertain');
  assert.ok(retryScheduled.provider_started_at);
  const retrySuppressed=(await pool.query(`SELECT status,last_error_code,dispatch_failed_at,provider_suppressed_at FROM survey_email_deliveries WHERE id=$1`,[retryDelivery.id])).rows[0];
  assert.equal(retrySuppressed.status,'uncertain');
  assert.equal(retrySuppressed.last_error_code,'ci_suppression_timeout');
  assert.ok(retrySuppressed.dispatch_failed_at);
  assert.ok(retrySuppressed.provider_suppressed_at);

  await pool.end();
  console.log('Phase 2 webhook PostgreSQL smoke passed');
})().catch(async (error) => {
  console.error(error);
  await pool.end().catch(() => {});
  process.exit(1);
});
