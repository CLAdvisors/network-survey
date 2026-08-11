'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { renderInvitation, buildInvitationPayload, payloadHash, ResendProvider, classifyProviderError, ProviderError, reserveProviderRateOnClient } = require('../email');
const { evaluateReadiness, aggregateSelect, fingerprint, launchSurvey, transitionSurvey } = require('../lifecycle');
const { DeliveryWorker, isOutsideProviderIdempotencyWindow, canRetryAmbiguous } = require('../email-worker');

test('invitation rendering escapes templates and emits equivalent accessible HTML/text', () => {
  const token = 'respondent-token-123';
  const payload = buildInvitationPayload({
    to: 'person@example.com', bodyText: 'Hello <script>alert(1)</script>\n\nPlease participate.',
    surveyBaseUrl: 'https://survey.example.test/form', surveyName: 'Leadership & Team', token, language: 'English',
  });
  assert.match(payload.html, /<html lang="en">/);
  assert.match(payload.html, /alt="Contemporary Leadership Advisors"/);
  assert.match(payload.html, />Open your CLA Network Survey</);
  assert.doesNotMatch(payload.html, /<script>/);
  assert.match(payload.html, /&lt;script&gt;/);
  assert.match(payload.text, /Please participate/);
  assert.match(payload.text, /privacy questions/i);
  assert.equal((payload.html.match(new RegExp(token, 'g')) || []).length, 1);
  assert.equal((payload.text.match(new RegExp(token, 'g')) || []).length, 1);
  assert.doesNotMatch(payload.html, /stripe|lorem ipsum/i);
});

test('Resend HTTP provider transmits idempotency and requires an accepted message id', async () => {
  let request;
  const provider = new ResendProvider({ apiKey: 'secret', fetchImpl: async (url, options) => {
    request = { url, options };
    return { ok: true, status: 200, json: async () => ({ id: 'provider-1' }), headers: { get: () => null } };
  }});
  assert.deepEqual(await provider.send({ from:'a',to:'b',subject:'s',html:'h',text:'t' }, { idempotencyKey:'survey-delivery/1' }), { id:'provider-1' });
  assert.equal(request.options.headers['Idempotency-Key'], 'survey-delivery/1');
  assert.equal(request.options.headers.Authorization, 'Bearer secret');

  const missing = new ResendProvider({ apiKey:'secret', fetchImpl: async () => ({ ok:true,status:200,json:async()=>({}),headers:{get:()=>null} }) });
  await assert.rejects(() => missing.send({}, { idempotencyKey:'key' }), (error) => error.code === 'missing_provider_id' && error.uncertain);
});

test('resolved provider error objects fail and retry classification is conservative', async () => {
  const provider = new ResendProvider({ apiKey:'secret', fetchImpl:async()=>({ok:true,status:200,json:async()=>({error:{name:'rate_limit_exceeded',message:'slow down'}}),headers:{get:()=> '2'}}) });
  await assert.rejects(() => provider.send({}, {idempotencyKey:'key'}), (error) => error instanceof ProviderError && error.status === 200);
  assert.equal(classifyProviderError(new ProviderError('retry',{status:503})), 'ambiguous');
  assert.equal(classifyProviderError(new ProviderError('bad',{status:422})), 'permanent');
  assert.equal(classifyProviderError(new ProviderError('still processing',{status:409,code:'concurrent_idempotent_requests'})), 'ambiguous');
  assert.equal(classifyProviderError(new ProviderError('plan exhausted',{status:429,code:'monthly_quota_exceeded'})), 'quota');
  assert.equal(classifyProviderError(new ProviderError('timeout',{uncertain:true})), 'ambiguous');
});

test('retained provider-boundary clients reserve rate capacity without reconnecting', async () => {
  const calls=[];
  const client={async query(sql,values=[]){calls.push({sql,values});if(/SELECT count/.test(sql))return {rows:[{count:0}]};return {rowCount:1,rows:[]};}};
  assert.equal(await reserveProviderRateOnClient(client,'test',1),true);
  assert.match(calls[0].sql,/BEGIN/);
  assert.ok(calls.some(({values})=>values.includes('email-rate-budget:test')));
  assert.match(calls.at(-1).sql,/COMMIT/);
});

test('readiness validates the entire audience and exact normalized template coverage', () => {
  const survey = { lifecycle_status:'draft', archived_at:null, questions:{elements:[{name:'q1',type:'text'}]} };
  const good = evaluateReadiness(survey, { recipients:[{respondent_id:1,contact_info:'A@example.com',uuid:'token',lang:'English'}], templates:[{lang:' english ',text:'Welcome'}] }, {SURVEY_URL:'https://survey.test',RESEND_API_KEY:'key'});
  assert.equal(good.canLaunch,true);
  assert.deepEqual(good.languages,['english']);
  assert.deepEqual(good.templateCoverage,[{language:'english',covered:true}]);
  const bad = evaluateReadiness(survey, { recipients:[
    {respondent_id:1,contact_info:'same@example.com',uuid:'token',lang:'French'},
    {respondent_id:2,contact_info:'SAME@example.com',uuid:null,lang:'French'},
  ], templates:[{lang:'English',text:'Welcome'}] }, {SURVEY_URL:'https://survey.test',RESEND_API_KEY:'key'});
  assert.equal(bad.canLaunch,false);
  assert.ok(bad.blockers.some(({code})=>code==='recipient_email_duplicate'));
  assert.ok(bad.blockers.some(({code})=>code==='recipient_token_missing'));
  assert.ok(bad.blockers.some(({code})=>code==='template_missing'));
  const unsupported = evaluateReadiness(survey, { recipients:[{respondent_id:3,contact_info:'x@example.com',uuid:'token',lang:'Klingon'}], templates:[{lang:'Klingon',text:'Qapla'}] }, {SURVEY_URL:'https://survey.test',RESEND_API_KEY:'key'});
  assert.ok(unsupported.blockers.some(({code})=>code==='recipient_language_unsupported'));
  const duplicate = evaluateReadiness(survey, { recipients:[{respondent_id:4,contact_info:'x@example.com',uuid:'token',lang:'English'}], templates:[{lang:'English',text:'Welcome'},{lang:' english ',text:'  '}] }, {SURVEY_URL:'https://survey.test',RESEND_API_KEY:'key'});
  assert.ok(duplicate.blockers.some(({code})=>code==='template_duplicate'));
  const manyInvalid = evaluateReadiness(survey, { recipients:Array.from({length:150},(_,index)=>({respondent_id:index,contact_info:'invalid',uuid:null,lang:''})), templates:[] }, {SURVEY_URL:'https://survey.test',RESEND_API_KEY:'key'});
  assert.ok(manyInvalid.blockerCount > 100);
  assert.equal(manyInvalid.blockers.length, 101);
  assert.equal(manyInvalid.blockers.at(-1).code, 'blockers_truncated');
});

test('launch fingerprint is canonical and aggregate SQL derives dispatch and distinct provider summary counts', () => {
  assert.equal(fingerprint({targets:[1,2]}), fingerprint({targets:[1,2]}));
  assert.notEqual(fingerprint({targets:[1,2]}), fingerprint({targets:[2,1]}));
  const sql = aggregateSelect('WHERE l.survey_id=$1');
  for (const state of ['pending','leased','retry_wait','accepted','failed','uncertain','cancelled']) assert.match(sql, new RegExp(state));
  assert.match(sql, /count\(DISTINCT d\.id\)/);
  assert.match(sql, /AS provider_problem_count/);
  assert.match(sql, /AS provider_waiting_count/);
  assert.match(sql, /d\.status='accepted' AND d\.provider_delivered_at IS NULL/);
  assert.doesNotMatch(sql, /UPDATE survey_launches/);
});

test('expired ambiguous attempts never cross the provider idempotency boundary', () => {
  const now = new Date('2026-08-04T12:00:00Z');
  assert.equal(isOutsideProviderIdempotencyWindow('2026-08-03T13:00:01Z', now, 23), false);
  assert.equal(isOutsideProviderIdempotencyWindow('2026-08-03T13:00:00Z', now, 23), true);
  const base = { firstProviderStartedAt:'2026-08-03T13:00:01Z',providerAttemptCount:2,createdAt:'2026-08-03T12:00:00Z',now,idempotencyHours:23,maxAttempts:6,maxAgeHours:72 };
  assert.equal(canRetryAmbiguous(base), true);
  assert.equal(canRetryAmbiguous({...base,now:new Date('2026-08-04T12:00:02Z')}), false, 'retry_wait cannot cross the anchored provider window');
  assert.equal(canRetryAmbiguous({...base,providerAttemptCount:6}), false);
  assert.equal(canRetryAmbiguous({...base,firstProviderStartedAt:null}), false);
});

test('worker retry backoff is bounded and uses injected randomness', () => {
  const worker = new DeliveryWorker({ pool:{}, provider:{}, random:()=>0.5, env:{NODE_ENV:'test',EMAIL_MAX_ATTEMPTS:'3'} });
  assert.equal(worker.backoff(1,null),1000);
  assert.equal(worker.backoff(20,null),1800000);
  assert.equal(worker.backoff(1,'7'),7000);
  assert.equal(worker.maxAttempts,3);
});

test('transactional launch locks control then survey, snapshots all work, activates, and audits before commit', async () => {
  const surveyId='11111111-1111-4111-8111-111111111111';
  const orgId='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const launchId='22222222-2222-4222-8222-222222222222';
  const calls=[];
  const client={release(){},async query(sql,values=[]){calls.push({sql,values});
    if (/SELECT \* FROM email_worker_control/.test(sql)) return {rows:[{claiming_enabled:true,minimum_release:''}]};
    if (/SELECT \* FROM email_sending_control/.test(sql)) return {rows:[{sending_enabled:true,minimum_release:'release-pinned-by-sending'}]};
    if (/SELECT s\.\*, om\.role/.test(sql)) return {rows:[{id:surveyId,name:'Survey A',organization_id:orgId,role:'editor',lifecycle_status:'draft',archived_at:null,questions:{elements:[{name:'q1',type:'text'}]}}]};
    if (/SELECT respondent_id/.test(sql)) return {rows:[{respondent_id:7,name:'Person',contact_info:'person@example.com',uuid:'secret-token',lang:'English'}]};
    if (/SELECT lang,text FROM email/.test(sql)) return {rows:[{lang:'English',text:'Please participate'}]};
    if (/SELECT id,request_fingerprint/.test(sql)||/SELECT id FROM survey_launches/.test(sql)) return {rows:[],rowCount:0};
    if (/SELECT 1 FROM email_worker_heartbeats/.test(sql)) return {rows:[{}],rowCount:1};
    if (/INSERT INTO survey_launches/.test(sql)) return {rows:[{id:launchId,created_at:new Date()}],rowCount:1};
    return {rows:[],rowCount:1};
  }};
  const result=await launchSurvey({connect:async()=>client},{id:9,isPlatformAdmin:false},surveyId,{kind:'initial',idempotencyKey:'33333333-3333-4333-8333-333333333333'},{NODE_ENV:'test',SURVEY_URL:'https://survey.test',RESEND_API_KEY:'key',SURVEY_DELIVERY_V2_ENABLED:'true'});
  assert.equal(result.status,'queued');assert.equal(result.target_count,1);
  assert.match(calls[1].sql,/FOR SHARE/);assert.match(calls[2].sql,/email_sending_control/);assert.match(calls[3].sql,/FOR UPDATE OF s/);
  const heartbeatCall=calls.find(({sql})=>/SELECT 1 FROM email_worker_heartbeats/.test(sql));
  assert.equal(heartbeatCall.values[2],'release-pinned-by-sending');
  assert.equal(calls.some(({sql})=>/INSERT INTO survey_email_deliveries/.test(sql)),true);
  assert.equal(calls.filter(({sql})=>/INSERT INTO audit_events/.test(sql)).length,2);
  assert.match(calls.at(-1).sql,/COMMIT/);
  const deliveryCall=calls.find(({sql})=>/INSERT INTO survey_email_deliveries/.test(sql));
  assert.equal(deliveryCall.values.includes('secret-token'),false,'raw bearer token is not persisted in outbox columns');
});

test('close atomically cancels queued work, fences leased work, and writes strict audit', async()=>{
  const surveyId='11111111-1111-4111-8111-111111111111';const calls=[];
  const client={release(){},async query(sql,values=[]){calls.push({sql,values});if(/SELECT s\.\*, om\.role/.test(sql))return{rows:[{id:surveyId,organization_id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',role:'editor',lifecycle_status:'active'}]};return{rows:[],rowCount:1};}};
  const result=await transitionSurvey({connect:async()=>client},{id:4},surveyId,'close');
  assert.equal(result.lifecycleStatus,'closed');
  assert.ok(calls.some(({sql})=>/status IN \('pending','retry_wait','leased'\)/.test(sql)&&/cancellation_requested_at/.test(sql)));
  assert.ok(calls.some(({sql})=>/INSERT INTO audit_events/.test(sql)));
  assert.match(calls.at(-1).sql,/COMMIT/);
});

test('Phase 2 payload tags carry only non-secret environment and delivery correlation', () => {
  const payload=buildInvitationPayload({to:'a@example.com',bodyText:'Welcome',surveyBaseUrl:'https://survey.test',surveyName:'S',token:'secret-token',language:'en',deliveryId:'11111111-1111-4111-8111-111111111111',environment:'staging'});
  assert.deepEqual(payload.tags,[{name:'app',value:'network_survey'},{name:'environment',value:'staging'},{name:'delivery_id',value:'11111111-1111-4111-8111-111111111111'}]);
  assert.equal(JSON.stringify(payload.tags).includes('secret-token'),false);
});

test('payload hash changes for token, template, or address without persisting rendered token separately', () => {
  const base={to:'a@example.com',bodyText:'Welcome',surveyBaseUrl:'https://survey.test',surveyName:'S',token:'one',language:'en'};
  const first=payloadHash(buildInvitationPayload(base));
  assert.notEqual(first,payloadHash(buildInvitationPayload({...base,token:'two'})));
  assert.notEqual(first,payloadHash(buildInvitationPayload({...base,bodyText:'Changed'})));
  assert.notEqual(first,payloadHash(buildInvitationPayload({...base,to:'b@example.com'})));
});
