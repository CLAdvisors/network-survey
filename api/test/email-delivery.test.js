'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { LEGACY_RENDERER_VERSION, TAGGED_RENDERER_VERSION, RENDERER_VERSION, renderInvitation, buildInvitationPayload, buildPrivacyPolicyUrl, payloadHash, ResendProvider, classifyProviderError, ProviderError, reserveProviderRateOnClient } = require('../email');
const { evaluateReadiness, evaluateReminderReadiness, getReminderReadiness, aggregateSelect, fingerprint, launchSurvey, transitionSurvey } = require('../lifecycle');
const { DeliveryWorker, isOutsideProviderIdempotencyWindow, canRetryAmbiguous, buildDeliveryPayload } = require('../email-worker');

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

test('current invitations include the approved privacy notice and accessible policy link', () => {
  const payload = buildInvitationPayload({
    to: 'person@example.com', bodyText: 'Please participate.', surveyBaseUrl: 'https://survey.example.test/form',
    surveyName: 'Leadership & Team', token: 'respondent-token', language: 'English',
  });
  for (const clause of [
    'confidential, but not anonymous',
    'will not be shared with your employer',
    'groups of at least five respondents',
    'will not disclose how an identifiable individual responded or who nominated them',
    'Open-ended comments are not attributed',
    'de-identified survey data for research, benchmarking',
    'retained for up to three years',
  ]) {
    assert.match(payload.html, new RegExp(clause, 'i'));
    assert.match(payload.text, new RegExp(clause, 'i'));
  }
  assert.match(payload.html, /href="https:\/\/survey\.example\.test\/privacy-policy\.html"/);
  assert.match(payload.text, /Employee Survey Platform Privacy Policy: https:\/\/survey\.example\.test\/privacy-policy\.html/);
});

test('policy links are root-relative, validated, and escaped in invitation HTML', () => {
  assert.equal(buildPrivacyPolicyUrl('https://survey.example.test/forms/'), 'https://survey.example.test/privacy-policy.html');
  assert.throws(() => buildPrivacyPolicyUrl('not a URL'), /valid HTTP\(S\) URL/);
  assert.throws(() => buildPrivacyPolicyUrl('javascript:alert(1)'), /HTTP\(S\) URL without/);
  assert.throws(() => buildPrivacyPolicyUrl('https://user:secret@example.test'), /without credentials/);
  assert.throws(() => buildPrivacyPolicyUrl('https://example.test/?next=other'), /query parameters/);
  const payload = buildInvitationPayload({to:'person@example.com',bodyText:'<script>unsafe</script>',surveyBaseUrl:'https://survey.example.test',surveyName:'A" onmouseover="alert(1)',token:'token',rendererVersion:RENDERER_VERSION});
  assert.doesNotMatch(payload.html, /<script>|href="[^"]*" onmouseover=/i);
  assert.match(payload.html, /&lt;script&gt;unsafe&lt;\/script&gt;/);
});

test('versioned rendering preserves queued v1/v2 payload hashes and v3 tag behavior', () => {
  const base={to:'a@example.com',sender:'CLA Survey <survey@cladvisors.com>',subject:'CLA Network Survey',bodyText:'Welcome',surveyBaseUrl:'https://survey.test',surveyName:'S',token:'secret-token',language:'en',deliveryId:'11111111-1111-4111-8111-111111111111',environment:'staging'};
  const expected = new Map([
    [LEGACY_RENDERER_VERSION, 'c378d13b62c038b6b67a51e559bbedbee00fd19443c7bfe671c6a123c5d04be9'],
    [TAGGED_RENDERER_VERSION, 'c07845c9d4f2a5aa6c5ffb3a9b70ad1f5e78a69ceb9971c7d7c85463737abdad'],
    [RENDERER_VERSION, '25788182388a0fb868f296d028a15f8b7ed0088204ac3b151ac98040871cdedd'],
  ]);
  for (const [rendererVersion, hash] of expected) {
    const payload = buildInvitationPayload({...base,rendererVersion});
    assert.equal(payloadHash(payload), hash);
    assert.equal('tags' in payload, rendererVersion !== LEGACY_RENDERER_VERSION);
  }
  assert.throws(() => buildInvitationPayload({...base,rendererVersion:'survey-invitation-unknown'}), /Unsupported invitation renderer/);
});

test('worker reconstructs queued payloads from renderer version and snapshotted survey name', () => {
  const base={id:'11111111-1111-4111-8111-111111111111',to_address:'a@example.com',sender:'CLA Survey <survey@cladvisors.com>',subject:'CLA Network Survey',body_text:'Welcome',survey_base_url:'https://survey.test',uuid:'secret-token',language:'en',render_inputs:{surveyName:'S'}};
  assert.equal(payloadHash(buildDeliveryPayload({...base,renderer_version:LEGACY_RENDERER_VERSION},'Renamed','staging')), 'c378d13b62c038b6b67a51e559bbedbee00fd19443c7bfe671c6a123c5d04be9');
  assert.equal(payloadHash(buildDeliveryPayload({...base,renderer_version:TAGGED_RENDERER_VERSION},'Renamed','staging')), 'c07845c9d4f2a5aa6c5ffb3a9b70ad1f5e78a69ceb9971c7d7c85463737abdad');
  assert.equal(payloadHash(buildDeliveryPayload({...base,renderer_version:RENDERER_VERSION},'Renamed','staging')), '25788182388a0fb868f296d028a15f8b7ed0088204ac3b151ac98040871cdedd');
});

test('published privacy policy is the approved complete document', () => {
  const policyPath = path.join(__dirname, '../../network-survey/public/privacy-policy.html');
  const policy = fs.readFileSync(policyPath, 'utf8');
  assert.match(policy, /<h1>Employee Survey Platform Privacy Policy<\/h1>/);
  assert.match(policy, /Effective Date: August 1, 2026/);
  for (let section = 1; section <= 15; section += 1) assert.match(policy, new RegExp(`<h2>${section}\\.`));
  assert.match(policy, /mailto:info@contemporaryleadership\.com/);
  assert.doesNotMatch(policy, /Lorem ipsum|\[August 1, 2026\]/i);
  assert.equal(require('node:crypto').createHash('sha256').update(policy).digest('hex'), '76059717bbe70c9cb2868c62ba1a74aaab1ef6e2ef6a2813b9c92bd2a460bb6b');
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
  const good = evaluateReadiness(survey, { recipients:[{respondent_id:1,contact_info:'A@example.com',uuid:'token',lang:'English'}], templates:[{lang:' english ',text:'Welcome',invitation_subject:' Team invitation '}] }, {SURVEY_URL:'https://survey.test',RESEND_API_KEY:'key'});
  assert.equal(good.canLaunch,true);
  assert.deepEqual(good.languages,['english']);
  assert.deepEqual(good.templateCoverage,[{language:'english',covered:true}]);
  const bad = evaluateReadiness(survey, { recipients:[
    {respondent_id:1,contact_info:'same@example.com',uuid:'token',lang:'French'},
    {respondent_id:2,contact_info:'SAME@example.com',uuid:null,lang:'French'},
  ], templates:[{lang:'English',text:'Welcome',invitation_subject:'Invitation'}] }, {SURVEY_URL:'https://survey.test',RESEND_API_KEY:'key'});
  assert.equal(bad.canLaunch,false);
  assert.ok(bad.blockers.some(({code})=>code==='recipient_email_duplicate'));
  assert.ok(bad.blockers.some(({code})=>code==='recipient_token_missing'));
  assert.ok(bad.blockers.some(({code})=>code==='template_missing'));
  const unsupported = evaluateReadiness(survey, { recipients:[{respondent_id:3,contact_info:'x@example.com',uuid:'token',lang:'Klingon'}], templates:[{lang:'Klingon',text:'Qapla',invitation_subject:'Invitation'}] }, {SURVEY_URL:'https://survey.test',RESEND_API_KEY:'key'});
  assert.ok(unsupported.blockers.some(({code})=>code==='recipient_language_unsupported'));
  const duplicate = evaluateReadiness(survey, { recipients:[{respondent_id:4,contact_info:'x@example.com',uuid:'token',lang:'English'}], templates:[{lang:'English',text:'Welcome',invitation_subject:'Invitation'},{lang:' english ',text:'  ',invitation_subject:'Other'}] }, {SURVEY_URL:'https://survey.test',RESEND_API_KEY:'key'});
  assert.ok(duplicate.blockers.some(({code})=>code==='template_duplicate'));
  const missingSubject = evaluateReadiness(survey, { recipients:[{respondent_id:5,contact_info:'x@example.com',uuid:'token',lang:'English'}], templates:[{lang:'English',text:'Welcome',invitation_subject:'  '}] }, {SURVEY_URL:'https://survey.test',RESEND_API_KEY:'key'});
  assert.ok(missingSubject.blockers.some(({code})=>code==='template_subject_missing'));
  const oversizedSubject = evaluateReadiness(survey, { recipients:[{respondent_id:6,contact_info:'x@example.com',uuid:'token',lang:'English'}], templates:[{lang:'English',text:'Welcome',invitation_subject:'x'.repeat(256)}] }, {SURVEY_URL:'https://survey.test',RESEND_API_KEY:'key'});
  assert.ok(oversizedSubject.blockers.some(({code})=>code==='template_subject_invalid'));
  const unusedMissingSubject = evaluateReadiness(survey, { recipients:[{respondent_id:7,contact_info:'x@example.com',uuid:'token',lang:'English'}], templates:[
    {lang:'English',text:'Welcome',invitation_subject:'Invitation'},
    {lang:'French',text:'Bienvenue',invitation_subject:null},
  ] }, {SURVEY_URL:'https://survey.test',RESEND_API_KEY:'key'});
  assert.ok(unusedMissingSubject.blockers.some(({code,language})=>code==='template_subject_missing' && language==='french'));
  assert.equal(good.templateSubjectMap.get('english'),'Team invitation');
  const manyInvalid = evaluateReadiness(survey, { recipients:Array.from({length:150},(_,index)=>({respondent_id:index,contact_info:'invalid',uuid:null,lang:''})), templates:[] }, {SURVEY_URL:'https://survey.test',RESEND_API_KEY:'key'});
  assert.ok(manyInvalid.blockerCount > 100);
  assert.equal(manyInvalid.blockers.length, 101);
  assert.equal(manyInvalid.blockers.at(-1).code, 'blockers_truncated');
});

test('reminder readiness handles zero, one, 1,000, localization, and privacy-safe blockers', () => {
  const survey={lifecycle_status:'active',archived_at:null};
  const config={SURVEY_URL:'https://survey.test',RESEND_API_KEY:'fake',RESEND_PROVIDER_ACCOUNT_SCOPE:'test'};
  const template={language:'english',subject:'Reminder',body_text:'Please complete the survey.',configuration_version:1};
  const recipient=index=>({respondent_id:index,contact_info:`person${index}@example.test`,uuid:`existing-token-${index}`,lang:'English'});
  const zero=evaluateReminderReadiness(survey,{recipients:[],templates:[template]},config);
  assert.equal(zero.canLaunch,false);assert.ok(zero.blockers.some(item=>item.code==='recipients_missing'));
  const one=evaluateReminderReadiness(survey,{recipients:[recipient(1)],templates:[template]},config);
  assert.equal(one.canLaunch,true);assert.equal(one.targetCount,1);
  const thousand=evaluateReminderReadiness(survey,{recipients:Array.from({length:1000},(_,index)=>recipient(index+1)),templates:[template]},config);
  assert.equal(thousand.canLaunch,true);assert.equal(thousand.targetCount,1000);
  const over=evaluateReminderReadiness(survey,{recipients:Array.from({length:1001},(_,index)=>recipient(index+1)),templates:[template]},config);
  assert.ok(over.blockers.some(item=>item.code==='recipients_limit_exceeded'));
  const localized=evaluateReminderReadiness(survey,{recipients:[{...recipient(2),lang:'French'},{...recipient(3),lang:'Klingon'}],templates:[template]},config);
  assert.ok(localized.blockers.some(item=>item.code==='template_missing'&&item.language==='french'));
  assert.ok(localized.blockers.some(item=>item.code==='recipient_language_unsupported'));
  assert.equal(JSON.stringify(localized.blockers).includes('existing-token'),false);
  assert.equal(JSON.stringify(localized.blockers).includes('person2@example.test'),false);
});

test('reminder readiness requires survey-admin tenant access before recipient queries', async () => {
  for (const surveyRow of [
    {id:'11111111-1111-4111-8111-111111111111',role:'editor'},
    undefined,
  ]) {
    const calls=[];const client={release(){},async query(sql){calls.push(sql);if(/SELECT s\.\*, om\.role/.test(sql))return{rows:surveyRow?[surveyRow]:[]};throw new Error('recipient query must not run');}};
    await assert.rejects(()=>getReminderReadiness({connect:async()=>client},{id:5},'11111111-1111-4111-8111-111111111111',{NODE_ENV:'test'}),error=>error.code==='survey_not_found'&&error.status===404);
    assert.equal(calls.length,1);
  }
});

test('reminder implementation selects and rechecks only incomplete eligible respondents', () => {
  const lifecycleSource=fs.readFileSync(path.join(__dirname,'../lifecycle.js'),'utf8');
  const workerSource=fs.readFileSync(path.join(__dirname,'../email-worker.js'),'utf8');
  assert.match(lifecycleSource,/can_respond=true AND r\.response IS NULL/);
  assert.match(lifecycleSource,/displayedRespondentPredicate\('r'\)/);
  assert.match(lifecycleSource,/kind:'reminder'/);
  assert.match(workerSource,/row\.launch_kind==='reminder'.*row\.can_respond!==true\|\|row\.response!==null/s);
  assert.match(workerSource,/FOR UPDATE OF d FOR SHARE OF r/);
  assert.match(workerSource,/row\.launch_kind!=='reminder'.*email_sent/s);
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
  let releaseCount=0;
  const client={release(){releaseCount+=1;},async query(sql,values=[]){calls.push({sql,values});
    if (/SELECT \* FROM email_worker_control/.test(sql)) return {rows:[{claiming_enabled:true,minimum_release:''}]};
    if (/SELECT \* FROM email_sending_control/.test(sql)) return {rows:[{sending_enabled:true,minimum_release:'release-pinned-by-sending'}]};
    if (/SELECT s\.\*, om\.role/.test(sql)) return {rows:[{id:surveyId,name:'Survey A',organization_id:orgId,role:'editor',lifecycle_status:'draft',archived_at:null,questions:{elements:[{name:'q1',type:'text'}]}}]};
    if (/SELECT respondent_id/.test(sql)) return {rows:[
      {respondent_id:7,name:'Person',contact_info:'person@example.com',uuid:'secret-token',lang:'English'},
      {respondent_id:8,name:'Personne',contact_info:'personne@example.com',uuid:'jeton-secret',lang:'French'},
    ]};
    if (/SELECT lang,text,invitation_subject FROM email/.test(sql)) return {rows:[
      {lang:'English',text:'Please participate',invitation_subject:'Leadership pulse invitation'},
      {lang:'French',text:'Merci de participer',invitation_subject:'Invitation au sondage'},
    ]};
    if (/SELECT id,request_fingerprint/.test(sql)||/SELECT id FROM survey_launches/.test(sql)) return {rows:[],rowCount:0};
    if (/SELECT 1 FROM email_worker_heartbeats/.test(sql)) return {rows:[{}],rowCount:1};
    if (/INSERT INTO survey_launches/.test(sql)) return {rows:[{id:launchId,created_at:new Date()}],rowCount:1};
    return {rows:[],rowCount:1};
  }};
  const result=await launchSurvey({connect:async()=>client},{id:9,isPlatformAdmin:false},surveyId,{kind:'initial',idempotencyKey:'33333333-3333-4333-8333-333333333333'},{NODE_ENV:'test',SURVEY_URL:'https://survey.test',RESEND_API_KEY:'key',SURVEY_DELIVERY_V2_ENABLED:'true'});
  assert.equal(result.status,'queued');assert.equal(result.target_count,2);
  assert.match(calls[1].sql,/FOR SHARE/);assert.match(calls[2].sql,/email_sending_control/);
  const boundaryIndex=calls.findIndex(({values})=>values.some(value=>String(value).includes('survey-provider-boundary')));
  const surveyLockIndex=calls.findIndex(({sql})=>/FOR UPDATE OF s/.test(sql));
  assert.ok(boundaryIndex>2&&surveyLockIndex>boundaryIndex,'survey boundary lock precedes the survey row lock');
  const heartbeatCall=calls.find(({sql})=>/SELECT 1 FROM email_worker_heartbeats/.test(sql));
  assert.equal(heartbeatCall.values[2],'release-pinned-by-sending');
  assert.equal(calls.filter(({sql})=>/INSERT INTO survey_email_deliveries/.test(sql)).length,2);
  assert.equal(calls.filter(({sql})=>/INSERT INTO audit_events/.test(sql)).length,2);
  assert.match(calls.at(-1).sql,/COMMIT/);
  const deliveryCalls=calls.filter(({sql})=>/INSERT INTO survey_email_deliveries/.test(sql));
  const deliveryCall=deliveryCalls.find(({values})=>values[7]==='english');
  const frenchDeliveryCall=deliveryCalls.find(({values})=>values[7]==='french');
  assert.equal(deliveryCall.values.includes('secret-token'),false,'raw bearer token is not persisted in outbox columns');
  assert.equal(frenchDeliveryCall.values.includes('jeton-secret'),false,'localized raw bearer token is not persisted in outbox columns');
  assert.equal(deliveryCall.values[12],RENDERER_VERSION);
  const templateCalls=calls.filter(({sql})=>/INSERT INTO survey_launch_templates/.test(sql));
  assert.deepEqual(templateCalls.map(({values})=>[values[1],values[2]]), [
    ['english','Leadership pulse invitation'],
    ['french','Invitation au sondage'],
  ]);
  assert.equal(deliveryCall.values[9],'Leadership pulse invitation');
  assert.equal(frenchDeliveryCall.values[9],'Invitation au sondage');
  const launchedPayload=buildInvitationPayload({to:'person@example.com',sender:'CLA Survey <survey@cladvisors.com>',subject:'Leadership pulse invitation',bodyText:'Please participate',surveyBaseUrl:'https://survey.test',surveyName:'Survey A',token:'secret-token',language:'english',deliveryId:deliveryCall.values[0],environment:'test',rendererVersion:RENDERER_VERSION});
  const frenchPayload=buildInvitationPayload({to:'personne@example.com',sender:'CLA Survey <survey@cladvisors.com>',subject:'Invitation au sondage',bodyText:'Merci de participer',surveyBaseUrl:'https://survey.test',surveyName:'Survey A',token:'jeton-secret',language:'french',deliveryId:frenchDeliveryCall.values[0],environment:'test',rendererVersion:RENDERER_VERSION});
  assert.equal(deliveryCall.values[14],payloadHash(launchedPayload));
  assert.equal(frenchDeliveryCall.values[14],payloadHash(frenchPayload));
  assert.equal(releaseCount,1,'launchSurvey releases its checked-out connection exactly once');
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
