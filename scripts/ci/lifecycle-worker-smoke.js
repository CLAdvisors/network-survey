'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const { createRequire } = require('node:module');
const apiRequire = createRequire(path.resolve(process.cwd(), 'api/package.json'));
const { Pool } = apiRequire('pg');
const { DeliveryWorker } = require('../../api/email-worker');
const { ProviderError, reserveProviderRate, reserveProviderRateWithAvailabilityInTransaction } = require('../../api/email');
const lifecycle = require('../../api/lifecycle');

const poolConfig = {
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT),
  database: process.env.DB_NAME,
};
const pool = new Pool(poolConfig);

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

  const schedulingClient=await pool.connect();
  try{
    await schedulingClient.query('BEGIN');
    const seeded=(await schedulingClient.query(`INSERT INTO email_rate_reservations(environment,reserved_at) VALUES('test-rate-schedule',clock_timestamp()) RETURNING reserved_at`)).rows[0];
    const denied=await reserveProviderRateWithAvailabilityInTransaction(schedulingClient,'test-rate-schedule',1);
    const observedAfter=(await schedulingClient.query(`SELECT clock_timestamp() AS value`)).rows[0].value;
    assert.equal(denied.reserved,false);
    assert.equal(new Date(denied.nextAvailableAt).getTime(),new Date(seeded.reserved_at).getTime()+1000,'rate-wait retry must target expiry of the oldest active reservation');
    const minimumRemaining=Math.max(0,new Date(denied.nextAvailableAt).getTime()-new Date(observedAfter).getTime());
    assert.ok(denied.retryAfterMs>=minimumRemaining-1&&denied.retryAfterMs<=1000,`database-derived retry duration ${denied.retryAfterMs}ms was outside [${minimumRemaining-1},1000]`);
    await schedulingClient.query('ROLLBACK');
  }finally{schedulingClient.release();}

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

  const acceptedDelivery=(await pool.query(`SELECT id FROM survey_email_deliveries WHERE survey_id=$1 AND provider_message_id='ci-provider-message-id'`,[process.env.SURVEY_ID])).rows[0];
  await pool.query(`INSERT INTO survey_email_attempts(delivery_id,attempt_number,lease_token,outcome,finished_at,error_message) VALUES($1,2,gen_random_uuid(),'cancelled',now(),'provider_rate_wait'),($1,3,gen_random_uuid(),'cancelled',now(),'provider_rate_wait')`,[acceptedDelivery.id]);
  const history=await lifecycle.listEmailHistory(pool,actor,process.env.SURVEY_ID,{}, {SESSION_SECRET:'ci-email-history-secret'});
  const acceptedHistory=history.messages.find(message=>message.status.code==='provider_accepted');
  assert.equal(acceptedHistory.attempts,3,'history must retain all worker-attempt diagnostics');
  assert.equal(acceptedHistory.providerAttempts,1,'history must count only committed provider boundary crossings');
  assert.equal(JSON.stringify(acceptedHistory).includes('provider_rate_wait'),false,'history must not expose internal attempt errors');

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

  // A continuously due backlog must park each process after an authoritative
  // rate denial instead of walking and rewriting every queued delivery.
  const backlogSurvey=(await pool.query(`INSERT INTO survey(name,title,creation_date,questions,organization_id) SELECT 'CI Rate Backlog','Rate backlog',now(),'{"elements":[{"type":"text","name":"question_1"}]}'::jsonb,organization_id FROM survey WHERE id=$1 RETURNING *`,[process.env.SURVEY_ID])).rows[0];
  await pool.query(`INSERT INTO respondent(name,contact_info,survey_name,survey_id,can_respond,uuid,lang,email_sent) SELECT 'Backlog Person '||n,'backlog-'||n||'@example.test',$1,$2,true,'ci-backlog-token-'||n,'English',false FROM generate_series(1,12) n`,[backlogSurvey.name,backlogSurvey.id]);
  await pool.query(`INSERT INTO email(survey_name,survey_id,lang,text) VALUES($1,$2,'English','Rate backlog invitation')`,[backlogSurvey.name,backlogSurvey.id]);
  const backlogLaunch=await lifecycle.launchSurvey(pool,actor,backlogSurvey.id,{kind:'initial',idempotencyKey:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'},{...worker.env,SURVEY_DELIVERY_V2_ENABLED:'true',RESEND_API_KEY:'fake-only'});
  assert.equal(backlogLaunch.target_count,12);
  const backlogEnvironment=`test-backlog-${backlogSurvey.id}`;
  let backlogProviderSequence=0;
  const backlogProvider={send:async()=>({id:`ci-backlog-provider-${++backlogProviderSequence}`})};
  const backlogEnv={...worker.env,EMAIL_RATE_BUDGET_ENV:backlogEnvironment,EMAIL_RATE_PER_SECOND:'2'};
  // Future-dated fixture reservations keep the budget deterministically full even
  // if a loaded CI runner pauses before the workers reach the limiter.
  await pool.query(`INSERT INTO email_rate_reservations(environment,reserved_at) VALUES($1,clock_timestamp()+interval '5 seconds'),($1,clock_timestamp()+interval '5 seconds')`,[backlogEnvironment]);
  let parkedCount=0;
  let signalAllParked;
  const allParked=new Promise(resolve=>{signalAllParked=resolve;});
  let releaseParked;
  const parkedGate=new Promise(resolve=>{releaseParked=resolve;});
  const park=async(delay)=>{assert.ok(delay>=5&&delay<=1125);parkedCount+=1;if(parkedCount===2)signalAllParked();await parkedGate;};
  const parkedWorkers=[
    new DeliveryWorker({pool,provider:backlogProvider,env:backlogEnv,random:()=>0,sleepFn:park,instanceId:'ci-backlog-parked-worker-1'}),
    new DeliveryWorker({pool,provider:backlogProvider,env:backlogEnv,random:()=>0,sleepFn:park,instanceId:'ci-backlog-parked-worker-2'}),
  ];
  const lockProbe=await pool.connect();
  const parkedRuns=parkedWorkers.map(parkedWorker=>parkedWorker.run());
  try{
    await Promise.race([allParked,new Promise((_,reject)=>setTimeout(()=>reject(new Error('workers did not park after rate denial')),3000))]);
    const parkedStats=(await pool.query(`SELECT count(*)::int AS attempts,count(*) FILTER (WHERE a.error_message='provider_rate_wait')::int AS rate_waits,count(*) FILTER (WHERE d.status='leased')::int AS leased FROM survey_email_attempts a JOIN survey_email_deliveries d ON d.id=a.delivery_id WHERE d.survey_id=$1`,[backlogSurvey.id])).rows[0];
    assert.deepEqual(parkedStats,{attempts:2,rate_waits:2,leased:0},'full budget should park each process after one row, not walk the backlog');
    const parkedAddresses=(await pool.query(`SELECT d.to_address FROM survey_email_attempts a JOIN survey_email_deliveries d ON d.id=a.delivery_id WHERE d.survey_id=$1 AND a.error_message='provider_rate_wait' ORDER BY d.to_address`,[backlogSurvey.id])).rows.map(({to_address})=>String(to_address).trim().toLowerCase());
    const lockKeys=[
      `email-provider-boundary:${worker.environment}`,
      `survey-provider-boundary:${backlogSurvey.id}`,
      `email-rate-budget:${backlogEnvironment}`,
      ...parkedAddresses.map(address=>`email-suppression-boundary:${backlogEnv.RESEND_PROVIDER_ACCOUNT_SCOPE}:${address}`),
    ];
    for(const key of lockKeys){
      assert.equal((await lockProbe.query(`SELECT pg_try_advisory_lock(hashtextextended($1,0)) AS acquired`,[key])).rows[0].acquired,true,`parked worker retained ${key}`);
      await lockProbe.query(`SELECT pg_advisory_unlock(hashtextextended($1,0))`,[key]);
    }
  }finally{
    lockProbe.release();
    parkedWorkers.forEach(parkedWorker=>parkedWorker.stop());
    releaseParked();
    await Promise.allSettled(parkedRuns);
  }
  await pool.query(`DELETE FROM email_rate_reservations WHERE environment=$1`,[backlogEnvironment]);
  await pool.query(`UPDATE survey_email_deliveries SET next_attempt_at=now() WHERE survey_id=$1 AND status='retry_wait'`,[backlogSurvey.id]);

  const backlogWorkers=[
    new DeliveryWorker({pool,provider:backlogProvider,env:backlogEnv,random:()=>0,instanceId:'ci-backlog-worker-1'}),
    new DeliveryWorker({pool,provider:backlogProvider,env:backlogEnv,random:()=>0,instanceId:'ci-backlog-worker-2'}),
  ];
  const backlogDeadline=Date.now()+30000;
  const drainBacklog=async(backlogWorker)=>{
    while(Date.now()<backlogDeadline){
      const remaining=Number((await pool.query(`SELECT count(*)::int AS count FROM survey_email_deliveries WHERE survey_id=$1 AND status IN ('pending','retry_wait','leased')`,[backlogSurvey.id])).rows[0].count);
      if(remaining===0)return;
      if(!await backlogWorker.processOne())await new Promise(resolve=>setTimeout(resolve,10));
    }
    throw new Error('rate backlog did not drain within 30 seconds');
  };
  await Promise.all(backlogWorkers.map(drainBacklog));
  const backlogStats=(await pool.query(`SELECT count(DISTINCT d.id) FILTER (WHERE d.status='accepted')::int AS accepted,count(a.provider_started_at)::int AS provider_attempts,count(*) FILTER (WHERE a.error_message='provider_rate_wait')::int AS rate_waits,count(DISTINCT d.id) FILTER (WHERE a.provider_started_at IS NOT NULL)::int AS provider_deliveries FROM survey_email_deliveries d JOIN survey_email_attempts a ON a.delivery_id=d.id WHERE d.survey_id=$1`,[backlogSurvey.id])).rows[0];
  assert.equal(backlogStats.accepted,12);
  assert.equal(backlogStats.provider_attempts,12);
  assert.equal(backlogStats.provider_deliveries,12);
  const peakWindow=Number((await pool.query(`SELECT COALESCE(max((SELECT count(*) FROM email_rate_reservations b WHERE b.environment=a.environment AND b.reserved_at>a.reserved_at-interval '1 second' AND b.reserved_at<=a.reserved_at)),0)::int AS peak FROM email_rate_reservations a WHERE a.environment=$1`,[backlogEnvironment])).rows[0].peak);
  assert.ok(peakWindow<=2,`cross-process sliding-window limit exceeded: ${peakWindow}`);

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

  // If close fences a leased reminder after provider I/O has begun, an
  // ambiguous provider result must remain terminal uncertain, never cancelled
  // or retryable. This preserves the recipient quarantine for future reminders.
  const ambiguousSurvey=(await pool.query(`INSERT INTO survey(name,title,creation_date,questions,organization_id,lifecycle_status,started_at) SELECT 'CI Ambiguous Close Race','Ambiguous close',now(),'{}'::jsonb,organization_id,'active',now() FROM survey WHERE id=$1 RETURNING *`,[process.env.SURVEY_ID])).rows[0];
  await pool.query(`INSERT INTO respondent(name,contact_info,survey_name,survey_id,can_respond,uuid,lang,email_sent) VALUES('Ambiguous Person','ambiguous@example.test',$1,$2,true,'ci-ambiguous-token','English',true)`,[ambiguousSurvey.name,ambiguousSurvey.id]);
  await pool.query(`INSERT INTO survey_reminder_templates(survey_id,language,subject,body_text,updated_by_user_id) VALUES($1,'english','Reminder','Please complete the survey.',$2)`,[ambiguousSurvey.id,actor.id]);
  const ambiguousLaunch=await lifecycle.launchReminder(pool,actor,ambiguousSurvey.id,{idempotencyKey:'88888888-8888-4888-8888-888888888888'},reminderConfig);
  let signalAmbiguousProvider;
  const ambiguousProviderStarted=new Promise(resolve=>{signalAmbiguousProvider=resolve;});
  let rejectAmbiguousProvider;
  const ambiguousProviderResult=new Promise((resolve,reject)=>{rejectAmbiguousProvider=reject;});
  const ambiguousWorker=new DeliveryWorker({pool,provider:{send:async()=>{signalAmbiguousProvider();return ambiguousProviderResult;}},env:worker.env,instanceId:'ci-ambiguous-worker'});
  const ambiguousDelivery=await ambiguousWorker.claim();
  assert.equal(ambiguousDelivery.launch_id,ambiguousLaunch.id);
  const providerRequest=ambiguousWorker.startProviderRequest(ambiguousDelivery);
  await ambiguousProviderStarted;
  let ambiguousCloseResolved=false;
  const ambiguousClose=lifecycle.transitionSurvey(pool,actor,ambiguousSurvey.id,'close').then(value=>{ambiguousCloseResolved=true;return value;});
  await new Promise(resolve=>setTimeout(resolve,250));
  assert.equal(ambiguousCloseResolved,false,'close must not resolve while the provider boundary is active');
  rejectAmbiguousProvider(new ProviderError('CI provider response was lost',{code:'ci_provider_timeout',uncertain:true}));
  const ambiguousStarted=await providerRequest;
  assert.equal(ambiguousStarted.action,'send');
  const ambiguousFinalization=ambiguousWorker.finalizeFailure(ambiguousStarted.row,ambiguousStarted.providerResult.error);
  await Promise.all([ambiguousClose,ambiguousFinalization]);
  const ambiguousState=(await pool.query(`SELECT d.status,d.cancellation_requested_at,d.last_error_code,a.outcome FROM survey_email_deliveries d JOIN survey_email_attempts a ON a.delivery_id=d.id WHERE d.id=$1`,[ambiguousDelivery.id])).rows[0];
  assert.equal(ambiguousState.status,'uncertain');
  // Scheduling determines whether close records a cancellation request before
  // or after the ambiguous finalizer, but neither ordering may erase ambiguity.
  assert.equal(ambiguousState.last_error_code,'ci_provider_timeout');
  assert.equal(ambiguousState.outcome,'uncertain');

  // Exercise the opposite serialization order: the ambiguous finalizer wins,
  // schedules an idempotent retry, and close runs afterward.
  const retryFirstSurvey=(await pool.query(`INSERT INTO survey(name,title,creation_date,questions,organization_id,lifecycle_status,started_at) SELECT 'CI Ambiguous Retry Then Close','Retry then close',now(),'{}'::jsonb,organization_id,'active',now() FROM survey WHERE id=$1 RETURNING *`,[process.env.SURVEY_ID])).rows[0];
  await pool.query(`INSERT INTO respondent(name,contact_info,survey_name,survey_id,can_respond,uuid,lang,email_sent) VALUES('Retry First Person','retry-first@example.test',$1,$2,true,'ci-retry-first-token','English',true)`,[retryFirstSurvey.name,retryFirstSurvey.id]);
  await pool.query(`INSERT INTO survey_reminder_templates(survey_id,language,subject,body_text,updated_by_user_id) VALUES($1,'english','Reminder','Please complete the survey.',$2)`,[retryFirstSurvey.id,actor.id]);
  const retryFirstLaunch=await lifecycle.launchReminder(pool,actor,retryFirstSurvey.id,{idempotencyKey:'99999999-9999-4999-8999-999999999999'},reminderConfig);
  const retryFirstWorker=new DeliveryWorker({pool,provider:{send:async()=>{throw new ProviderError('CI retry-first response was lost',{code:'ci_retry_first_timeout',uncertain:true});}},env:worker.env,instanceId:'ci-retry-first-worker'});
  await retryFirstWorker.processOne();
  const scheduled=(await pool.query(`SELECT d.id,d.status,d.last_error_code,a.outcome,a.provider_started_at FROM survey_email_deliveries d JOIN survey_email_attempts a ON a.delivery_id=d.id WHERE d.launch_id=$1`,[retryFirstLaunch.id])).rows[0];
  assert.equal(scheduled.status,'reminder_retry_wait');
  assert.equal(scheduled.outcome,'uncertain');
  assert.ok(scheduled.provider_started_at);
  await lifecycle.transitionSurvey(pool,actor,retryFirstSurvey.id,'close');
  const closedRetry=(await pool.query(`SELECT status,last_error_code,dispatch_failed_at FROM survey_email_deliveries WHERE id=$1`,[scheduled.id])).rows[0];
  assert.equal(closedRetry.status,'uncertain');
  assert.equal(closedRetry.last_error_code,'ci_retry_first_timeout');
  assert.ok(closedRetry.dispatch_failed_at);
  await lifecycle.transitionSurvey(pool,actor,retryFirstSurvey.id,'reopen');
  const retryFirstReadiness=await lifecycle.getReminderReadiness(pool,actor,retryFirstSurvey.id,reminderConfig);
  assert.equal(retryFirstReadiness.uncertainExcludedCount,1,'later reminders must exclude the unresolved recipient');
})().finally(() => pool.end());
