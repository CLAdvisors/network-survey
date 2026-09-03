'use strict';

const crypto = require('crypto');
const os = require('os');
const fs = require('fs');
const dotenvFlow = require('dotenv-flow');
const { Pool } = require('pg');
const { ResendProvider, reserveProviderRateOnClient, DEFAULT_SENDER } = require('./email');
const { SELECTED_EVENT_TYPES } = require('./webhooks');
const { emitMetrics } = require('./email-metrics');

dotenvFlow.config();

function createPool(env = process.env) {
  return new Pool({
    user: env.DB_USER,
    password: env.DB_PASSWORD,
    host: env.DB_HOST,
    port: env.DB_PORT,
    database: env.DB_NAME || 'ONA',
    ssl: env.DB_SSL === 'true' ? {
      ca: env.DB_SSL_CA ? fs.readFileSync(env.DB_SSL_CA, 'utf8') : undefined,
      rejectUnauthorized: Boolean(env.DB_SSL_CA),
    } : undefined,
  });
}

const EMAIL_EVENTS = new Set([
  'email.sent', 'email.delivered', 'email.delivery_delayed', 'email.bounced',
  'email.complained', 'email.failed', 'email.suppressed',
]);
const ACCEPTANCE_EVENTS = new Set([
  'email.sent', 'email.delivered', 'email.delivery_delayed', 'email.bounced',
  'email.complained', 'email.suppressed',
]);
const PROVIDER_COLUMNS = Object.freeze({
  'email.sent': 'provider_sent_at',
  'email.delivered': 'provider_delivered_at',
  'email.delivery_delayed': 'provider_delayed_at',
  'email.bounced': 'provider_bounced_at',
  'email.complained': 'provider_complained_at',
  'email.failed': 'provider_failed_at',
  'email.suppressed': 'provider_suppressed_at',
});
const SUPPRESSION_REASONS = Object.freeze({
  'email.bounced': 'permanent_bounce',
  'email.complained': 'complaint',
  'email.suppressed': 'provider_suppression',
  'suppression.added': 'provider_suppression',
  'suppression.removed': 'provider_suppression',
});
const TERMINAL_EVENT_STATES = new Set(['processed', 'ignored', 'dead_letter']);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const bounded = (value, length = 500) => String(value || '').replace(/[\r\n\t]+/g, ' ').slice(0, length);
const normalizeAddress = (value) => typeof value === 'string' ? value.trim().toLowerCase() : '';
const validAddress = (value) => {
  const normalized = normalizeAddress(value);
  return normalized.length <= 320 && normalized.indexOf('@') > 0;
};

function eventPayload(row) {
  if (Buffer.isBuffer(row.raw_payload)) return JSON.parse(row.raw_payload.toString('utf8'));
  if (row.raw_payload && typeof row.raw_payload === 'object') return row.raw_payload;
  if (typeof row.raw_payload !== 'string') throw new Error('payload_unavailable');
  return JSON.parse(row.raw_payload);
}

function eventTags(payload) {
  const tags = payload?.data?.tags;
  return tags && typeof tags === 'object' && !Array.isArray(tags) ? tags : {};
}

function effectiveProviderOutcome(delivery) {
  if (delivery?.provider_complained_at) return 'complained';
  if (delivery?.provider_bounced_at) return 'bounced';
  if (delivery?.provider_suppressed_at) return 'suppressed';
  if (delivery?.provider_failed_at) return 'failed';
  if (delivery?.provider_delivered_at) return 'delivered';
  if (delivery?.provider_delayed_at) return 'delayed';
  if (delivery?.provider_sent_at || delivery?.dispatch_accepted_at) return 'accepted';
  return null;
}

/** Equal-time adverse adds beat removals; IDs deterministically order like events. */
function shouldApplySuppressionEvent(current, incoming) {
  if (!current) return true;
  const oldTime = new Date(current.state_occurrence_at ?? current.source_occurred_at).getTime();
  const newTime = new Date(incoming.occurredAt).getTime();
  if (newTime !== oldTime) return newTime > oldTime;
  const oldActive = Boolean(current.provider_active);
  if (Boolean(incoming.active) !== oldActive) return Boolean(incoming.active);
  return String(incoming.eventId) > String(current.state_event_svix_id ?? '');
}

function validateKnownEvent(type, payload) {
  const data = payload?.data;
  if (!data || typeof data !== 'object' || Array.isArray(data)) return 'missing_event_data';
  if (EMAIL_EVENTS.has(type) && (typeof data.email_id !== 'string' || data.email_id.length < 1 || data.email_id.length > 256)) {
    return 'invalid_provider_message_id';
  }
  if ((type === 'suppression.added' || type === 'suppression.removed') && !validAddress(data.email)) {
    return 'invalid_suppression_address';
  }
  if (data.source_id != null && (typeof data.source_id !== 'string' || data.source_id.length > 255)) {
    return 'invalid_suppression_source_id';
  }
  return null;
}

function canaryAddress(environment) {
  const safe = String(environment || 'local').toLowerCase().replace(/[^a-z0-9_-]/g, '-').slice(0, 64);
  return `delivered+webhook-canary-${safe}@resend.dev`;
}

function canaryTags(environment, canaryId) {
  return [
    { name: 'app', value: 'network_survey' },
    { name: 'environment', value: String(environment).slice(0, 256) },
    { name: 'canary', value: String(canaryId).slice(0, 256) },
  ];
}

class WebhookWorker {
  constructor({ pool, provider, env = process.env, clock = () => new Date(), random = Math.random, sleepFn = sleep, instanceId } = {}) {
    if (!pool) throw new Error('Webhook worker pool is required');
    this.pool = pool;
    this.provider = provider;
    this.env = env;
    this.clock = clock;
    this.random = random;
    this.sleep = sleepFn;
    this.environment = String(env.EMAIL_WORKER_ENV || env.APP_ENV || env.NODE_ENV || 'local');
    this.providerAccountScope = String(env.RESEND_PROVIDER_ACCOUNT_SCOPE || '');
    if (!this.environment || this.environment !== this.environment.trim() || this.environment.length > 64) {
      throw new Error('Webhook worker environment must be 1-64 trimmed characters');
    }
    if (!this.providerAccountScope || this.providerAccountScope !== this.providerAccountScope.trim() || this.providerAccountScope.length > 128) {
      throw new Error('Webhook worker provider account scope must be 1-128 trimmed characters');
    }
    this.release = env.RELEASE_REVISION || env.REVISION || 'local';
    this.instanceId = instanceId || `${env.DEPLOYMENT_ID || 'local'}/${os.hostname()}/${process.pid}/${crypto.randomUUID()}`;
    this.leaseSeconds = Math.max(20, Number(env.RESEND_WEBHOOK_LEASE_SECONDS || 60));
    this.maxAttempts = Math.max(1, Number(env.RESEND_WEBHOOK_MAX_ATTEMPTS || 12));
    this.maxAgeHours = Math.max(1, Number(env.RESEND_WEBHOOK_MAX_AGE_HOURS || 72));
    this.unmatchedDays = Math.max(1, Number(env.RESEND_WEBHOOK_UNMATCHED_DAYS || 7));
    this.stopped = false;
    this.processing = false;
    this.lastError = null;
  }

  backoff(attempt) {
    const cap = Math.min(3600000, 1000 * (2 ** Math.min(Number(attempt) || 1, 12)));
    return Math.floor(this.random() * cap);
  }

  async heartbeat() {
    await this.pool.query(
      `INSERT INTO email_webhook_worker_heartbeats
        (environment,worker_instance,release_revision,enabled,claiming,processing,heartbeat_at,last_error_code,last_error,started_at)
       VALUES($1,$2,$3,true,$4,$4,now(),$5,$6,now())
       ON CONFLICT(environment,worker_instance) DO UPDATE SET
        release_revision=excluded.release_revision,enabled=true,claiming=excluded.claiming,
        processing=excluded.processing,heartbeat_at=now(),last_error_code=excluded.last_error_code,
        last_error=excluded.last_error`,
      [this.environment, this.instanceId, this.release, this.processing,
        this.lastError ? 'worker_error' : null, this.lastError ? bounded(this.lastError) : null]
    );
  }

  async control() {
    const result = await this.pool.query(
      'SELECT processing_enabled,minimum_release FROM email_webhook_worker_control WHERE environment=$1',
      [this.environment]
    );
    const row = result.rows[0];
    return Boolean(row?.processing_enabled && (!row.minimum_release || row.minimum_release === this.release));
  }

  async claim() {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const control = (await client.query(
        'SELECT claiming_enabled,processing_enabled,minimum_release FROM email_webhook_worker_control WHERE environment=$1 FOR SHARE',
        [this.environment]
      )).rows[0];
      if (!control?.claiming_enabled || !control.processing_enabled || (control.minimum_release && control.minimum_release !== this.release)) {
        await client.query('COMMIT');
        return null;
      }
      const selected = (await client.query(
        `SELECT * FROM email_webhook_events
         WHERE provider_account_scope=$1 AND
          ((status IN ('pending','retry_wait','unmatched') AND next_attempt_at<=now())
           OR (status='leased' AND lease_expires_at<=now()))
         ORDER BY next_attempt_at NULLS FIRST,received_at
         FOR UPDATE SKIP LOCKED LIMIT 1`,
        [this.providerAccountScope]
      )).rows[0];
      if (!selected) {
        await client.query('COMMIT');
        return null;
      }
      const token = crypto.randomUUID();
      const claimed = (await client.query(
        `UPDATE email_webhook_events SET status='leased',lease_owner=$2,lease_token=$3,
          lease_expires_at=now()+($4::text||' seconds')::interval,next_attempt_at=NULL,
          processing_attempt_count=processing_attempt_count+1,updated_at=now()
         WHERE id=$1 RETURNING *`,
        [selected.id, this.instanceId, token, this.leaseSeconds]
      )).rows[0];
      await client.query('COMMIT');
      return claimed;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  async correlate(client, event, payload) {
    const providerId = payload?.data?.email_id || event.provider_message_id;
    const tags = eventTags(payload);
    const tag = tags.app === 'network_survey' && tags.environment === this.environment
      ? (tags.delivery_id || event.delivery_tag) : null;
    let byProvider = null;
    let byTag = null;
    if (providerId) {
      byProvider = (await client.query(
        `SELECT d.* FROM survey_email_deliveries d JOIN survey_launches l ON l.id=d.launch_id
         WHERE d.provider_message_id=$1 AND (l.kind<>'reminder' OR l.provider_account_scope IS NULL OR l.provider_account_scope=$2)
         FOR UPDATE OF d`, [providerId,event.provider_account_scope]
      )).rows[0] || null;
    }
    if (tag && UUID_PATTERN.test(tag)) {
      byTag = (await client.query(
        `SELECT d.* FROM survey_email_deliveries d JOIN survey_launches l ON l.id=d.launch_id
         WHERE d.id=$1 AND (l.kind<>'reminder' OR l.provider_account_scope IS NULL OR l.provider_account_scope=$2)
         FOR UPDATE OF d`, [tag,event.provider_account_scope]
      )).rows[0] || null;
    }
    if (byProvider && byTag && byProvider.id !== byTag.id) throw new Error('correlation_conflict');
    const delivery = byProvider || byTag;
    if (delivery?.provider_message_id && providerId && delivery.provider_message_id !== providerId) {
      throw new Error('provider_message_id_conflict');
    }
    return delivery;
  }

  async finishEvent(client, event, status, { code = null, message = null, deliveryId = null } = {}) {
    const result = await client.query(
      `UPDATE email_webhook_events SET status=$3,correlated_delivery_id=COALESCE($4,correlated_delivery_id),
        lease_owner=NULL,lease_token=NULL,lease_expires_at=NULL,next_attempt_at=NULL,unmatched_since_at=NULL,
        last_error_code=$5,last_error_message=$6,
        processed_at=CASE WHEN $3 IN ('processed','ignored') THEN now() ELSE processed_at END,
        dead_lettered_at=CASE WHEN $3='dead_letter' THEN now() ELSE dead_lettered_at END,updated_at=now()
       WHERE id=$1 AND status='leased' AND lease_token=$2`,
      [event.id, event.lease_token, status, deliveryId, code, message ? bounded(message) : null]
    );
    if (result.rowCount !== 1) throw new Error('stale_event_lease');
  }

  async upsertSuppression(client, { address, reason, active, event, payload }) {
    const normalized = normalizeAddress(address);
    if (!validAddress(address)) throw new Error('invalid_suppression_address');
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`email-suppression-boundary:${this.providerAccountScope}:${normalized}`]);
    const sourceId = payload?.data?.source_id || payload?.data?.id || null;
    const current = (await client.query(
      `SELECT * FROM email_suppressions
       WHERE provider_account_scope=$1 AND normalized_address=$2 AND reason=$3 FOR UPDATE`,
      [this.providerAccountScope, normalized, reason]
    )).rows[0];
    const incoming = { occurredAt: event.event_created_at, eventId: event.svix_id, active };
    if (!shouldApplySuppressionEvent(current, incoming)) {
      await client.query(
        `INSERT INTO email_suppression_audit
          (provider_account_scope,normalized_address,reason,receiving_environment,action,cause_version,
           provider_active,occurrence_at,source_webhook_event_id,source_event_svix_id,provider_suppression_id,detail)
         VALUES($1,$2,$3,$4,'stale_event_ignored',$5,$6,$7,$8,$9,$10,'{}'::jsonb)`,
        [this.providerAccountScope, normalized, reason, this.environment, current.cause_version,
          current.provider_active, event.event_created_at, event.id, event.svix_id, sourceId]
      );
      return { normalized, applied: false };
    }
    const version = Number(current?.cause_version || 0) + 1;
    await client.query(
      `INSERT INTO email_suppressions
        (provider_account_scope,normalized_address,reason,receiving_environment,provider_active,
         provider_suppression_id,source_webhook_event_id,source_occurred_at,state_occurrence_at,
         state_event_svix_id,state_is_adverse,last_add_occurrence_at,last_add_event_svix_id,
         last_remove_occurrence_at,last_remove_event_svix_id,cause_version,created_at,updated_at)
       VALUES($1,$2,$3,$4,$5::boolean,$6,$7,$8::timestamptz,$8::timestamptz,$9::text,$5::boolean,
         CASE WHEN $5::boolean THEN $8::timestamptz ELSE NULL END,CASE WHEN $5::boolean THEN $9::text ELSE NULL END,
         CASE WHEN $5::boolean THEN NULL ELSE $8::timestamptz END,CASE WHEN $5::boolean THEN NULL ELSE $9::text END,$10,now(),now())
       ON CONFLICT(provider_account_scope,normalized_address,reason) DO UPDATE SET
        receiving_environment=excluded.receiving_environment,provider_active=excluded.provider_active,
        provider_suppression_id=excluded.provider_suppression_id,
        source_webhook_event_id=excluded.source_webhook_event_id,source_occurred_at=excluded.source_occurred_at,
        state_occurrence_at=excluded.state_occurrence_at,state_event_svix_id=excluded.state_event_svix_id,
        state_is_adverse=excluded.state_is_adverse,
        last_add_occurrence_at=COALESCE(excluded.last_add_occurrence_at,email_suppressions.last_add_occurrence_at),
        last_add_event_svix_id=COALESCE(excluded.last_add_event_svix_id,email_suppressions.last_add_event_svix_id),
        last_remove_occurrence_at=COALESCE(excluded.last_remove_occurrence_at,email_suppressions.last_remove_occurrence_at),
        last_remove_event_svix_id=COALESCE(excluded.last_remove_event_svix_id,email_suppressions.last_remove_event_svix_id),
        cause_version=excluded.cause_version,locally_overridden_at=NULL,override_cause_version=NULL,
        locally_overridden_by_actor=NULL,updated_at=now()`,
      [this.providerAccountScope, normalized, reason, this.environment, active, sourceId,
        event.id, event.event_created_at, event.svix_id, version]
    );
    await client.query(
      `INSERT INTO email_suppression_audit
        (provider_account_scope,normalized_address,reason,receiving_environment,action,cause_version,
         provider_active,occurrence_at,source_webhook_event_id,source_event_svix_id,provider_suppression_id,detail)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'{}'::jsonb)`,
      [this.providerAccountScope, normalized, reason, this.environment,
        active ? 'adverse_add' : 'provider_remove', version, active,
        event.event_created_at, event.id, event.svix_id, sourceId]
    );
    return { normalized, applied: true };
  }

  async projectDelivery(client, event, payload, delivery) {
    const type = event.event_type;
    const providerId = payload.data.email_id;
    const occurrenceColumn = PROVIDER_COLUMNS[type];
    if (occurrenceColumn) {
      await client.query(
        `UPDATE survey_email_deliveries SET ${occurrenceColumn}=CASE
          WHEN ${occurrenceColumn} IS NULL THEN $2 ELSE LEAST(${occurrenceColumn},$2) END,
          provider_message_id=COALESCE(provider_message_id,$3),updated_at=now() WHERE id=$1`,
        [delivery.id, event.event_created_at, providerId]
      );
    }

    if (ACCEPTANCE_EVENTS.has(type)) {
      if (delivery.status === 'leased' || delivery.status === 'reminder_leased') {
        await client.query(
          `UPDATE survey_email_attempts SET finished_at=COALESCE(finished_at,now()),
            outcome=CASE WHEN provider_started_at IS NOT NULL THEN 'accepted' ELSE 'cancelled' END,
            provider_message_id=COALESCE(provider_message_id,$2),
            error_message=CASE WHEN provider_started_at IS NULL THEN 'provider_acceptance_reconciled' ELSE error_message END
           WHERE delivery_id=$1 AND lease_token=$3 AND outcome='in_progress'`,
          [delivery.id, providerId, delivery.lease_token]
        );
      }
      await client.query(
        `UPDATE survey_email_deliveries SET status='accepted',provider_message_id=COALESCE(provider_message_id,$2),
          dispatch_accepted_at=COALESCE(dispatch_accepted_at,now()),dispatch_failed_at=NULL,lease_owner=NULL,lease_token=NULL,
          lease_expires_at=NULL,next_attempt_at=now(),updated_at=now()
         WHERE id=$1 AND status IN ('pending','retry_wait','leased','reminder_pending','reminder_retry_wait','reminder_leased','uncertain','failed','cancelled','accepted')`,
        [delivery.id, providerId]
      );
      await client.query(
        `UPDATE respondent SET email_sent=true WHERE respondent_id=$1 AND survey_id=$2
           AND EXISTS(SELECT 1 FROM survey_launches l WHERE l.id=$3 AND l.kind='initial')`,
        [delivery.respondent_id, delivery.survey_id, delivery.launch_id]
      );
    }

    const reason = SUPPRESSION_REASONS[type];
    let suppression = null;
    if (reason) {
      suppression = await this.upsertSuppression(client, {
        address: delivery.to_address, reason, active: true, event, payload,
      });
    }
    return suppression?.normalized || null;
  }

  async projectCanaryEvent(client, event, payload) {
    const tags = eventTags(payload);
    const token = UUID_PATTERN.test(tags.canary || '') ? tags.canary : null;
    const providerId = payload?.data?.email_id;
    if (!token && !providerId) return false;
    const canary = (await client.query(
      `SELECT * FROM email_webhook_canary_state WHERE environment=$1 AND
        (($2::uuid IS NOT NULL AND canary_token=$2::uuid) OR ($3::text IS NOT NULL AND provider_message_id=$3))
       FOR UPDATE`,
      [this.environment, token, providerId]
    )).rows[0];
    if (!canary) return false;
    if (Number(event.replay_count || 0) > 0) return true;
    if (event.event_type === 'email.delivered') {
      await client.query(
        `UPDATE email_webhook_canary_state SET status='idle',provider_message_id=COALESCE(provider_message_id,$2),
          sent_at=COALESCE(sent_at,$3),delivered_at=LEAST(COALESCE(delivered_at,$3),$3),
          correlated_webhook_event_id=$4,completed_at=now(),last_success_at=now(),
          next_run_at=now()+interval '6 hours',lease_owner=NULL,lease_token=NULL,lease_expires_at=NULL,updated_at=now()
         WHERE environment=$1`,
        [this.environment, providerId, event.event_created_at, event.id]
      );
    } else if (event.event_type === 'email.sent') {
      await client.query(
        `UPDATE email_webhook_canary_state SET status='awaiting_webhook',
          provider_message_id=COALESCE(provider_message_id,$2),sent_at=LEAST(COALESCE(sent_at,$3),$3),
          lease_owner=NULL,lease_token=NULL,lease_expires_at=NULL,updated_at=now()
         WHERE environment=$1 AND delivered_at IS NULL`,
        [this.environment, providerId, event.event_created_at]
      );
    } else if (['email.bounced','email.complained','email.failed','email.suppressed'].includes(event.event_type)) {
      await client.query(
        `UPDATE email_webhook_canary_state SET status='failed',last_error_code=$2,
          last_error_message='Provider canary produced an adverse event',next_run_at=now()+interval '1 hour',
          lease_owner=NULL,lease_token=NULL,lease_expires_at=NULL,updated_at=now() WHERE environment=$1`,
        [this.environment, event.event_type.slice(0, 64)]
      );
    }
    return true;
  }

  async process(event) {
    let payload;
    try { payload = eventPayload(event); } catch (error) { return this.deadLetter(event, 'malformed_payload', error.message); }
    const client = await this.pool.connect();
    let reconcileAddress = null;
    try {
      await client.query('BEGIN');
      const fenced = (await client.query(
        `SELECT * FROM email_webhook_events
         WHERE id=$1 AND status='leased' AND lease_token=$2 FOR UPDATE`,
        [event.id, event.lease_token]
      )).rows[0];
      if (!fenced) {
        await client.query('COMMIT');
        return { action: 'stale' };
      }
      event = { ...event, ...fenced };
      const type = event.event_type;
      if (!SELECTED_EVENT_TYPES.has(type)) {
        await this.finishEvent(client, event, 'ignored', { code: 'unsupported_event_type' });
        await client.query('COMMIT');
        return { action: 'ignored' };
      }
      const malformed = validateKnownEvent(type, payload);
      if (malformed) {
        await this.finishEvent(client, event, 'dead_letter', { code: malformed, message: malformed });
        await client.query('COMMIT');
        return { action: 'dead_letter' };
      }

      const tags = eventTags(payload);
      if (EMAIL_EVENTS.has(type) && tags.app === 'network_survey' && tags.environment && tags.environment !== this.environment) {
        await this.finishEvent(client, event, 'ignored', { code: 'foreign_environment' });
        await client.query('COMMIT');
        return { action: 'ignored' };
      }

      if (EMAIL_EVENTS.has(type) && await this.projectCanaryEvent(client, event, payload)) {
        await this.finishEvent(client, event, 'processed');
        await client.query('COMMIT');
      } else if (EMAIL_EVENTS.has(type) && UUID_PATTERN.test(tags.canary || '')) {
        await this.finishEvent(client,event,'ignored',{code:'stale_canary'});
        await client.query('COMMIT');
        return {action:'ignored'};
      } else if (type === 'suppression.added' || type === 'suppression.removed') {
        const normalized = normalizeAddress(payload.data.email);
        const reasons = [type === 'suppression.added' && payload.data.origin === 'bounce' ? 'permanent_bounce'
          : type === 'suppression.added' && payload.data.origin === 'complaint' ? 'complaint' : 'provider_suppression'];
        for (const reason of reasons) await this.upsertSuppression(client, {
          address: normalized,
          reason,
          active: type === 'suppression.added',
          event,
          payload,
        });
        reconcileAddress = normalized;
        await this.finishEvent(client, event, 'processed');
        await client.query('COMMIT');
      } else {
        const delivery = await this.correlate(client, event, payload);
        if (!delivery) {
          const adverseReason=SUPPRESSION_REASONS[type];
          const recipients=Array.isArray(payload.data.to)?payload.data.to:[];
          if(adverseReason&&recipients.length===1&&validAddress(recipients[0])){
            const suppression=await this.upsertSuppression(client,{address:recipients[0],reason:adverseReason,active:true,event,payload});
            await this.finishEvent(client,event,'processed');
            await client.query('COMMIT');
            await this.reconcileAddress(suppression.normalized);
            return {action:'processed'};
          }
          if (tags.app !== 'network_survey') {
            await this.finishEvent(client,event,'ignored',{code:'non_survey_email'});
            await client.query('COMMIT');
            return {action:'ignored'};
          }
          await client.query('ROLLBACK');
          return this.markUnmatched(event);
        }
        reconcileAddress = await this.projectDelivery(client, event, payload, delivery);
        await this.finishEvent(client, event, 'processed', { deliveryId: delivery.id });
        await client.query('COMMIT');
      }
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      if (['correlation_conflict', 'provider_message_id_conflict', 'invalid_suppression_address'].includes(error.message)) {
        return this.deadLetter(event, error.message, error.message);
      }
      if (error.message === 'stale_event_lease') return { action: 'stale' };
      return this.retry(event, 'projection_error', error.message);
    } finally {
      client.release();
    }
    if (reconcileAddress) await this.reconcileAddress(reconcileAddress).catch((error) => {
      this.lastError = `suppression_reconcile:${bounded(error.message, 200)}`;
      emitMetrics({ environment:this.environment,release:this.release,metrics:{ SuppressionReconciliationFailureCount:1 } });
    });
    return { action: 'processed' };
  }

  async retry(event, code, message) {
    const ageExceeded = new Date(event.received_at).getTime() <= this.clock().getTime() - this.maxAgeHours * 3600000;
    const exhausted = Number(event.processing_attempt_count || 0) >= this.maxAttempts || ageExceeded;
    const status = exhausted ? 'dead_letter' : 'retry_wait';
    const delay = this.backoff(event.processing_attempt_count);
    const result = await this.pool.query(
      `UPDATE email_webhook_events SET status=$3,next_attempt_at=CASE WHEN $3='retry_wait'
        THEN now()+($4::text||' milliseconds')::interval ELSE NULL END,unmatched_since_at=NULL,
        lease_owner=NULL,lease_token=NULL,lease_expires_at=NULL,last_error_code=$5,last_error_message=$6,
        dead_lettered_at=CASE WHEN $3='dead_letter' THEN now() ELSE NULL END,processed_at=NULL,updated_at=now()
       WHERE id=$1 AND status='leased' AND lease_token=$2`,
      [event.id, event.lease_token, status, delay, code, bounded(message)]
    );
    return { action: result.rowCount ? status : 'stale' };
  }

  async markUnmatched(event) {
    const expired = new Date(event.received_at).getTime() <= this.clock().getTime() - this.unmatchedDays * 86400000;
    const status = expired ? 'dead_letter' : 'unmatched';
    const result = await this.pool.query(
      `UPDATE email_webhook_events SET status=$3,next_attempt_at=CASE WHEN $3='unmatched'
        THEN now()+($4::text||' milliseconds')::interval ELSE NULL END,
        unmatched_since_at=CASE WHEN $3='unmatched' THEN COALESCE(unmatched_since_at,now()) ELSE NULL END,
        lease_owner=NULL,lease_token=NULL,lease_expires_at=NULL,last_error_code='delivery_unmatched',
        last_error_message=NULL,processed_at=NULL,
        dead_lettered_at=CASE WHEN $3='dead_letter' THEN now() ELSE NULL END,updated_at=now()
       WHERE id=$1 AND status='leased' AND lease_token=$2`,
      [event.id, event.lease_token, status, this.backoff(event.processing_attempt_count)]
    );
    return { action: result.rowCount ? status : 'stale' };
  }

  async deadLetter(event, code, message) {
    const result = await this.pool.query(
      `UPDATE email_webhook_events SET status='dead_letter',lease_owner=NULL,lease_token=NULL,
        lease_expires_at=NULL,next_attempt_at=NULL,unmatched_since_at=NULL,processed_at=NULL,
        last_error_code=$3,last_error_message=$4,dead_lettered_at=now(),updated_at=now()
       WHERE id=$1 AND status='leased' AND lease_token=$2`,
      [event.id, event.lease_token, code, bounded(message)]
    );
    return { action: result.rowCount ? 'dead_letter' : 'stale' };
  }

  async reconcileAddress(address) {
    const normalized = normalizeAddress(address);
    if (!normalized) return { cancelled: 0, fenced: 0 };
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      // Preserve universal lock order: delivery rows are locked before the address boundary.
      const lockedCandidates = await client.query(
        `SELECT d.id FROM survey_email_deliveries d JOIN survey_launches l ON l.id=d.launch_id
          WHERE lower(btrim(d.to_address))=$1
          AND (l.kind<>'reminder' OR l.provider_account_scope IS NULL OR l.provider_account_scope=$2)
          AND d.status IN ('pending','retry_wait','leased','reminder_pending','reminder_retry_wait','reminder_leased')
          ORDER BY d.id FOR UPDATE OF d`, [normalized,this.providerAccountScope]
      );
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`email-suppression-boundary:${this.providerAccountScope}:${normalized}`]);
      const active = (await client.query(
        `SELECT EXISTS(SELECT 1 FROM email_suppressions WHERE provider_account_scope=$1
          AND normalized_address=$2 AND (provider_active OR locally_overridden_at IS NULL
           OR override_cause_version IS DISTINCT FROM cause_version)) AS suppressed`,
        [this.providerAccountScope, normalized]
      )).rows[0]?.suppressed;
      if (!active) {
        await client.query('COMMIT');
        return { cancelled: 0, fenced: 0 };
      }
      // Use a fresh READ COMMITTED snapshot after acquiring the row locks. A
      // finalizer that committed while the locking SELECT waited may have added
      // an uncertain attempt and moved the delivery into retry_wait.
      const candidates = lockedCandidates.rowCount ? await client.query(
        `SELECT d.id,d.status,EXISTS(SELECT 1 FROM survey_email_attempts a WHERE a.delivery_id=d.id AND a.outcome='uncertain' AND a.provider_started_at IS NOT NULL) AS unresolved_provider_outcome
           FROM survey_email_deliveries d WHERE d.id=ANY($1::uuid[]) ORDER BY d.id`,
        [lockedCandidates.rows.map((row)=>row.id)]
      ) : { rows: [] };
      const uncertainIds = candidates.rows.filter((row) => ['pending','retry_wait','reminder_pending','reminder_retry_wait'].includes(row.status) && row.unresolved_provider_outcome).map((row) => row.id);
      const uncertainSet = new Set(uncertainIds);
      const pendingIds = candidates.rows.filter((row) => !['leased','reminder_leased'].includes(row.status) && !uncertainSet.has(row.id)).map((row) => row.id);
      const leasedRows = candidates.rows.filter((row) => ['leased','reminder_leased'].includes(row.status));
      const leasedIds = leasedRows.map((row) => row.id);
      const leasedUncertainIds = leasedRows.filter((row) => row.unresolved_provider_outcome).map((row) => row.id);
      const uncertain = uncertainIds.length ? await client.query(
        `UPDATE survey_email_deliveries SET status='uncertain',dispatch_failed_at=COALESCE(dispatch_failed_at,now()),
          provider_suppressed_at=COALESCE(provider_suppressed_at,now()),lease_owner=NULL,lease_token=NULL,lease_expires_at=NULL,updated_at=now()
         WHERE id=ANY($1::uuid[]) AND status IN ('pending','retry_wait','reminder_pending','reminder_retry_wait')`, [uncertainIds]
      ) : { rowCount: 0 };
      const cancelled = pendingIds.length ? await client.query(
        `UPDATE survey_email_deliveries SET status='cancelled',provider_suppressed_at=COALESCE(provider_suppressed_at,now()),
          last_error_code='suppressed',lease_owner=NULL,lease_token=NULL,lease_expires_at=NULL,updated_at=now()
         WHERE id=ANY($1::uuid[]) AND status IN ('pending','retry_wait','reminder_pending','reminder_retry_wait')`, [pendingIds]
      ) : { rowCount: 0 };
      const fenced = leasedIds.length ? await client.query(
        `UPDATE survey_email_deliveries SET cancellation_requested_at=COALESCE(cancellation_requested_at,now()),
          provider_suppressed_at=COALESCE(provider_suppressed_at,now()),last_error_code=CASE WHEN id=ANY($2::uuid[]) THEN last_error_code ELSE 'suppressed' END,updated_at=now()
         WHERE id=ANY($1::uuid[]) AND status IN ('leased','reminder_leased')`, [leasedIds,leasedUncertainIds]
      ) : { rowCount: 0 };
      await client.query('COMMIT');
      return { cancelled: cancelled.rowCount + uncertain.rowCount, fenced: fenced.rowCount };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally { client.release(); }
  }

  async reconcileUnmatched({ providerMessageId = null, deliveryId = null } = {}) {
    if (!providerMessageId && !deliveryId) throw new Error('A provider message ID or delivery ID is required');
    const result = await this.pool.query(
      `UPDATE email_webhook_events SET next_attempt_at=now(),updated_at=now()
       WHERE provider_account_scope=$1 AND status='unmatched'
        AND (($2::text IS NOT NULL AND provider_message_id=$2)
          OR ($3::text IS NOT NULL AND delivery_tag=$3))`,
      [this.providerAccountScope, providerMessageId, deliveryId]
    );
    return result.rowCount;
  }

  async replay(eventId, actor, reason) {
    if (!actor || !reason) throw new Error('Replay actor and reason are required');
    const result = await this.pool.query(
      `UPDATE email_webhook_events SET status='pending',next_attempt_at=now(),unmatched_since_at=NULL,
        lease_owner=NULL,lease_token=NULL,lease_expires_at=NULL,last_error_code=NULL,last_error_message=NULL,
        processed_at=NULL,dead_lettered_at=NULL,
        replay_count=replay_count+1,last_replayed_at=now(),last_replayed_by_actor=$2,last_replay_reason=$3,updated_at=now()
       WHERE id=$1 AND status IN ('processed','ignored','dead_letter','unmatched') AND raw_payload IS NOT NULL
       RETURNING id,replay_count`, [eventId, String(actor).slice(0, 200), String(reason).slice(0,500)]
    );
    if (!result.rows[0]) throw new Error('Event is not replayable');
    return result.rows[0];
  }

  async purgeExpired(limit = 100) {
    const batch = Math.max(1, Math.min(100, Number(limit) || 100));
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const rows = await client.query(
        `SELECT id,status FROM email_webhook_events WHERE raw_payload IS NOT NULL AND payload_expires_at<=now()
         ORDER BY payload_expires_at FOR UPDATE SKIP LOCKED LIMIT $1`, [batch]
      );
      if (rows.rows.length) {
        await client.query(
          `UPDATE email_webhook_events SET raw_payload=NULL,
            status=CASE WHEN status IN ('processed','ignored','dead_letter') THEN status ELSE 'dead_letter' END,
            last_error_code=CASE WHEN status IN ('processed','ignored','dead_letter') THEN last_error_code ELSE 'payload_expired' END,
            dead_lettered_at=CASE WHEN status IN ('processed','ignored','dead_letter') THEN dead_lettered_at ELSE now() END,
            processed_at=CASE WHEN status IN ('processed','ignored') THEN processed_at ELSE NULL END,
            next_attempt_at=NULL,unmatched_since_at=NULL,lease_owner=NULL,lease_token=NULL,lease_expires_at=NULL,updated_at=now()
           WHERE id=ANY($1::bigint[])`, [rows.rows.map((row) => row.id)]
        );
      }
      await client.query('COMMIT');
      return rows.rows.length;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally { client.release(); }
  }

  async claimCanary() {
    const token = crypto.randomUUID();
    await this.pool.query(
      `INSERT INTO email_webhook_canary_state
        (environment,provider_account_scope,status,scheduled_at,next_run_at)
       VALUES($1,$2,'idle',now(),now()) ON CONFLICT(environment) DO NOTHING`,
      [this.environment, this.providerAccountScope]
    );
    await this.pool.query(`UPDATE email_webhook_canary_state SET status='retry_wait',next_run_at=now(),canary_token=NULL,last_error_code=COALESCE(last_error_code,'webhook_timeout'),updated_at=now() WHERE environment=$1 AND ((status='awaiting_webhook' AND sent_at<now()-interval '1 hour') OR (status='failed' AND next_run_at<=now()))`, [this.environment]);
    const result = await this.pool.query(
      `UPDATE email_webhook_canary_state SET status='leased',canary_token=CASE WHEN status='idle' THEN $3 ELSE COALESCE(canary_token,$3) END,lease_owner=$2,
        lease_token=gen_random_uuid(),lease_expires_at=now()+interval '5 minutes',
        attempt_count=attempt_count+1,scheduled_at=now(),provider_started_at=NULL,provider_message_id=NULL,
        sent_at=NULL,delivered_at=NULL,correlated_webhook_event_id=NULL,completed_at=NULL,
        last_error_code=NULL,last_error_message=NULL,updated_at=now()
       WHERE environment=$1 AND ((status IN ('idle','retry_wait') AND next_run_at<=now())
         OR (status IN ('leased','sending') AND lease_expires_at<=now())) RETURNING *`,
      [this.environment, this.instanceId, token]
    );
    return result.rows[0] || null;
  }

  buildCanaryPayload(canary) {
    return {
      from: this.env.SURVEY_EMAIL_SENDER || DEFAULT_SENDER,
      to: canaryAddress(this.environment),
      subject: 'Network Survey webhook canary',
      text: 'Webhook routing canary',
      tags: canaryTags(this.environment, canary.canary_token),
    };
  }

  async markCanarySending(canary, executor=this.pool) {
    const result = await executor.query(
      `UPDATE email_webhook_canary_state SET status='sending',provider_started_at=now(),updated_at=now()
       WHERE environment=$1 AND status='leased' AND lease_token=$2`,
      [this.environment, canary.lease_token]
    );
    return result.rowCount === 1;
  }

  async markCanarySent(canary, providerMessageId, executor=this.pool) {
    const result = await executor.query(
      `UPDATE email_webhook_canary_state SET status='awaiting_webhook',provider_message_id=$3,sent_at=now(),
        lease_owner=NULL,lease_token=NULL,lease_expires_at=NULL,updated_at=now()
       WHERE environment=$1 AND status='sending' AND lease_token=$2`,
      [this.environment, canary.lease_token, providerMessageId]
    );
    return result.rowCount === 1;
  }

  async completeCanary(canaryToken, providerMessageId, eventId = null, occurredAt = this.clock()) {
    return this.pool.query(
      `UPDATE email_webhook_canary_state SET status='idle',provider_message_id=COALESCE(provider_message_id,$2),
        sent_at=COALESCE(sent_at,$4),delivered_at=LEAST(COALESCE(delivered_at,$4),$4),
        correlated_webhook_event_id=COALESCE($3,correlated_webhook_event_id),completed_at=now(),
        last_success_at=now(),next_run_at=now()+interval '6 hours',lease_owner=NULL,lease_token=NULL,
        lease_expires_at=NULL,updated_at=now() WHERE canary_token=$1`,
      [canaryToken, providerMessageId, eventId, occurredAt]
    );
  }

  async processCanary(canary) {
    const client = await this.pool.connect();
    let boundaryLocked = false;
    try {
      const rate = Math.max(1, Number(this.env.EMAIL_RATE_PER_SECOND || 5));
      const budgetEnvironment = this.env.EMAIL_RATE_BUDGET_ENV || this.environment;
      await client.query(`SELECT pg_advisory_lock(hashtextextended($1,0))`, [`email-provider-boundary:${this.environment}`]);
      boundaryLocked = true;
      const control = (await client.query(`SELECT sending_enabled,minimum_release FROM email_sending_control WHERE environment=$1`, [this.environment])).rows[0];
      if (!control?.sending_enabled || (control.minimum_release && control.minimum_release !== this.release)) {
        await client.query(`UPDATE email_webhook_canary_state SET status='retry_wait',next_run_at=now()+interval '5 minutes',lease_owner=NULL,lease_token=NULL,lease_expires_at=NULL,last_error_code='sending_disabled',updated_at=now() WHERE environment=$1 AND lease_token=$2`, [this.environment,canary.lease_token]);
        return;
      }
      if (!await reserveProviderRateOnClient(client, budgetEnvironment, rate)) {
        await client.query(`UPDATE email_webhook_canary_state SET status='retry_wait',next_run_at=now()+interval '1 minute',lease_owner=NULL,lease_token=NULL,lease_expires_at=NULL,last_error_code='provider_rate_wait',updated_at=now() WHERE environment=$1 AND lease_token=$2`, [this.environment,canary.lease_token]);
        return;
      }
      if (!await this.markCanarySending(canary,client)) return;
      const result = await this.provider.send(this.buildCanaryPayload(canary), { idempotencyKey:`webhook-canary/${canary.canary_token}` });
      await this.markCanarySent(canary,result.id,client);
    } catch (error) {
      await client.query(`UPDATE email_webhook_canary_state SET status='retry_wait',next_run_at=now()+interval '15 minutes',lease_owner=NULL,lease_token=NULL,lease_expires_at=NULL,last_error_code='canary_send_failed',last_error_message=$3,updated_at=now() WHERE environment=$1 AND lease_token=$2`, [this.environment,canary.lease_token,bounded(error.message)]).catch(()=>{});
      this.lastError=bounded(error.message);
    } finally {
      if (boundaryLocked) await client.query(`SELECT pg_advisory_unlock(hashtextextended($1,0))`, [`email-provider-boundary:${this.environment}`]).catch(()=>{});
      client.release();
    }
  }

  async emitOperationalMetrics() {
    const row = (await this.pool.query(`SELECT
      COALESCE((SELECT extract(epoch FROM now()-min(received_at)) FROM email_webhook_events WHERE receiving_environment=$1 AND status IN ('pending','retry_wait','leased')),0)::float8 AS pending_age,
      COALESCE((SELECT extract(epoch FROM now()-min(unmatched_since_at)) FROM email_webhook_events WHERE receiving_environment=$1 AND status='unmatched'),0)::float8 AS unmatched_age,
      (SELECT count(*)::int FROM email_webhook_events WHERE receiving_environment=$1 AND status='dead_letter') AS dead_count,
      (SELECT count(*)::int FROM survey_email_deliveries WHERE status='uncertain') AS uncertain_count,
      COALESCE((SELECT CASE WHEN last_success_at IS NULL THEN extract(epoch FROM now()-created_at) ELSE extract(epoch FROM now()-last_success_at) END FROM email_webhook_canary_state WHERE environment=$1),0)::float8 AS canary_age,
      COALESCE((SELECT (NOT claiming_enabled AND reason ILIKE '%quota%')::int FROM email_worker_control WHERE environment=$1),0)::int AS quota_disabled`, [this.environment])).rows[0];
    emitMetrics({ namespace:this.env.WEBHOOK_METRIC_NAMESPACE,environment:this.environment,release:this.release,metrics:{
      WebhookWorkerHeartbeat:1,
      OldestPendingEventAgeSeconds:Number(row.pending_age||0),
      OldestUnmatchedEventAgeSeconds:Number(row.unmatched_age||0),
      DeadLetterCount:Number(row.dead_count||0),
      UncertainDeliveryCount:Number(row.uncertain_count||0),
      QuotaClaimingDisabled:Number(row.quota_disabled||0),
      WebhookCanaryAgeSeconds:Number(row.canary_age||0),
    }});
  }

  async processOne() {
    const event = await this.claim();
    if (event) { await this.process(event); return true; }
    if (this.provider) {
      const canary = await this.claimCanary();
      if (canary) { await this.processCanary(canary); return true; }
    }
    return false;
  }

  async run() {
    const heartbeatMs = Math.max(3000, Number(this.env.RESEND_WEBHOOK_HEARTBEAT_MS || 10000));
    const timer = setInterval(() => this.heartbeat().catch((error) => { this.lastError = error.message; }), heartbeatMs);
    const maintenance = setInterval(() => {
      this.emitOperationalMetrics().catch((error) => { this.lastError = error.message; });
      this.purgeExpired(100).catch((error) => {
        this.lastError = error.message;
        emitMetrics({ environment:this.environment,release:this.release,metrics:{ PayloadPurgeFailureCount:1 } });
      });
    }, 60000);
    try {
      await this.emitOperationalMetrics().catch((error) => { this.lastError = error.message; });
      while (!this.stopped) {
        this.processing = await this.control();
        await this.heartbeat();
        if (!this.processing) { await this.sleep(1000); continue; }
        if (!await this.processOne()) await this.sleep(Number(this.env.RESEND_WEBHOOK_IDLE_MS || 750));
      }
    } finally {
      clearInterval(timer);
      clearInterval(maintenance);
      this.processing = false;
      await this.heartbeat().catch(() => {});
    }
  }

  stop() { this.stopped = true; }
}

async function main() {
  require('./email').validateProdSecondaryResendConfig(process.env);
  const pool = createPool();
  const provider = process.env.RESEND_API_KEY || process.env.RESEND_KEY
    ? new ResendProvider({ apiKey:process.env.RESEND_API_KEY || process.env.RESEND_KEY })
    : null;
  const worker = new WebhookWorker({ pool,provider });
  const stop = () => worker.stop();
  process.on('SIGTERM',stop);
  process.on('SIGINT',stop);
  try { await worker.run(); } finally { await pool.end(); }
}
if (require.main === module) main().catch((error) => { console.error('Webhook worker failed:',bounded(error.message)); process.exit(1); });

module.exports = {
  ACCEPTANCE_EVENTS,
  createPool,
  EMAIL_EVENTS,
  PROVIDER_COLUMNS,
  SUPPRESSION_REASONS,
  TERMINAL_EVENT_STATES,
  WebhookWorker,
  canaryAddress,
  canaryTags,
  effectiveProviderOutcome,
  eventPayload,
  normalizeAddress,
  shouldApplySuppressionEvent,
  validateKnownEvent,
  validAddress,
};
