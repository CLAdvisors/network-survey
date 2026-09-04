'use strict';

const crypto = require('crypto');

const DEFAULT_SENDER = 'CLA Survey <survey@cladvisors.com>';
const PROD_SECONDARY_SCOPE = 'network-survey-resend-prod-secondary';
const PROD_SECONDARY_SENDER = 'CLA Survey <survey@cladvisorsurveys.com>';
const PROD_SECONDARY_REPLY_TO = 'survey@cladvisors.com';

function isProdSecondary(env = process.env) {
  return String(env.EMAIL_WORKER_ENV || '').trim() === 'prod-secondary';
}

function synchronousEmailIdentity(env = process.env) {
  return isProdSecondary(env)
    ? { sender:PROD_SECONDARY_SENDER, replyTo:PROD_SECONDARY_REPLY_TO }
    : { sender:DEFAULT_SENDER, replyTo:null };
}

function validateProdSecondaryResendConfig(env = process.env) {
  if (!isProdSecondary(env)) return;
  if (env.RESEND_KEY) throw new Error('prod-secondary must not use the legacy RESEND_KEY');
  if (env.RESEND_PROVIDER_ACCOUNT_SCOPE !== PROD_SECONDARY_SCOPE) throw new Error(`prod-secondary RESEND_PROVIDER_ACCOUNT_SCOPE must be ${PROD_SECONDARY_SCOPE}`);
  if (env.SURVEY_EMAIL_SENDER !== PROD_SECONDARY_SENDER) throw new Error(`prod-secondary SURVEY_EMAIL_SENDER must be ${PROD_SECONDARY_SENDER}`);
  if (env.SURVEY_EMAIL_REPLY_TO !== PROD_SECONDARY_REPLY_TO) throw new Error(`prod-secondary SURVEY_EMAIL_REPLY_TO must be ${PROD_SECONDARY_REPLY_TO}`);
  if (!['true','false'].includes(env.RESEND_CREDENTIAL_LOAD_ENABLED)) throw new Error('prod-secondary RESEND_CREDENTIAL_LOAD_ENABLED must be exactly true or false');
  if (!['true','false'].includes(env.RESEND_WEBHOOK_INGEST_ENABLED)) throw new Error('prod-secondary RESEND_WEBHOOK_INGEST_ENABLED must be exactly true or false');
  if (env.RESEND_CREDENTIAL_LOAD_ENABLED === 'true' && !env.RESEND_API_KEY) throw new Error('prod-secondary Resend credential loading is enabled but RESEND_API_KEY is unavailable');
  if (env.RESEND_CREDENTIAL_LOAD_ENABLED === 'false' && (env.RESEND_API_KEY || env.RESEND_KEY)) throw new Error('prod-secondary Resend credential is present while loading is disabled');
  if (env.RESEND_WEBHOOK_INGEST_ENABLED === 'true' && !env.RESEND_WEBHOOK_SECRET) throw new Error('prod-secondary webhook ingestion is enabled but its secret is unavailable');
  if (env.RESEND_WEBHOOK_INGEST_ENABLED === 'false' && (env.RESEND_WEBHOOK_SECRET || env.RESEND_WEBHOOK_PREVIOUS_SECRET)) throw new Error('prod-secondary webhook secret is present while ingestion is disabled');
}
const LEGACY_RENDERER_VERSION = 'survey-invitation-v1';
const TAGGED_RENDERER_VERSION = 'survey-invitation-v2';
const RENDERER_VERSION = 'survey-invitation-v3';

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]);
}

function normalizeTemplateText(value) {
  return String(value ?? '').replace(/\r\n?/g, '\n').trim();
}

function buildSurveyLink(baseUrl, surveyName, token) {
  if (!baseUrl) throw new Error('Survey base URL is required');
  const url = new URL(baseUrl);
  url.searchParams.set('surveyName', surveyName);
  url.searchParams.set('userId', token);
  return url.toString();
}

function documentLanguage(language) {
  const normalized = String(language || 'en').trim().toLowerCase();
  const codes = {
    english: 'en', spanish: 'es', french: 'fr', german: 'de', italian: 'it',
    portuguese: 'pt', dutch: 'nl', polish: 'pl', russian: 'ru', japanese: 'ja',
    chinese: 'zh', korean: 'ko',
  };
  return codes[normalized] || (/^[a-z]{2}(?:-[a-z0-9]{2,8})*$/i.test(normalized) ? normalized : 'en');
}

function buildPrivacyPolicyUrl(surveyBaseUrl) {
  if (!surveyBaseUrl) throw new Error('Survey base URL is required');
  let url;
  try { url = new URL(surveyBaseUrl); }
  catch { throw new Error('Survey base URL must be a valid HTTP(S) URL'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error('Survey base URL must be an HTTP(S) URL without credentials, query parameters, or fragments');
  }
  return new URL('/privacy-policy.html', url).toString();
}

function renderLegacyInvitation({ bodyText, link, language = 'en' }) {
  const normalized = normalizeTemplateText(bodyText);
  const lang = documentLanguage(language);
  const paragraphs = normalized.split(/\n{2,}/).map((paragraph) =>
    `<p style="font-size:16px;line-height:24px;color:#334155">${escapeHtml(paragraph).replace(/\n/g, '<br>')}</p>`
  ).join('');
  const safeLink = escapeHtml(link);
  const html = `<!doctype html><html lang="${escapeHtml(lang)}"><head><meta charset="utf-8"><title>CLA Network Survey</title></head><body style="background:#f6f9fc;font-family:Arial,sans-serif"><main style="max-width:600px;margin:auto;background:#fff;padding:32px"><img src="https://i.postimg.cc/4nkbg08K/logo.png" width="189" height="49" alt="Contemporary Leadership Advisors"><h1 style="font-size:22px">CLA Network Survey</h1>${paragraphs}<p><a href="${safeLink}" style="background:#147d78;color:#fff;padding:12px 18px;text-decoration:none;border-radius:5px;display:inline-block">Open your CLA Network Survey</a></p><p style="font-size:14px;color:#475569">This invitation link is unique to you. Please do not forward it.</p><p style="font-size:14px;color:#475569">For privacy questions or help, contact your survey administrator or <a href="mailto:survey@cladvisors.com">survey@cladvisors.com</a>.</p><p>— The CLA team</p><hr><p style="font-size:12px;color:#64748b">Contemporary Leadership Advisors, 299 Park Ave, New York, NY 10171</p></main></body></html>`;
  const text = `CLA Network Survey\n\n${normalized}\n\nOpen your CLA Network Survey:\n${link}\n\nThis invitation link is unique to you. Please do not forward it.\n\nFor privacy questions or help, contact your survey administrator or survey@cladvisors.com.\n\n— The CLA team\nContemporary Leadership Advisors, 299 Park Ave, New York, NY 10171`;
  return { html, text };
}

const PRIVACY_PARAGRAPHS = [
  'This survey is confidential, but not anonymous. Contemporary Leadership Advisors (CLA) can associate your responses with your identity in order to administer the survey, conduct analysis, and perform research. Your individual survey responses will not be shared with your employer.',
  'Survey results are generally reported in groups of at least five respondents. Certain analyses, particularly Organizational Network Analysis (ONA), may identify individuals when doing so is an intended part of the analysis—for example, identifying key organizational connectors—but CLA will not disclose how an identifiable individual responded or who nominated them.',
  'Open-ended comments are not attributed to individual respondents. However, what you write may sometimes reveal your identity, so please avoid including your name or unnecessary identifying information if you wish to protect your confidentiality.',
  'CLA may use de-identified survey data for research, benchmarking, and to improve our assessments and methodologies. Identifiable survey data is generally retained for up to three years, and you may request deletion of your personal information, subject to applicable legal and other permitted exceptions.',
];

function renderPrivacyInvitation({ bodyText, link, language = 'en', privacyPolicyUrl }) {
  const legacy = renderLegacyInvitation({ bodyText, link, language });
  const privacyHtml = `<section aria-labelledby="privacy-heading"><h2 id="privacy-heading" style="font-size:20px;line-height:28px;color:#1e293b">Your Privacy</h2>${PRIVACY_PARAGRAPHS.map((paragraph) => `<p style="font-size:16px;line-height:24px;color:#334155">${escapeHtml(paragraph)}</p>`).join('')}<p style="font-size:16px;line-height:24px;color:#334155">For more information, review our <a href="${escapeHtml(privacyPolicyUrl)}">Employee Survey Platform Privacy Policy</a>.</p></section>`;
  const html = legacy.html.replace('<p>— The CLA team</p>', `${privacyHtml}<p>— The CLA team</p>`);
  const text = legacy.text.replace('\n\n— The CLA team', `\n\nYour Privacy\n\n${PRIVACY_PARAGRAPHS.join('\n\n')}\n\nEmployee Survey Platform Privacy Policy: ${privacyPolicyUrl}\n\n— The CLA team`);
  return { html, text };
}

function renderInvitation({ bodyText, link, language = 'en', rendererVersion = RENDERER_VERSION, privacyPolicyUrl }) {
  if ([LEGACY_RENDERER_VERSION, TAGGED_RENDERER_VERSION].includes(rendererVersion)) {
    return renderLegacyInvitation({ bodyText, link, language });
  }
  if (rendererVersion === RENDERER_VERSION) {
    const policyUrl = privacyPolicyUrl || new URL('/privacy-policy.html', link).toString();
    return renderPrivacyInvitation({ bodyText, link, language, privacyPolicyUrl: policyUrl });
  }
  throw new Error(`Unsupported invitation renderer version: ${rendererVersion}`);
}

function buildInvitationPayload({ to, sender = DEFAULT_SENDER, subject = 'CLA Network Survey', bodyText, surveyBaseUrl, surveyName, token, language, deliveryId, environment, rendererVersion = RENDERER_VERSION }) {
  const link = buildSurveyLink(surveyBaseUrl, surveyName, token);
  const privacyPolicyUrl = rendererVersion === RENDERER_VERSION ? buildPrivacyPolicyUrl(surveyBaseUrl) : undefined;
  const rendered = renderInvitation({ bodyText, link, language, rendererVersion, privacyPolicyUrl });
  const payload = { from: sender, to, subject, html: rendered.html, text: rendered.text };
  if ([TAGGED_RENDERER_VERSION, RENDERER_VERSION].includes(rendererVersion) && deliveryId && environment) {
    payload.tags = [
      { name: 'app', value: 'network_survey' },
      { name: 'environment', value: String(environment).replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 256) },
      { name: 'delivery_id', value: String(deliveryId) },
    ];
  }
  return payload;
}

function payloadHash(payload) {
  return crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

function sanitizeProviderMessage(value) {
  return String(value || 'Email provider request failed').replace(/[\r\n\t]+/g, ' ').slice(0, 500);
}

class ProviderError extends Error {
  constructor(message, { code = 'provider_error', status, retryAfter, uncertain = false } = {}) {
    super(sanitizeProviderMessage(message));
    this.name = 'ProviderError';
    this.code = String(code).slice(0, 100);
    this.status = status;
    this.retryAfter = retryAfter;
    this.uncertain = uncertain;
  }
}

class ResendProvider {
  constructor({ apiKey, fetchImpl = global.fetch, endpoint = 'https://api.resend.com/emails', timeoutMs = 15000 } = {}) {
    if (!apiKey) throw new Error('Resend API key is required');
    if (!fetchImpl) throw new Error('A fetch implementation is required');
    this.apiKey = apiKey;
    this.fetchImpl = fetchImpl;
    this.endpoint = endpoint;
    this.timeoutMs = timeoutMs;
  }

  async send(payload, { idempotencyKey, timeoutMs = this.timeoutMs } = {}) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    let response;
    let result = {};
    try {
      response = await this.fetchImpl(this.endpoint, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
          'Idempotency-Key': idempotencyKey,
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      // Keep the same deadline armed through body consumption. A provider can
      // accept an idempotent request and then stall before returning its ID.
      result = await response.json();
    } catch (error) {
      const cause = error?.cause;
      const detail = [error?.message, cause?.message, cause?.code].filter(Boolean).join(' ');
      // Once a non-2xx status is known, retain its definitive HTTP and
      // Retry-After semantics even if its body stalls until the deadline.
      if (response && !response.ok) {
        throw new ProviderError(`Provider returned HTTP ${response.status}`, {
          code: `http_${response.status}`,
          status: response.status,
          retryAfter: response.headers?.get?.('retry-after') || null,
        });
      }
      if (error?.name === 'AbortError') {
        throw new ProviderError('Provider request timed out', { code:'timeout', uncertain:true });
      }
      throw new ProviderError(detail || 'Provider network or response-body failure', {
        code: String(cause?.code || (response ? 'invalid_response_body' : 'network_error')).toLowerCase(),
        uncertain: true,
      });
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok || result?.error) {
      const providerError = result?.error || result;
      throw new ProviderError(providerError?.message || `Provider returned HTTP ${response.status}`, {
        code: providerError?.name || providerError?.code || `http_${response.status}`,
        status: response.status,
        retryAfter: response.headers?.get?.('retry-after') || null,
      });
    }
    if (!result?.id) throw new ProviderError('Provider response did not include a message ID', { code: 'missing_provider_id', uncertain: true });
    return { id: result.id };
  }
}

async function reserveProviderRateWithAvailabilityInTransaction(client, environment, rate) {
  const capacity = Math.max(1, Math.ceil(Number(rate) || 1));
  await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, [`email-rate-budget:${environment}`]);
  await client.query(`DELETE FROM email_rate_reservations WHERE environment=$1 AND reserved_at<clock_timestamp()-interval '10 minutes'`, [environment]);
  await client.query(`UPDATE email_rate_reservations SET reserved_at=clock_timestamp() WHERE environment=$1 AND reserved_at>clock_timestamp()`, [environment]);
  const used = await client.query(`SELECT count(*)::int AS count,(array_agg(reserved_at ORDER BY reserved_at))[GREATEST(count(*)::int-$2+1,1)]+interval '1 second' AS next_available_at,clock_timestamp() AS observed_at FROM email_rate_reservations WHERE environment=$1 AND reserved_at>clock_timestamp()-interval '1 second'`, [environment, capacity]);
  if (Number(used.rows[0]?.count || 0) >= capacity) {
    const retryAfterMs = Math.max(0, new Date(used.rows[0].next_available_at).getTime() - new Date(used.rows[0].observed_at).getTime());
    return { reserved: false, nextAvailableAt: used.rows[0].next_available_at, retryAfterMs };
  }
  await client.query(`INSERT INTO email_rate_reservations(environment,reserved_at) VALUES($1,clock_timestamp())`, [environment]);
  return { reserved: true, nextAvailableAt: null, retryAfterMs: 0 };
}

async function reserveProviderRateInTransaction(client, environment, rate) {
  return (await reserveProviderRateWithAvailabilityInTransaction(client, environment, rate)).reserved;
}

async function reserveProviderRateOnClient(client, environment, rate) {
  try {
    await client.query('BEGIN');
    const reserved=await reserveProviderRateInTransaction(client,environment,rate);
    await client.query('COMMIT');
    return reserved;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  }
}

async function reserveProviderRate(pool, environment, rate) {
  const client = await pool.connect();
  try { return await reserveProviderRateOnClient(client, environment, rate); }
  finally { client.release(); }
}

async function unlockAdvisoryLocksAndRelease(client, keys) {
  let unlockError = null;
  for (const key of keys) {
    if (!key) continue;
    try { await client.query(`SELECT pg_advisory_unlock(hashtextextended($1,0))`, [key]); }
    catch (error) { unlockError = unlockError || error; }
  }
  client.release(unlockError || undefined);
}

function classifyProviderError(error) {
  const status = Number(error?.status || 0);
  if (error?.uncertain || error?.code === 'concurrent_idempotent_requests' || status >= 500) return 'ambiguous';
  if (/quota|plan_limit/i.test(String(error?.code || ''))) return 'quota';
  if (status === 429 || ['network_error', 'timeout'].includes(error?.code)) return 'transient';
  return 'permanent';
}

module.exports = { DEFAULT_SENDER, PROD_SECONDARY_SCOPE, PROD_SECONDARY_SENDER, PROD_SECONDARY_REPLY_TO, synchronousEmailIdentity, validateProdSecondaryResendConfig, LEGACY_RENDERER_VERSION, TAGGED_RENDERER_VERSION, RENDERER_VERSION, escapeHtml, normalizeTemplateText, documentLanguage, buildSurveyLink, buildPrivacyPolicyUrl, renderInvitation, buildInvitationPayload, payloadHash, ResendProvider, ProviderError, classifyProviderError, sanitizeProviderMessage, reserveProviderRate, reserveProviderRateOnClient, reserveProviderRateInTransaction, reserveProviderRateWithAvailabilityInTransaction, unlockAdvisoryLocksAndRelease };
