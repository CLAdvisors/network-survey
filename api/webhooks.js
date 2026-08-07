'use strict';

const { Resend } = require('resend');
const { emitMetrics } = require('./email-metrics');

const MAX_WEBHOOK_BYTES = 256 * 1024;
const RAW_PAYLOAD_RETENTION_DAYS = 30;
const MAX_EVENT_TYPE_LENGTH = 128;
const MAX_PROVIDER_ID_LENGTH = 255;
const MAX_TAG_LENGTH = 256;
const SELECTED_EVENT_TYPES = new Set([
  'email.sent',
  'email.delivered',
  'email.delivery_delayed',
  'email.bounced',
  'email.complained',
  'email.failed',
  'email.suppressed',
  'suppression.added',
  'suppression.removed',
]);

class WebhookError extends Error {
  constructor(code, status, message = code) {
    super(message);
    this.name = 'WebhookError';
    this.code = code;
    this.status = status;
  }
}

function exactTrue(value) {
  return value === true || value === 'true';
}

function headerValue(headers, name) {
  const value = headers?.[name] ?? headers?.[name.toLowerCase()] ?? headers?.[name.toUpperCase()];
  return Array.isArray(value) ? value[0] : value;
}

function signatureHeaders(headers) {
  const values = {
    id: headerValue(headers, 'svix-id'),
    timestamp: headerValue(headers, 'svix-timestamp'),
    signature: headerValue(headers, 'svix-signature'),
  };
  for (const [name, value] of Object.entries(values)) {
    if (typeof value !== 'string' || value.length === 0 || value.length > 2048) {
      throw new WebhookError(`invalid_${name}_header`, 400, 'Invalid webhook signature headers');
    }
  }
  if (values.id.length > MAX_PROVIDER_ID_LENGTH) {
    throw new WebhookError('invalid_event_id', 400, 'Invalid webhook event ID');
  }
  return values;
}

function rawPayload(rawBody, maxBytes = MAX_WEBHOOK_BYTES) {
  if (!Buffer.isBuffer(rawBody)) throw new WebhookError('raw_body_required', 400, 'Raw webhook body required');
  if (rawBody.length > maxBytes) throw new WebhookError('payload_too_large', 413, 'Webhook payload too large');
  if (rawBody.length === 0) throw new WebhookError('empty_payload', 400, 'Webhook payload required');
  return rawBody;
}

function boundedString(value, max) {
  return typeof value === 'string' && value.length > 0 && value.length <= max ? value : null;
}

function extractMetadata(event) {
  if (!event || typeof event !== 'object' || Array.isArray(event)) {
    throw new WebhookError('invalid_payload', 400, 'Invalid webhook payload');
  }
  const eventType = boundedString(event.type, MAX_EVENT_TYPE_LENGTH);
  if (!eventType) throw new WebhookError('invalid_event_type', 400, 'Invalid webhook event type');
  const eventTime = new Date(event.created_at);
  if (typeof event.created_at !== 'string' || !Number.isFinite(eventTime.getTime())) {
    throw new WebhookError('invalid_event_time', 400, 'Invalid webhook event time');
  }
  const data = event.data && typeof event.data === 'object' && !Array.isArray(event.data) ? event.data : {};
  const providerMessageId = boundedString(data.email_id, MAX_PROVIDER_ID_LENGTH);
  const tags = data.tags && typeof data.tags === 'object' && !Array.isArray(data.tags) ? data.tags : {};
  const deliveryTag = boundedString(tags.delivery_id, MAX_TAG_LENGTH);
  return {
    eventType,
    eventTime: eventTime.toISOString(),
    providerMessageId,
    deliveryTag,
    appTag: boundedString(tags.app, MAX_TAG_LENGTH),
    environmentTag: boundedString(tags.environment, MAX_TAG_LENGTH),
  };
}

/** Verify exact payload bytes through the public Resend SDK API. */
function verifyResendWebhook({ rawBody, headers, primarySecret, previousSecret, resend } = {}) {
  const body = rawPayload(rawBody);
  const verifiedHeaders = signatureHeaders(headers);
  if (!primarySecret) throw new WebhookError('webhook_secret_unavailable', 503, 'Webhook verifier unavailable');
  // The SDK constructor requires a non-empty API key even though webhook verification performs no API call.
  const sdk = resend || new Resend('webhook-verification-only');
  const verify = (secret) => sdk.webhooks.verify({
    payload: body.toString('utf8'),
    headers: verifiedHeaders,
    webhookSecret: secret,
  });
  try {
    return { event: verify(primarySecret), verifiedWithPrevious: false };
  } catch (primaryError) {
    if (previousSecret) {
      try {
        return { event: verify(previousSecret), verifiedWithPrevious: true };
      } catch { /* report one bounded result below */ }
    }
    throw new WebhookError('invalid_signature', 400, 'Invalid webhook signature');
  }
}

class ResendWebhookIngress {
  constructor({ pool, env = process.env, resend, clock = () => new Date(), maxBytes = MAX_WEBHOOK_BYTES } = {}) {
    if (!pool) throw new Error('Webhook ingress pool is required');
    this.pool = pool;
    this.env = env;
    this.resend = resend;
    this.clock = clock;
    this.maxBytes = maxBytes;
    this.retentionDays = Math.max(1, Math.min(365, Number(env.WEBHOOK_PAYLOAD_RETENTION_DAYS || RAW_PAYLOAD_RETENTION_DAYS)));
    this.environment = String(env.EMAIL_WORKER_ENV || env.APP_ENV || env.NODE_ENV || 'local');
    this.providerAccountScope = String(env.RESEND_PROVIDER_ACCOUNT_SCOPE || '');
    if (!this.environment || this.environment !== this.environment.trim() || this.environment.length > 64) {
      throw new Error('Receiving environment must be 1-64 trimmed characters');
    }
    if (this.providerAccountScope && (this.providerAccountScope !== this.providerAccountScope.trim() || this.providerAccountScope.length > 128)) {
      throw new Error('Provider account scope must be at most 128 trimmed characters');
    }
  }

  enabled() {
    return exactTrue(this.env.RESEND_WEBHOOK_INGEST_ENABLED);
  }

  async ingest(rawBody, headers) {
    if (!this.enabled()) throw new WebhookError('ingest_disabled', 503, 'Webhook ingestion disabled');
    rawPayload(rawBody, this.maxBytes);
    if (!this.providerAccountScope) throw new WebhookError('provider_scope_unavailable', 503, 'Webhook ingress unavailable');

    const verified = verifyResendWebhook({
      rawBody,
      headers,
      primarySecret: this.env.RESEND_WEBHOOK_SECRET,
      previousSecret: this.env.RESEND_WEBHOOK_PREVIOUS_SECRET,
      resend: this.resend,
    });
    const metadata = extractMetadata(verified.event);
    const svixId = signatureHeaders(headers).id;
    const receivedAt = this.clock();
    const expiresAt = new Date(receivedAt.getTime() + this.retentionDays * 86400000);

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const inserted = await client.query(
        `INSERT INTO email_webhook_events
          (provider_account_scope,receiving_environment,svix_id,event_type,event_created_at,
           provider_message_id,delivery_tag,app_tag,environment_tag,raw_payload,payload_size_bytes,
           received_at,payload_expires_at,status,next_attempt_at)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12,$13,'pending',$12)
         ON CONFLICT(provider_account_scope,svix_id) DO NOTHING
         RETURNING id`,
        [this.providerAccountScope, this.environment, svixId, metadata.eventType, metadata.eventTime,
          metadata.providerMessageId, metadata.deliveryTag, metadata.appTag, metadata.environmentTag,
          rawBody.toString('utf8'), rawBody.length, receivedAt, expiresAt]
      );
      await client.query('COMMIT');
      return {
        accepted: true,
        duplicate: inserted.rowCount === 0,
        selected: SELECTED_EVENT_TYPES.has(metadata.eventType),
        verifiedWithPrevious: verified.verifiedWithPrevious,
      };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw new WebhookError('database_unavailable', 503, 'Webhook could not be stored');
    } finally {
      client.release();
    }
  }
}

function createResendWebhookHandler(options) {
  const ingress = options instanceof ResendWebhookIngress ? options : new ResendWebhookIngress(options);
  return async function resendWebhookHandler(req, res) {
    try {
      const result = await ingress.ingest(req.body, req.headers);
      res.status(200).json({ received: true, duplicate: result.duplicate });
    } catch (error) {
      const status = error instanceof WebhookError ? error.status : 503;
      if (error?.code === 'invalid_signature' || /^invalid_(id|timestamp|signature)_header$/.test(error?.code || '')) {
        emitMetrics({ environment:ingress.environment, release:ingress.env.RELEASE_REVISION, metrics:{ InvalidSignatureCount:1 } });
      }
      res.status(status).json({ error: status === 400 ? 'invalid_webhook' : status === 413 ? 'payload_too_large' : 'webhook_unavailable' });
    }
  };
}

module.exports = {
  MAX_WEBHOOK_BYTES,
  RAW_PAYLOAD_RETENTION_DAYS,
  SELECTED_EVENT_TYPES,
  WebhookError,
  ResendWebhookIngress,
  createResendWebhookHandler,
  exactTrue,
  extractMetadata,
  signatureHeaders,
  verifyResendWebhook,
};
