'use strict';

const crypto = require('crypto');

const DEFAULT_SENDER = 'CLA Survey <survey@cladvisors.com>';
const RENDERER_VERSION = 'survey-invitation-v2';

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

function renderInvitation({ bodyText, link, language = 'en' }) {
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

function buildInvitationPayload({ to, sender = DEFAULT_SENDER, subject = 'CLA Network Survey', bodyText, surveyBaseUrl, surveyName, token, language, deliveryId, environment }) {
  const link = buildSurveyLink(surveyBaseUrl, surveyName, token);
  const rendered = renderInvitation({ bodyText, link, language });
  const payload = { from: sender, to, subject, html: rendered.html, text: rendered.text };
  if (deliveryId && environment) {
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
    } catch (error) {
      const cause = error?.cause;
      const detail = [error?.message, cause?.message, cause?.code].filter(Boolean).join(' ');
      // fetch rejections cannot prove whether bytes crossed the provider boundary.
      throw new ProviderError(error?.name === 'AbortError' ? 'Provider request timed out' : detail || 'Provider network request failed', {
        code: error?.name === 'AbortError' ? 'timeout' : String(cause?.code || 'network_error').toLowerCase(),
        uncertain: true,
      });
    } finally {
      clearTimeout(timeout);
    }

    let result = {};
    try { result = await response.json(); } catch { /* sanitized generic error below */ }
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

async function reserveProviderRateInTransaction(client, environment, rate) {
  await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, [`email-rate-budget:${environment}`]);
  await client.query(`DELETE FROM email_rate_reservations WHERE environment=$1 AND reserved_at<clock_timestamp()-interval '10 minutes'`, [environment]);
  const used = await client.query(`SELECT count(*)::int AS count FROM email_rate_reservations WHERE environment=$1 AND reserved_at>clock_timestamp()-interval '1 second'`, [environment]);
  if (Number(used.rows[0]?.count || 0) >= rate) return false;
  await client.query(`INSERT INTO email_rate_reservations(environment,reserved_at) VALUES($1,clock_timestamp())`, [environment]);
  return true;
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

function classifyProviderError(error) {
  const status = Number(error?.status || 0);
  if (error?.uncertain || error?.code === 'concurrent_idempotent_requests' || status >= 500) return 'ambiguous';
  if (/quota|plan_limit/i.test(String(error?.code || ''))) return 'quota';
  if (status === 429 || ['network_error', 'timeout'].includes(error?.code)) return 'transient';
  return 'permanent';
}

module.exports = { DEFAULT_SENDER, RENDERER_VERSION, escapeHtml, normalizeTemplateText, documentLanguage, buildSurveyLink, renderInvitation, buildInvitationPayload, payloadHash, ResendProvider, ProviderError, classifyProviderError, sanitizeProviderMessage, reserveProviderRate, reserveProviderRateOnClient, reserveProviderRateInTransaction };
