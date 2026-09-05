'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { Webhook } = require('standardwebhooks');
const {
  MAX_WEBHOOK_BYTES,
  ResendWebhookIngress,
  WebhookError,
  extractMetadata,
  verifyResendWebhook,
} = require('../webhooks');
const {
  WebhookWorker,
  canaryAddress,
  canaryTags,
  effectiveProviderOutcome,
  normalizeAddress,
  shouldApplySuppressionEvent,
  validateKnownEvent,
} = require('../webhook-worker');

function signedFixture(event, { secret = `whsec_${Buffer.from('fixture-secret-32-bytes-long!!!!').toString('base64')}`, date = new Date(), id = 'evt_fixture_1' } = {}) {
  const rawBody = Buffer.from(JSON.stringify(event));
  const webhook = new Webhook(secret);
  return {
    rawBody,
    secret,
    headers: {
      'svix-id': id,
      'svix-timestamp': String(Math.floor(date.getTime() / 1000)),
      'svix-signature': webhook.sign(id, date, rawBody),
    },
  };
}

const deliveryEvent = (type = 'email.delivered') => ({
  type,
  created_at: new Date().toISOString(),
  data: {
    email_id: 'email_123',
    to: ['person@example.test'],
    tags: { app: 'network_survey', environment: 'test', delivery_id: '11111111-1111-4111-8111-111111111111' },
  },
});

test('Resend SDK helper verifies exact raw bytes and rejects mutation, stale time, and missing headers', () => {
  const fixture = signedFixture(deliveryEvent());
  const result = verifyResendWebhook({
    rawBody: fixture.rawBody, headers: fixture.headers, primarySecret: fixture.secret,
  });
  assert.equal(result.event.type, 'email.delivered');
  assert.equal(result.verifiedWithPrevious, false);

  const mutated = Buffer.from(fixture.rawBody);
  mutated[mutated.length - 2] ^= 1;
  assert.throws(() => verifyResendWebhook({ rawBody: mutated, headers: fixture.headers, primarySecret: fixture.secret }),
    (error) => error instanceof WebhookError && error.code === 'invalid_signature');
  const stale = signedFixture(deliveryEvent(), { date: new Date(Date.now() - 6 * 60000) });
  assert.throws(() => verifyResendWebhook({ rawBody: stale.rawBody, headers: stale.headers, primarySecret: stale.secret }),
    (error) => error.code === 'invalid_signature');
  assert.throws(() => verifyResendWebhook({ rawBody: fixture.rawBody, headers: {}, primarySecret: fixture.secret }),
    (error) => error.status === 400);
});

test('verification supports bounded previous-secret overlap without exposing either secret', () => {
  const fixture = signedFixture(deliveryEvent(), { secret: `whsec_${Buffer.from('previous-secret-32-bytes-long!!!').toString('base64')}` });
  const result = verifyResendWebhook({
    rawBody: fixture.rawBody,
    headers: fixture.headers,
    primarySecret: `whsec_${Buffer.from('different-secret-32-bytes-long!!').toString('base64')}`,
    previousSecret: fixture.secret,
  });
  assert.equal(result.verifiedWithPrevious, true);
});

test('metadata accepts additive fields while bounding correlation fields', () => {
  const metadata = extractMetadata({ ...deliveryEvent(), future_addition: { value: true } });
  assert.equal(metadata.providerMessageId, 'email_123');
  assert.equal(metadata.appTag, 'network_survey');
  assert.throws(() => extractMetadata({ type: 'x'.repeat(129), created_at: new Date().toISOString() }), /event type/i);
});

test('ingress inserts verified JSONB bytes once with v1_7 names and acknowledges a duplicate', async () => {
  const calls = [];
  const client = {
    release() {},
    async query(sql, values = []) {
      calls.push({ sql, values });
      if (/INSERT INTO email_webhook_events/.test(sql)) return { rowCount: 0, rows: [] };
      return { rowCount: 0, rows: [] };
    },
  };
  const event = deliveryEvent();
  const rawBody = Buffer.from(JSON.stringify(event));
  const ingress = new ResendWebhookIngress({
    pool: { connect: async () => client },
    env: {
      NODE_ENV: 'test', RESEND_PROVIDER_ACCOUNT_SCOPE: 'resend-team',
      RESEND_WEBHOOK_INGEST_ENABLED: 'true', RESEND_WEBHOOK_SECRET: 'secret',
    },
    resend: { webhooks: { verify: () => event } },
    clock: () => new Date('2026-08-05T00:00:00Z'),
  });
  const result = await ingress.ingest(rawBody, {
    'svix-id': 'evt_1', 'svix-timestamp': '1785888000', 'svix-signature': 'v1,bounded',
  });
  assert.equal(result.duplicate, true);
  const insert = calls.find(({ sql }) => /INSERT INTO email_webhook_events/.test(sql));
  assert.match(insert.sql, /event_created_at/);
  assert.match(insert.sql, /raw_payload/);
  assert.match(insert.sql, /payload_size_bytes/);
  assert.match(insert.sql, /\$10::jsonb/);
  assert.equal(insert.values[10], rawBody.length);
  assert.equal(calls.at(-1).sql, 'COMMIT');
});

test('ingress is default-off, bounds raw requests, and validates rather than truncates scope', async () => {
  const pool = { connect: async () => { throw new Error('must not connect'); } };
  const disabled = new ResendWebhookIngress({ pool, env: { NODE_ENV: 'test', RESEND_PROVIDER_ACCOUNT_SCOPE: 'scope' } });
  await assert.rejects(() => disabled.ingest(Buffer.from('{}'), {}), (error) => error.code === 'ingest_disabled');
  assert.throws(() => new ResendWebhookIngress({ pool, env: { NODE_ENV: 'test', RESEND_PROVIDER_ACCOUNT_SCOPE: 'x'.repeat(129) } }), /128/);
  const enabled = new ResendWebhookIngress({ pool, env: { NODE_ENV: 'test', RESEND_PROVIDER_ACCOUNT_SCOPE: 'scope', RESEND_WEBHOOK_INGEST_ENABLED: 'true' } });
  await assert.rejects(() => enabled.ingest(Buffer.alloc(MAX_WEBHOOK_BYTES + 1), {}), (error) => error.status === 413);
});

test('provider suppression payloads accept documented nullable source IDs', () => {
  assert.equal(validateKnownEvent('suppression.removed',{data:{email:'person@example.com',source_id:null}}),null);
});

test('provider outcome precedence is independent and suppression ordering is deterministic', () => {
  assert.equal(effectiveProviderOutcome({ provider_delivered_at: 'x', provider_bounced_at: 'y' }), 'bounced');
  assert.equal(effectiveProviderOutcome({ provider_delivered_at: 'x', provider_complained_at: 'y' }), 'complained');
  const current = { state_occurrence_at: '2026-08-05T00:00:00Z', state_event_svix_id: 'evt_b', provider_active: false };
  assert.equal(shouldApplySuppressionEvent(current, { occurredAt: '2026-08-04T00:00:00Z', eventId: 'evt_z', active: true }), false);
  assert.equal(shouldApplySuppressionEvent(current, { occurredAt: '2026-08-05T00:00:00Z', eventId: 'evt_a', active: true }), true, 'equal-time adverse add wins');
  assert.equal(shouldApplySuppressionEvent({ ...current, provider_active: true }, { occurredAt: current.state_occurrence_at, eventId: 'evt_z', active: false }), false, 'equal-time removal loses');
  assert.equal(normalizeAddress(' Person@Example.COM '), 'person@example.com');
});

test('delivery projection preserves earliest facts and only event-specific evidence resolves dispatch', async () => {
  const queries = [];
  const client = { async query(sql, values = []) { queries.push({ sql, values }); return { rowCount: 1, rows: [] }; } };
  const worker = new WebhookWorker({ pool: {}, env: { NODE_ENV: 'test', RESEND_PROVIDER_ACCOUNT_SCOPE: 'scope' } });
  const delivery = { id: 'd', launch_id: 'launch-reminder', status: 'uncertain', respondent_id: 4, survey_id: 's' };
  const event = { event_type: 'email.delivered', event_created_at: '2026-08-05T00:00:00Z' };
  await worker.projectDelivery(client, event, deliveryEvent('email.delivered'), delivery);
  assert.match(queries[0].sql, /LEAST\(provider_delivered_at,\$2\)/);
  assert.ok(queries.some(({ sql }) => /SET status='accepted'/.test(sql)));
  const legacyFlag=queries.find(({ sql }) => /UPDATE respondent SET email_sent=true/.test(sql));
  assert.match(legacyFlag.sql,/l\.kind='initial'/);
  assert.equal(legacyFlag.values[2],'launch-reminder');
  assert.ok(queries.some(({sql})=>/reminder_pending.*reminder_retry_wait.*reminder_leased/.test(sql)));

  queries.length = 0;
  await worker.projectDelivery(client, { ...event, event_type: 'email.failed' }, deliveryEvent('email.failed'), delivery);
  assert.match(queries[0].sql, /provider_failed_at/);
  assert.equal(queries.some(({ sql }) => /SET status='accepted'/.test(sql)), false);
});

test('webhook correlation exact-matches bound reminders while allowing legacy null reminders to reconcile', async () => {
  const calls=[];
  const delivery={id:'11111111-1111-4111-8111-111111111111',provider_message_id:'provider-1'};
  const client={async query(sql,values){calls.push({sql,values});return{rows:[delivery],rowCount:1};}};
  const worker=new WebhookWorker({pool:{},env:{NODE_ENV:'test',RESEND_PROVIDER_ACCOUNT_SCOPE:'scope-a'}});
  const correlated=await worker.correlate(client,{provider_account_scope:'scope-a',provider_message_id:'provider-1'},{data:{email_id:'provider-1',tags:{app:'network_survey',environment:'test',delivery_id:delivery.id}}});
  assert.equal(correlated.id,delivery.id);
  assert.equal(calls.length,2);
  for(const call of calls){
    assert.equal(call.values[1],'scope-a');
    assert.match(call.sql,/JOIN survey_launches/);
    assert.match(call.sql,/l\.kind<>'reminder' OR l\.provider_account_scope IS NULL OR l\.provider_account_scope=\$2/);
  }
});

test('suppression reconciliation cannot cancel reminders bound to another provider account', async () => {
  const calls=[];
  const deliveryId='11111111-1111-4111-8111-111111111111';
  const client={release(){},async query(sql,values=[]){calls.push({sql,values});
    if(/SELECT d\.id FROM survey_email_deliveries/.test(sql))return{rowCount:1,rows:[{id:deliveryId}]};
    if(/SELECT d\.id,d\.status,EXISTS/.test(sql))return{rows:[{id:deliveryId,status:'reminder_pending'}]};
    if(/SELECT EXISTS\(SELECT 1 FROM email_suppressions/.test(sql))return{rows:[{suppressed:true}]};
    if(/UPDATE survey_email_deliveries SET status='cancelled'/.test(sql))return{rowCount:values[0].length,rows:[]};
    return{rowCount:0,rows:[]};
  }};
  const worker=new WebhookWorker({pool:{connect:async()=>client},env:{NODE_ENV:'test',RESEND_PROVIDER_ACCOUNT_SCOPE:'scope-a'}});
  const result=await worker.reconcileAddress('Person@Example.test');
  assert.deepEqual(result,{cancelled:1,fenced:0});
  const selection=calls.find(({sql})=>/SELECT d\.id FROM survey_email_deliveries/.test(sql));
  assert.deepEqual(selection.values,['person@example.test','scope-a']);
  assert.match(selection.sql,/JOIN survey_launches l ON l\.id=d\.launch_id/);
  assert.match(selection.sql,/l\.kind<>'reminder' OR l\.provider_account_scope IS NULL OR l\.provider_account_scope=\$2/);
});

test('suppression after ambiguous retry scheduling preserves terminal uncertain', async () => {
  const calls=[];
  const deliveryId='22222222-2222-4222-8222-222222222222';
  const client={release(){},async query(sql,values=[]){calls.push({sql,values});
    if(/SELECT d\.id FROM survey_email_deliveries/.test(sql))return{rowCount:1,rows:[{id:deliveryId}]};
    if(/SELECT d\.id,d\.status,EXISTS/.test(sql))return{rows:[{id:deliveryId,status:'reminder_pending',unresolved_provider_outcome:true}]};
    if(/SELECT EXISTS\(SELECT 1 FROM email_suppressions/.test(sql))return{rows:[{suppressed:true}]};
    if(/UPDATE survey_email_deliveries SET status='uncertain'/.test(sql))return{rowCount:1,rows:[]};
    return{rowCount:0,rows:[]};
  }};
  const worker=new WebhookWorker({pool:{connect:async()=>client},env:{NODE_ENV:'test',RESEND_PROVIDER_ACCOUNT_SCOPE:'scope-a'}});
  assert.deepEqual(await worker.reconcileAddress('Person@Example.test'),{cancelled:1,fenced:0});
  const preserved=calls.find(({sql})=>/SET status='uncertain'/.test(sql));
  assert.deepEqual(preserved.values,[[deliveryId]]);
  assert.match(preserved.sql,/dispatch_failed_at=COALESCE/);
  assert.equal(calls.some(({sql})=>/SET status='cancelled'/.test(sql)),false);
  assert.match(calls.find(({sql})=>/SELECT d\.id,d\.status,/.test(sql)).sql,/a\.outcome='uncertain'.*a\.provider_started_at IS NOT NULL/);
});

test('suppression fencing preserves the provider error on a claimed ambiguous retry', async () => {
  const calls=[];
  const deliveryId='33333333-3333-4333-8333-333333333333';
  const client={release(){},async query(sql,values=[]){calls.push({sql,values});
    if(/SELECT d\.id FROM survey_email_deliveries/.test(sql))return{rowCount:1,rows:[{id:deliveryId}]};
    if(/SELECT d\.id,d\.status,EXISTS/.test(sql))return{rows:[{id:deliveryId,status:'reminder_leased',unresolved_provider_outcome:true}]};
    if(/SELECT EXISTS\(SELECT 1 FROM email_suppressions/.test(sql))return{rows:[{suppressed:true}]};
    if(/cancellation_requested_at=COALESCE/.test(sql))return{rowCount:1,rows:[]};
    return{rowCount:0,rows:[]};
  }};
  const worker=new WebhookWorker({pool:{connect:async()=>client},env:{NODE_ENV:'test',RESEND_PROVIDER_ACCOUNT_SCOPE:'scope-a'}});
  assert.deepEqual(await worker.reconcileAddress('Person@Example.test'),{cancelled:0,fenced:1});
  const fenced=calls.find(({sql})=>/cancellation_requested_at=COALESCE/.test(sql));
  assert.deepEqual(fenced.values,[[deliveryId],[deliveryId]]);
  assert.match(fenced.sql,/last_error_code=CASE WHEN id=ANY\(\$2::uuid\[\]\) THEN last_error_code ELSE 'suppressed'/);
});

test('claim, replay, purge, and canary primitives use fenced v1_7 contracts', async () => {
  const calls = [];
  const client = {
    release() {},
    async query(sql, values = []) {
      calls.push({ sql, values });
      if (/worker_control/.test(sql)) return { rows: [{ claiming_enabled: true, processing_enabled: true, minimum_release: '' }] };
      if (/SELECT \* FROM email_webhook_events/.test(sql)) return { rows: [{ id: 7 }] };
      if (/UPDATE email_webhook_events SET status='leased'/.test(sql)) return { rows: [{ id: 7, lease_token: values[2] }] };
      if (/payload_expires_at/.test(sql) && /SELECT id,status/.test(sql)) return { rows: [{ id: 7, status: 'processed' }] };
      return { rowCount: 1, rows: [{ id: 7, replay_count: 1 }] };
    },
  };
  const pool = { connect: async () => client, query: client.query.bind(client) };
  const worker = new WebhookWorker({ pool, env: { NODE_ENV: 'test', RESEND_PROVIDER_ACCOUNT_SCOPE: 'scope' }, instanceId: 'worker' });
  const claimed = await worker.claim();
  assert.equal(claimed.id, 7);
  assert.ok(calls.some(({ sql }) => /FOR UPDATE SKIP LOCKED/.test(sql) && /NULLS FIRST/.test(sql)));
  assert.ok(calls.some(({ sql }) => /next_attempt_at=NULL/.test(sql) && /lease_token/.test(sql)));
  await worker.replay(7, 'operator@example.test', 'corrected projector deployment');
  const replayCall=calls.find(({ sql }) => /last_replayed_by_actor/.test(sql));
  assert.match(replayCall.sql,/status IN \('processed','ignored','dead_letter','unmatched'\)/);
  assert.match(replayCall.sql,/last_replay_reason/);
  assert.doesNotMatch(replayCall.sql,/processing_attempt_count=0/);
  await worker.purgeExpired(500);
  assert.ok(calls.some(({ sql, values }) => /ANY\(\$1::bigint\[\]\)/.test(sql) && values[0][0] === 7));
  await worker.claimCanary();
  const canaryClaim=calls.find(({sql})=>/UPDATE email_webhook_canary_state SET status='leased'/.test(sql));
  assert.match(canaryClaim.sql,/CASE WHEN status='idle' THEN \$3 ELSE COALESCE\(canary_token,\$3\) END/);
  assert.match(canaryClaim.sql,/provider_message_id=NULL/);
  assert.match(canaryClaim.sql,/correlated_webhook_event_id=NULL/);
  assert.match(canaryClaim.sql,/completed_at=NULL/);
  assert.equal(canaryAddress('Staging'), 'delivered+webhook-canary-staging@resend.dev');
  assert.deepEqual(canaryTags('test', 'token').map(({ name }) => name), ['app', 'environment', 'canary']);
});

test('canary polling configuration defaults invalid values and clamps finite bounds deterministically', () => {
  const cases = [
    ['missing', undefined, 60000],
    ['null', null, 60000],
    ['blank', '', 60000],
    ['whitespace', ' \t ', 60000],
    ['invalid', 'not-a-number', 60000],
    ['non-finite', 'Infinity', 60000],
    ['below minimum', '9999', 10000],
    ['above maximum', '300001', 300000],
  ];
  for (const [label, value, expected] of cases) {
    const env = { NODE_ENV: 'test', RESEND_PROVIDER_ACCOUNT_SCOPE: 'scope' };
    if (label !== 'missing') env.RESEND_WEBHOOK_CANARY_POLL_MS = value;
    const worker = new WebhookWorker({ pool: {}, env });
    assert.equal(worker.canaryPollMs, expected, label);
  }
});

test('idle event polling checks canary only at deterministic bounded intervals', async () => {
  let now = new Date('2026-08-05T00:00:00.000Z').getTime();
  let canaryClaims = 0;
  const worker = new WebhookWorker({
    pool: {},
    provider: {},
    env: { NODE_ENV: 'test', RESEND_PROVIDER_ACCOUNT_SCOPE: 'scope' },
    clock: () => new Date(now),
  });
  worker.claim = async () => null;
  worker.claimCanary = async () => { canaryClaims += 1; return null; };

  assert.equal(await worker.processOne(), false);
  assert.equal(canaryClaims, 1, 'startup is immediately eligible');
  for (let poll = 1; poll < 80; poll += 1) {
    now += 750;
    assert.equal(await worker.processOne(), false);
  }
  assert.equal(canaryClaims, 1, 'frequent idle event polls do not poll canary early');

  now = new Date('2026-08-05T00:01:00.000Z').getTime();
  assert.equal(await worker.processOne(), false);
  assert.equal(canaryClaims, 2, 'the exact default interval boundary is eligible');
});

test('an eligible startup canary is processed immediately after the event queue is found idle', async () => {
  const order = [];
  const canary = { canary_token: '11111111-1111-4111-8111-111111111111' };
  const worker = new WebhookWorker({
    pool: {},
    provider: {},
    env: { NODE_ENV: 'test', RESEND_PROVIDER_ACCOUNT_SCOPE: 'scope' },
    clock: () => new Date('2026-08-05T00:00:00.000Z'),
  });
  worker.claim = async () => { order.push('event'); return null; };
  worker.claimCanary = async () => { order.push('canary'); return canary; };
  worker.processCanary = async (claimed) => { assert.equal(claimed, canary); order.push('processed'); };

  assert.equal(await worker.processOne(), true);
  assert.deepEqual(order, ['event', 'canary', 'processed']);
});

test('canary projection is monotonic and historical replay cannot refresh health', async()=>{
  const calls=[];
  const client={async query(sql,values=[]){calls.push({sql,values});if(/SELECT \* FROM email_webhook_canary_state/.test(sql))return {rows:[{environment:'test',canary_token:'11111111-1111-4111-8111-111111111111'}]};return {rowCount:1,rows:[]};}};
  const worker=new WebhookWorker({pool:{},env:{NODE_ENV:'test',RESEND_PROVIDER_ACCOUNT_SCOPE:'scope'}});
  const payload={data:{email_id:'provider-1',tags:[{name:'canary',value:'11111111-1111-4111-8111-111111111111'}]}};
  await worker.projectCanaryEvent(client,{event_type:'email.sent',event_created_at:'2026-08-05T00:00:00Z',replay_count:0,id:1},payload);
  assert.match(calls.find(({sql})=>/SET status='awaiting_webhook'/.test(sql)).sql,/delivered_at IS NULL/);
  calls.length=0;
  await worker.projectCanaryEvent(client,{event_type:'email.delivered',event_created_at:'2026-08-05T00:01:00Z',replay_count:1,id:2},payload);
  assert.equal(calls.some(({sql})=>/^UPDATE email_webhook_canary_state/.test(sql.trim())),false);
});

test('reason-keyed suppression writes receiving-environment audit and keeps removals fail closed', async () => {
  const calls = [];
  const client = { async query(sql, values = []) {
    calls.push({ sql, values });
    if (/SELECT \* FROM email_suppressions/.test(sql)) return { rows: [] };
    return { rowCount: 1, rows: [] };
  } };
  const worker = new WebhookWorker({ pool: {}, env: { NODE_ENV: 'test', RESEND_PROVIDER_ACCOUNT_SCOPE: 'scope' } });
  await worker.upsertSuppression(client, {
    address: ' PERSON@example.com ', reason: 'provider_suppression', active: false,
    event: { id: 9, svix_id: 'evt_remove', event_created_at: '2026-08-05T00:00:00Z' },
    payload: { data: { email: 'person@example.com', source_id: 'sup_1' } },
  });
  const upsert = calls.find(({ sql }) => /INSERT INTO email_suppressions/.test(sql));
  assert.match(upsert.sql, /locally_overridden_at=NULL/);
  const audit = calls.find(({ sql }) => /INSERT INTO email_suppression_audit/.test(sql));
  assert.match(audit.sql, /receiving_environment/);
  assert.ok(audit.values.includes('test'));
  assert.ok(audit.values.includes('provider_remove'));
});
