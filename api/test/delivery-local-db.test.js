'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { Pool } = require('pg');
const schedule = require('../delivery-schedule');
const { insertDeliveriesBatched, batchDeliveryRecord, evaluateReadiness, launchReminder, listEmailHistory } = require('../lifecycle');
const { revealPersonalLink, personalLinkPermission, setPersonalLinkPermission } = require('../lifecycle');

const url = process.env.DELIVERY_TEST_DATABASE_URL;
test('isolated PostgreSQL: schedule concurrency/cancel and personal-link audit/tenant isolation', { skip: !url }, async () => {
  const pool = new Pool({ connectionString: url, max: 4 });
  const nonce = crypto.randomUUID();
  const name = `delivery-${nonce}`;
  try {
    const user = (await pool.query('INSERT INTO users(username,password) VALUES($1,$2) RETURNING id', [name, 'test-only'])).rows[0];
    const org = (await pool.query('INSERT INTO organizations(name) VALUES($1) RETURNING id', [name])).rows[0];
    await pool.query("INSERT INTO organization_memberships(organization_id,user_id,role) VALUES($1,$2,'admin')", [org.id, user.id]);
    const survey = (await pool.query('INSERT INTO survey(name,organization_id,questions) VALUES($1,$2,$3::jsonb) RETURNING id', [name, org.id, JSON.stringify({ elements: [{ name: 'q', type: 'text' }] })])).rows[0];
    const respondent = (await pool.query('INSERT INTO respondent(name,contact_info,survey_name,survey_id,can_respond,uuid,lang) VALUES($1,$2,$3,$4,true,$5,$6) RETURNING respondent_id', ['Test Respondent', 'person@example.test', name, survey.id, `token-${nonce}`, 'English'])).rows[0];
    assert.equal((await personalLinkPermission(pool, user, survey.id)).canReveal, true);
    const revealed = await revealPersonalLink(pool, user, survey.id, respondent.respondent_id, 'reveal', { SURVEY_URL: 'https://survey.example.test' });
    assert.equal(new URL(revealed.link).searchParams.get('userId'), `token-${nonce}`);
    assert.equal((await pool.query("SELECT count(*)::int AS count FROM audit_events WHERE survey_id=$1 AND event_type='respondent.personal_link_reveal'", [survey.id])).rows[0].count, 1);
    assert.equal(JSON.stringify((await pool.query('SELECT metadata FROM audit_events WHERE survey_id=$1', [survey.id])).rows).includes(`token-${nonce}`), false);
    const foreignOrg = (await pool.query('INSERT INTO organizations(name) VALUES($1) RETURNING id', [`foreign-${name}`])).rows[0];
    const foreignSurvey = (await pool.query('INSERT INTO survey(name,organization_id) VALUES($1,$2) RETURNING id', [`foreign-${name}`, foreignOrg.id])).rows[0];
    const foreignRespondent = (await pool.query('INSERT INTO respondent(name,contact_info,survey_name,survey_id,can_respond,uuid,lang) VALUES($1,$2,$3,$4,true,$5,$6) RETURNING respondent_id', ['Foreign', 'foreign@example.test', `foreign-${name}`, foreignSurvey.id, `foreign-token-${nonce}`, 'English'])).rows[0];
    await assert.rejects(() => revealPersonalLink(pool, user, foreignSurvey.id, foreignRespondent.respondent_id, 'reveal', { SURVEY_URL: 'https://survey.example.test' }), error => error.status === 404);
    assert.equal((await pool.query('SELECT count(*)::int AS count FROM audit_events WHERE survey_id=$1', [foreignSurvey.id])).rows[0].count, 0);
    await assert.rejects(() => setPersonalLinkPermission(pool, user, survey.id, 'viewer'), error => error.status === 404);
    const next = new Date(Date.now() + 86400000).toISOString().slice(0, 16);
    const close = new Date(Date.now() + 4 * 86400000).toISOString().slice(0, 16);
    const saved = await schedule.configure(pool, user, survey.id, { startLocal: next, closeLocal: close, timezone: 'UTC', reminderEveryDays: 1, expectedVersion: 0 });
    assert.equal(saved.status, 'active');
    await pool.query("UPDATE survey_delivery_schedules SET next_due_at=now()-interval '1 second' WHERE id=$1", [saved.id]);
    const [one, two] = await Promise.all([schedule.claimDue(pool), schedule.claimDue(pool)]);
    assert.equal([one, two].filter(Boolean).length, 1, 'concurrent workers cannot claim the same schedule occurrence');
    assert.equal((await schedule.cancel(pool, user, survey.id, saved.version)).status, 'cancelled');
    assert.equal(await schedule.claimDue(pool), null);
    assert.equal((await pool.query("SELECT count(*)::int AS count FROM audit_events WHERE survey_id=$1 AND event_type='survey.schedule_cancelled'", [survey.id])).rows[0].count, 1);
  } finally { await pool.end(); }
});

test('isolated PostgreSQL: scheduled launch survives worker restart and cancel fences queued sends', { skip: !url }, async () => {
  const pool = new Pool({ connectionString: url, max: 5 });
  const nonce = crypto.randomUUID();
  const name = `scheduled-${nonce}`;
  try {
    const user = (await pool.query('INSERT INTO users(username,password) VALUES($1,$2) RETURNING id', [name, 'test-only'])).rows[0];
    const org = (await pool.query('INSERT INTO organizations(name) VALUES($1) RETURNING id', [name])).rows[0];
    await pool.query("INSERT INTO organization_memberships(organization_id,user_id,role) VALUES($1,$2,'admin')", [org.id, user.id]);
    const survey = (await pool.query('INSERT INTO survey(name,organization_id,questions) VALUES($1,$2,$3::jsonb) RETURNING id', [name, org.id, JSON.stringify({ elements: [{ name: 'q', type: 'text' }] })])).rows[0];
    await pool.query('INSERT INTO respondent(name,contact_info,survey_name,survey_id,can_respond,uuid,lang) VALUES($1,$2,$3,$4,true,$5,$6)', ['Test Person', 'test@example.test', name, survey.id, `token-${nonce}`, 'English']);
    await pool.query('INSERT INTO email(survey_name,survey_id,lang,text,invitation_subject) VALUES($1,$2,$3,$4,$5)', [name, survey.id, 'English', 'Hello', 'Invitation']);
    await pool.query("INSERT INTO email_worker_heartbeats(environment,worker_instance,release_revision,enabled,claiming) VALUES('test',$1,'local',true,true) ON CONFLICT(environment,worker_instance) DO UPDATE SET heartbeat_at=now()", [`synthetic-${nonce}`]);
    const startLocal = new Date(Date.now() + 86400000).toISOString().slice(0, 16);
    const closeLocal = new Date(Date.now() + 4 * 86400000).toISOString().slice(0, 16);
    const saved = await schedule.configure(pool, user, survey.id, { startLocal, closeLocal, timezone: 'UTC', reminderEveryDays: 1, expectedVersion: 0 });
    await pool.query("UPDATE survey_delivery_schedules SET next_due_at=now()-interval '1 second' WHERE id=$1", [saved.id]);
    const config = { EMAIL_WORKER_ENV: 'test', SURVEY_DELIVERY_V2_ENABLED: 'true', SURVEY_URL: 'https://survey.example.test', RESEND_API_KEY: 'fake-not-used', RESEND_PROVIDER_ACCOUNT_SCOPE: 'local-test-account' };
    const [first, second] = await Promise.all([schedule.runDue(pool, config), schedule.runDue(pool, config)]);
    assert.equal([first, second].filter(Boolean).length, 1);
    assert.equal((await pool.query('SELECT count(*)::int AS count FROM survey_launches WHERE survey_id=$1', [survey.id])).rows[0].count, 1);
    const next = (await pool.query('SELECT version,occurrence,next_kind FROM survey_delivery_schedules WHERE id=$1', [saved.id])).rows[0];
    assert.equal(next.occurrence, 1);
    assert.equal(next.next_kind, 'reminder');
    assert.equal(await schedule.runDue(pool, config), false, 'restart before next due does not resend');
    await schedule.cancel(pool, user, survey.id, next.version);
    assert.equal((await pool.query('SELECT status FROM survey_email_deliveries WHERE survey_id=$1', [survey.id])).rows[0].status, 'cancelled');
    assert.equal(await schedule.runDue(pool, config), false);
  } finally { await pool.end(); }
});

test('isolated PostgreSQL: repeated cadence edits preserve last actual occurrence and close extension', { skip: !url }, async () => {
  const pool = new Pool({ connectionString: url, max: 2 });
  const nonce = crypto.randomUUID();
  const name = `cadence-${nonce}`;
  try {
    const user = (await pool.query('INSERT INTO users(username,password) VALUES($1,$2) RETURNING id', [name, 'test-only'])).rows[0];
    const org = (await pool.query('INSERT INTO organizations(name) VALUES($1) RETURNING id', [name])).rows[0];
    await pool.query("INSERT INTO organization_memberships(organization_id,user_id,role) VALUES($1,$2,'admin')", [org.id, user.id]);
    const survey = (await pool.query('INSERT INTO survey(name,organization_id) VALUES($1,$2) RETURNING id', [name, org.id])).rows[0];
    const initial = { startLocal: '2026-10-01T09:00', closeLocal: '2026-10-28T09:00', timezone: 'UTC', reminderEveryDays: 3, expectedVersion: 0 };
    const created = await schedule.configure(pool, user, survey.id, initial);
    await pool.query("UPDATE survey SET lifecycle_status='active' WHERE id=$1", [survey.id]);
    // Day0 launch and Day3 reminder have fired. Day6 is the old next occurrence.
    await pool.query("UPDATE survey_delivery_schedules SET occurrence=2,next_kind='reminder',next_local='2026-10-07T09:00',next_due_at='2026-10-07T09:00Z' WHERE id=$1", [created.id]);
    const firstEdit = await schedule.configure(pool, user, survey.id, { ...initial, reminderEveryDays: 5, expectedVersion: 1 });
    assert.equal(firstEdit.nextDueAt.toISOString(), '2026-10-09T09:00:00.000Z'); // Day3 + 5
    const secondEdit = await schedule.configure(pool, user, survey.id, { ...initial, reminderEveryDays: 7, expectedVersion: 2 });
    assert.equal(secondEdit.nextDueAt.toISOString(), '2026-10-11T09:00:00.000Z'); // Day3 + 7, not Day5 + 7
    const closeSoon = await schedule.configure(pool, user, survey.id, { ...initial, closeLocal: '2026-10-10T09:00', reminderEveryDays: 7, expectedVersion: 3 });
    assert.equal(closeSoon.nextKind, 'close');
    const extended = await schedule.configure(pool, user, survey.id, { ...initial, closeLocal: '2026-10-28T09:00', reminderEveryDays: 4, expectedVersion: 4 });
    assert.equal(extended.nextDueAt.toISOString(), '2026-10-08T09:00:00.000Z'); // Day3 + 4

    const dstSurvey = (await pool.query('INSERT INTO survey(name,organization_id) VALUES($1,$2) RETURNING id', [`dst-${name}`, org.id])).rows[0];
    const dstInput = { startLocal: '2027-03-13T02:30', closeLocal: '2027-03-28T02:30', timezone: 'America/New_York', reminderEveryDays: 1, expectedVersion: 0 };
    const dstCreated = await schedule.configure(pool, user, dstSurvey.id, dstInput);
    await pool.query("UPDATE survey SET lifecycle_status='active' WHERE id=$1", [dstSurvey.id]);
    // First reminder nominally March 14 02:30, shifted to 03:00 by spring DST gap.
    await pool.query("UPDATE survey_delivery_schedules SET occurrence=2,next_kind='reminder',next_local='2027-03-15T02:30',next_due_at='2027-03-15T06:30Z' WHERE id=$1", [dstCreated.id]);
    const dstFirst = await schedule.configure(pool, user, dstSurvey.id, { ...dstInput, reminderEveryDays: 2, expectedVersion: 1 });
    assert.equal(dstFirst.nextDueAt.toISOString(), '2027-03-16T06:30:00.000Z');
    const dstSecond = await schedule.configure(pool, user, dstSurvey.id, { ...dstInput, reminderEveryDays: 3, expectedVersion: 2 });
    assert.equal(dstSecond.nextDueAt.toISOString(), '2027-03-17T06:30:00.000Z');
  } finally { await pool.end(); }
});

test('isolated PostgreSQL: missed reminder past close advances to durable close without sending', { skip: !url }, async () => {
  const pool = new Pool({ connectionString: url, max: 3 });
  const nonce = crypto.randomUUID();
  const name = `missed-close-${nonce}`;
  try {
    const user = (await pool.query('INSERT INTO users(username,password) VALUES($1,$2) RETURNING id', [name, 'test-only'])).rows[0];
    const org = (await pool.query('INSERT INTO organizations(name) VALUES($1) RETURNING id', [name])).rows[0];
    await pool.query("INSERT INTO organization_memberships(organization_id,user_id,role) VALUES($1,$2,'admin')", [org.id, user.id]);
    const survey = (await pool.query("INSERT INTO survey(name,organization_id,lifecycle_status) VALUES($1,$2,'active') RETURNING id", [name, org.id])).rows[0];
    const inserted = await pool.query(`INSERT INTO survey_delivery_schedules(survey_id,organization_id,timezone,start_local,close_local,start_at,close_at,reminder_every_days,next_local,next_due_at,next_kind,updated_by_user_id)
      VALUES($1,$2,'UTC','2026-09-01T10:00','2026-09-02T10:00',now()-interval '3 days',now()-interval '1 second',1,'2026-09-02T09:00',now()-interval '5 minutes','reminder',$3) RETURNING id`, [survey.id, org.id, user.id]);
    const config = { EMAIL_WORKER_ENV: 'test', SURVEY_DELIVERY_V2_ENABLED: 'true', SURVEY_URL: 'https://survey.example.test' };
    assert.equal((await schedule.runDue(pool, config)).kind, 'expired');
    assert.equal((await schedule.runDue(pool, config)).kind, 'close');
    assert.equal((await pool.query('SELECT lifecycle_status FROM survey WHERE id=$1', [survey.id])).rows[0].lifecycle_status, 'closed');
    assert.equal((await pool.query('SELECT status FROM survey_delivery_schedules WHERE id=$1', [inserted.rows[0].id])).rows[0].status, 'completed');
  } finally { await pool.end(); }
});

test('isolated PostgreSQL: targeted resend replay, one recipient and email history without provider I/O', { skip: !url }, async () => {
  const pool = new Pool({ connectionString: url, max: 3 });
  const nonce = crypto.randomUUID();
  const name = `resend-${nonce}`;
  try {
    const user = (await pool.query('INSERT INTO users(username,password) VALUES($1,$2) RETURNING id', [name, 'test-only'])).rows[0];
    const org = (await pool.query('INSERT INTO organizations(name) VALUES($1) RETURNING id', [name])).rows[0];
    await pool.query("INSERT INTO organization_memberships(organization_id,user_id,role) VALUES($1,$2,'admin')", [org.id, user.id]);
    const survey = (await pool.query("INSERT INTO survey(name,organization_id,questions,lifecycle_status) VALUES($1,$2,$3::jsonb,'active') RETURNING id", [name, org.id, JSON.stringify({ elements: [{ name: 'q', type: 'text' }] })])).rows[0];
    const respondents = [];
    for (const index of [1, 2]) respondents.push((await pool.query('INSERT INTO respondent(name,contact_info,survey_name,survey_id,can_respond,uuid,lang) VALUES($1,$2,$3,$4,true,$5,$6) RETURNING respondent_id', [`Person ${index}`, `p${index}@example.test`, name, survey.id, `token-${index}-${nonce}`, 'English'])).rows[0]);
    await pool.query('INSERT INTO survey_reminder_templates(survey_id,language,subject,body_text,configuration_version,updated_by_user_id) VALUES($1,$2,$3,$4,1,$5)', [survey.id, 'english', 'Reminder', 'Please respond.', user.id]);
    await pool.query("INSERT INTO email_worker_heartbeats(environment,worker_instance,release_revision,enabled,claiming,reminder_capable,provider_account_scope) VALUES('test',$1,'local',true,true,true,'local-test-account')", [`synthetic-${nonce}`]);
    const config = { EMAIL_WORKER_ENV: 'test', SURVEY_URL: 'https://survey.example.test', RESEND_API_KEY: 'fake-not-used', RESEND_PROVIDER_ACCOUNT_SCOPE: 'local-test-account' };
    const key = crypto.randomUUID();
    const first = await launchReminder(pool, user, survey.id, { respondentId: respondents[1].respondent_id, idempotencyKey: key }, config);
    assert.equal(first.target_count, 1);
    const replay = await launchReminder(pool, user, survey.id, { respondentId: respondents[1].respondent_id, idempotencyKey: key }, config);
    assert.equal(replay.replayed, true);
    assert.equal(replay.id, first.id);
    const history = await listEmailHistory(pool, user, survey.id);
    assert.equal(history.messages.length, 1);
    assert.equal(history.messages[0].messageType, 'reminder');
    assert.equal(history.messages[0].recipient.address, 'p2@example.test');
    assert.equal(JSON.stringify(history).includes(`token-2-${nonce}`), false);
    assert.equal((await pool.query('SELECT count(*)::int AS count FROM survey_email_deliveries WHERE launch_id=$1', [first.id])).rows[0].count, 1);
  } finally { await pool.end(); }
});

test('isolated PostgreSQL: full 5,000-person invitation outbox insertion is bounded and atomic', { skip: !url }, async () => {
  const pool = new Pool({ connectionString: url, max: 2 });
  const client = await pool.connect();
  const nonce = crypto.randomUUID();
  try {
    await client.query('BEGIN');
    const user = (await client.query('INSERT INTO users(username,password) VALUES($1,$2) RETURNING id', [`batch-${nonce}`, 'test-only'])).rows[0];
    const org = (await client.query('INSERT INTO organizations(name) VALUES($1) RETURNING id', [`batch-${nonce}`])).rows[0];
    const survey = (await client.query('INSERT INTO survey(name,organization_id,questions) VALUES($1,$2,$3::jsonb) RETURNING id', [`batch-survey-${nonce}`, org.id, JSON.stringify({ elements: [{ name: 'q', type: 'text' }] })])).rows[0];
    const recipients = (await client.query(`INSERT INTO respondent(name,contact_info,survey_name,survey_id,can_respond,uuid,lang)
      SELECT 'Batch Person '||n, 'batch'||n||'@example.test',$1,$2,true,'batch-token-'||n||'-'||$3,'English' FROM generate_series(1,5000) n
      RETURNING respondent_id`, [`batch-survey-${nonce}`, survey.id, nonce.slice(0, 8)])).rows;
    assert.equal(recipients.length, 5000);
    const readiness = evaluateReadiness({ lifecycle_status: 'draft', questions: { elements: [{ name: 'q', type: 'text' }] } }, {
      recipients: recipients.map((row, index) => ({ respondent_id: row.respondent_id, contact_info: `batch${index + 1}@example.test`, uuid: `token-${index}`, lang: 'English' })),
      templates: [{ lang: 'English', text: 'Welcome', invitation_subject: 'Invitation' }],
    }, { SURVEY_URL: 'https://survey.test', RESEND_API_KEY: 'fake' });
    assert.equal(readiness.canLaunch, true);
    const launch = (await client.query("INSERT INTO survey_launches(survey_id,organization_id,kind,idempotency_key,request_fingerprint,requested_by_user_id) VALUES($1,$2,'initial',$3,'fixture',$4) RETURNING id", [survey.id, org.id, crypto.randomUUID(), user.id])).rows[0];
    const records = recipients.map((recipient, index) => batchDeliveryRecord([
      crypto.randomUUID(), launch.id, survey.id, org.id, recipient.respondent_id, `batch${index + 1}@example.test`, `Batch Person ${index + 1}`, 'english', 'from@example.test', 'Invitation', 'template-hash', 'https://survey.test', 'fixture-v1', JSON.stringify({ surveyName: `batch-survey-${nonce}` }), 'payload-hash', `survey-delivery-${crypto.randomUUID()}`,
    ]));
    const started = performance.now();
    await insertDeliveriesBatched(client, records, 'pending');
    const elapsedMs = Math.round(performance.now() - started);
    const count = (await client.query('SELECT count(*)::int AS count FROM survey_email_deliveries WHERE launch_id=$1', [launch.id])).rows[0].count;
    assert.equal(count, 5000);
    assert.ok(elapsedMs < 30000, `5k DB-only insertion took ${elapsedMs}ms`);
    await client.query('ROLLBACK');
    console.log(`5k synthetic outbox insert ${elapsedMs}ms; no provider I/O`);
  } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; }
  finally { client.release(); await pool.end(); }
});
