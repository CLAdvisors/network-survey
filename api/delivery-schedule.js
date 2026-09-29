'use strict';
const crypto = require('crypto');
const lifecycle = require('./lifecycle');
const { scheduleFields, localToInstant, nextLocalDay, nextReminder } = require('./delivery-schedule-time');

function publicSchedule(row) {
  if (!row) return null;
  const { id, survey_id, timezone, start_local, close_local, start_at, close_at, reminder_every_days, next_due_at, next_kind, status, occurrence, version } = row;
  return { id, surveyId: survey_id, timezone, startLocal: start_local, closeLocal: close_local, startAt: start_at, closeAt: close_at, reminderEveryDays: reminder_every_days, nextDueAt: next_due_at, nextKind: next_kind, status, occurrence, version };
}

function scheduledKey(schedule) {
  const hex = crypto.createHash('sha256').update(`${schedule.id}:${schedule.occurrence}:${schedule.next_kind}`).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

async function configure(pool, user, surveyId, input, config = process.env) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new lifecycle.LifecycleError(400, 'schedule_invalid', 'Provide a schedule.');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`survey-provider-boundary:${String(surveyId).toLowerCase()}`]);
    const survey = await lifecycle.loadAuthorizedSurvey(client, user, surveyId, 'admin', 'UPDATE');
    if (survey.archived_at || !['draft', 'active'].includes(survey.lifecycle_status)) throw new lifecycle.LifecycleError(409, 'schedule_survey_invalid', 'Only an open survey can be scheduled.');
    const existing = (await client.query('SELECT * FROM survey_delivery_schedules WHERE survey_id=$1 FOR UPDATE', [survey.id])).rows[0];
    if (existing && (existing.status !== 'active' || existing.version !== input.expectedVersion)) throw new lifecycle.LifecycleError(409, 'schedule_version_conflict', 'Reload the schedule before editing.');
    if (!existing && input.expectedVersion !== 0) throw new lifecycle.LifecycleError(409, 'schedule_version_conflict', 'Reload the schedule before editing.');
    let fields;
    try {
      if (survey.lifecycle_status === 'draft') fields = scheduleFields(input);
      else {
        if (!existing || input.startLocal !== existing.start_local || input.timezone !== existing.timezone) throw new Error('Launch date and timezone cannot be changed after launch.');
        if (!Number.isSafeInteger(input.reminderEveryDays) || input.reminderEveryDays < 1 || input.reminderEveryDays > 30) throw new Error('Reminder cadence must be 1–30 days.');
        const closeAt = localToInstant(input.closeLocal, input.timezone);
        if (closeAt <= new Date() || closeAt <= new Date(existing.start_at) || closeAt > new Date(new Date(existing.start_at).getTime() + 365 * 86400000)) throw new Error('Close date must be in the future and within one year of launch.');
        fields = { startLocal: existing.start_local, startAt: existing.start_at, closeLocal: input.closeLocal, closeAt, timezone: input.timezone, reminderEveryDays: input.reminderEveryDays };
      }
    } catch (error) { throw new lifecycle.LifecycleError(400, 'schedule_invalid', error.message); }
    let nextLocal = fields.startLocal;
    let nextDueAt = fields.startAt;
    let nextKind = 'initial';
    if (survey.lifecycle_status === 'active') {
      const lastLocal = nextLocalDay(existing.start_local, existing.reminder_every_days * Math.max(0, existing.occurrence - 1));
      nextLocal = nextLocalDay(lastLocal, fields.reminderEveryDays);
      nextDueAt = localToInstant(nextLocal, fields.timezone, { overlap: 'earlier', gap: 'next' });
      // If a reminder is already overdue, leave it due; do not skip an occurrence.
      nextKind = 'reminder';
      if (nextDueAt >= fields.closeAt) { nextDueAt = fields.closeAt; nextKind = 'close'; }
    }
    const saved = existing
      ? (await client.query(`UPDATE survey_delivery_schedules SET timezone=$2,start_local=$3,close_local=$4,start_at=$5,close_at=$6,reminder_every_days=$7,next_local=$8,next_due_at=$9,next_kind=$10,version=version+1,lease_token=NULL,lease_expires_at=NULL,updated_by_user_id=$11,updated_at=now() WHERE id=$1 RETURNING *`, [existing.id, fields.timezone, fields.startLocal, fields.closeLocal, fields.startAt, fields.closeAt, fields.reminderEveryDays, nextLocal, nextDueAt, nextKind, user.id])).rows[0]
      : (await client.query(`INSERT INTO survey_delivery_schedules(survey_id,organization_id,timezone,start_local,close_local,start_at,close_at,reminder_every_days,next_local,next_due_at,next_kind,updated_by_user_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'initial',$11) RETURNING *`, [survey.id, survey.organization_id, fields.timezone, fields.startLocal, fields.closeLocal, fields.startAt, fields.closeAt, fields.reminderEveryDays, nextLocal, nextDueAt, user.id])).rows[0];
    await lifecycle.strictAudit(client, { organizationId: survey.organization_id, actorUserId: user.id, surveyId: survey.id, eventType: existing ? 'survey.schedule_edited' : 'survey.schedule_created', metadata: { scheduleId: saved.id, version: saved.version, timezone: fields.timezone, startAt: fields.startAt, closeAt: fields.closeAt } });
    await client.query('COMMIT');
    return publicSchedule(saved);
  } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; }
  finally { client.release(); }
}

async function view(pool, user, surveyId) {
  const client = await pool.connect();
  try {
    const survey = await lifecycle.loadAuthorizedSurvey(client, user, surveyId, 'viewer');
    const result = await client.query('SELECT * FROM survey_delivery_schedules WHERE survey_id=$1', [survey.id]);
    return publicSchedule(result.rows[0]);
  } finally { client.release(); }
}

async function cancel(pool, user, surveyId, expectedVersion) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`survey-provider-boundary:${String(surveyId).toLowerCase()}`]);
    const survey = await lifecycle.loadAuthorizedSurvey(client, user, surveyId, 'admin', 'UPDATE');
    const schedule = (await client.query('SELECT * FROM survey_delivery_schedules WHERE survey_id=$1 FOR UPDATE', [survey.id])).rows[0];
    if (!schedule || schedule.status !== 'active' || schedule.version !== expectedVersion) throw new lifecycle.LifecycleError(409, 'schedule_version_conflict', 'Reload the schedule before cancelling.');
    await client.query("UPDATE survey_delivery_schedules SET status='cancelled',version=version+1,lease_token=NULL,lease_expires_at=NULL,updated_by_user_id=$2,updated_at=now() WHERE id=$1", [schedule.id, user.id]);
    await client.query(`UPDATE survey_launches SET cancelled_at=now() WHERE schedule_id=$1 AND cancelled_at IS NULL`, [schedule.id]);
    await client.query(`UPDATE survey_email_deliveries d SET cancellation_requested_at=now(),status=CASE WHEN d.status IN ('pending','retry_wait','reminder_pending','reminder_retry_wait') AND EXISTS(SELECT 1 FROM survey_email_attempts a WHERE a.delivery_id=d.id AND a.outcome='uncertain' AND a.provider_started_at IS NOT NULL) THEN 'uncertain' WHEN d.status IN ('pending','retry_wait','reminder_pending','reminder_retry_wait') THEN 'cancelled' ELSE d.status END,updated_at=now() FROM survey_launches l WHERE l.id=d.launch_id AND l.schedule_id=$1 AND d.status IN ('pending','retry_wait','reminder_pending','reminder_retry_wait','leased','reminder_leased')`, [schedule.id]);
    await lifecycle.strictAudit(client, { organizationId: survey.organization_id, actorUserId: user.id, surveyId: survey.id, eventType: 'survey.schedule_cancelled', metadata: { scheduleId: schedule.id, version: expectedVersion } });
    await client.query('COMMIT');
    return { status: 'cancelled', version: expectedVersion + 1 };
  } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; }
  finally { client.release(); }
}

async function claimDue(pool, leaseSeconds = 120) {
  const token = crypto.randomUUID();
  const result = await pool.query(`UPDATE survey_delivery_schedules SET lease_token=$1,lease_expires_at=now()+($2::text||' seconds')::interval WHERE id=(SELECT id FROM survey_delivery_schedules WHERE status='active' AND next_due_at<=now() AND (lease_expires_at IS NULL OR lease_expires_at<=now()) ORDER BY next_due_at FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING *`, [token, leaseSeconds]);
  return result.rows[0] || null;
}

async function runDue(pool, config = process.env) {
  const claimed = await claimDue(pool);
  if (!claimed) return false;
  if (claimed.next_kind !== 'close' && new Date(claimed.close_at) <= new Date()) {
    // A stalled worker must not send a late invitation/reminder. A draft never
    // launched remains draft; an active survey advances to the close occurrence.
    await pool.query(`UPDATE survey_delivery_schedules SET occurrence=occurrence+1,next_due_at=close_at,next_kind='close',status=CASE WHEN $3='initial' THEN 'completed' ELSE status END,lease_token=NULL,lease_expires_at=NULL,updated_at=now() WHERE id=$1 AND lease_token=$2 AND version=$4 AND status='active'`, [claimed.id, claimed.lease_token, claimed.next_kind, claimed.version]);
    return { scheduleId: claimed.id, kind: 'expired', launchId: null };
  }
  const context = { scheduleId: claimed.id, scheduleVersion: claimed.version, occurrence: claimed.occurrence };
  const user = { id: claimed.updated_by_user_id, isPlatformAdmin: false };
  let launched;
  try {
    if (claimed.next_kind === 'initial') launched = await lifecycle.launchSurvey(pool, user, claimed.survey_id, { kind: 'initial', idempotencyKey: scheduledKey(claimed), ...context }, config);
    else if (claimed.next_kind === 'reminder') launched = await lifecycle.launchReminder(pool, user, claimed.survey_id, { idempotencyKey: scheduledKey(claimed), ...context }, config);
    else await lifecycle.transitionSurvey(pool, user, claimed.survey_id, 'close', context);
  } catch (error) {
    // No incomplete eligible respondents is an intentional no-op for this cadence.
    // All other failures keep the occurrence due with the same idempotency key.
    const onlyNoRecipients = claimed.next_kind === 'reminder' && error.code === 'survey_not_ready' && error.details?.blockers?.length === 1 && error.details.blockers[0].code === 'recipients_missing';
    if (!onlyNoRecipients) {
      await pool.query('UPDATE survey_delivery_schedules SET lease_token=NULL,lease_expires_at=NULL WHERE id=$1 AND lease_token=$2', [claimed.id, claimed.lease_token]);
      throw error;
    }
  }
  const following = claimed.next_kind === 'close' ? null : nextReminder(claimed.next_local, claimed.timezone, claimed.reminder_every_days, claimed.close_at);
  const nextDueAt = following?.at || claimed.close_at;
  const nextKind = following ? 'reminder' : 'close';
  // Version and token fence an edit/cancel racing with the provider-boundary transaction.
  await pool.query(`UPDATE survey_delivery_schedules SET occurrence=occurrence+1,next_local=$3,next_due_at=$4,next_kind=$5,status=CASE WHEN $6::boolean THEN 'completed' ELSE status END,lease_token=NULL,lease_expires_at=NULL,updated_at=now() WHERE id=$1 AND lease_token=$2 AND version=$7 AND status='active'`, [claimed.id, claimed.lease_token, following?.local || claimed.next_local, nextDueAt, nextKind, claimed.next_kind === 'close', claimed.version]);
  return { scheduleId: claimed.id, kind: claimed.next_kind, launchId: launched?.id || null };
}

module.exports = { configure, view, cancel, claimDue, runDue, scheduledKey, publicSchedule };
