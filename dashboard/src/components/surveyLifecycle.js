export const surveyId = (survey) => survey?.id || survey?.surveyId || survey?.name;

export const lifecycleStatus = (survey) =>
  String(survey?.lifecycleStatus || survey?.lifecycle_status || 'draft').toLowerCase();

export const lifecycleLabel = (status) => ({
  draft: 'Draft',
  active: 'Launched',
  closed: 'Closed',
}[String(status || '').toLowerCase()] || 'Draft');

export const capability = (survey, name, fallback = false) => {
  const capabilities = survey?.capabilities || {};
  if (typeof capabilities[name] === 'boolean') return capabilities[name];
  return fallback;
};

export const launchCounts = (launch) => {
  const source = launch?.counts || launch?.dispatchCounts || launch?.dispatch_counts || launch || {};
  const number = (...keys) => {
    const value = keys.map((key) => source?.[key]).find((item) => item !== undefined);
    const parsed = Number(value || 0);
    return Number.isFinite(parsed) ? parsed : 0;
  };
  return {
    target: number('target', 'targetCount', 'target_count', 'total'),
    pending: number('pending', 'pendingCount', 'pending_count'),
    leased: number('leased', 'leasedCount', 'leased_count', 'sending'),
    retryWait: number('retryWait', 'retry_wait', 'retryWaitCount', 'retry_wait_count', 'retrying'),
    accepted: number('accepted', 'acceptedCount', 'accepted_count'),
    failed: number('failed', 'failedCount', 'failed_count'),
    uncertain: number('uncertain', 'uncertainCount', 'uncertain_count'),
    cancelled: number('cancelled', 'cancelledCount', 'cancelled_count'),
  };
};

const finiteCount = (value) => {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
};

const firstValue = (source, keys) => keys.map((key) => source?.[key]).find((value) => value !== undefined && value !== null);

export const providerCounts = (launch) => {
  const nested = launch?.providerOutcomeCounts || launch?.provider_outcome_counts
    || launch?.providerCounts || launch?.provider_counts || launch?.providerOutcomes || launch?.provider_outcomes;
  const sources = [nested, launch?.counts, launch?.dispatchCounts, launch?.dispatch_counts, launch].filter(Boolean);
  const aliases = {
    sent: ['sent', 'sentCount', 'sent_count', 'providerSent', 'provider_sent', 'providerSentCount', 'provider_sent_count'],
    delivered: ['delivered', 'deliveredCount', 'delivered_count', 'providerDelivered', 'provider_delivered', 'providerDeliveredCount', 'provider_delivered_count'],
    delayed: ['delayed', 'delayedCount', 'delayed_count', 'providerDelayed', 'provider_delayed', 'providerDelayedCount', 'provider_delayed_count'],
    bounced: ['bounced', 'bouncedCount', 'bounced_count', 'providerBounced', 'provider_bounced', 'providerBouncedCount', 'provider_bounced_count'],
    complained: ['complained', 'complainedCount', 'complained_count', 'providerComplained', 'provider_complained', 'providerComplainedCount', 'provider_complained_count'],
    suppressed: ['suppressed', 'suppressedCount', 'suppressed_count', 'providerSuppressed', 'provider_suppressed', 'providerSuppressedCount', 'provider_suppressed_count'],
    providerFailed: ['providerFailed', 'provider_failed', 'providerFailedCount', 'provider_failed_count', 'failedProvider', 'failed_provider'],
    problems: ['problems', 'problemCount', 'problem_count', 'providerProblem', 'provider_problem', 'providerProblemCount', 'provider_problem_count'],
    waiting: ['waiting', 'waitingCount', 'waiting_count', 'providerWaiting', 'provider_waiting', 'providerWaitingCount', 'provider_waiting_count'],
    acceptedUnverified: ['acceptedUnverified', 'accepted_unverified', 'acceptedUnverifiedCount', 'accepted_unverified_count', 'unverifiedAccepted', 'unverified_accepted', 'unverifiedAcceptedCount', 'unverified_accepted_count'],
  };
  const raw = (keys) => sources.map((source) => firstValue(source, keys)).find((value) => value !== undefined && value !== null);
  const hasProviderData = Boolean(nested) || Object.values(aliases).flat().some((key) => sources.some((source) => source?.[key] !== undefined && source?.[key] !== null));
  const acceptedUnverified = raw(aliases.acceptedUnverified);
  const nestedFailed = nested && firstValue(nested, ['failed', 'failedCount', 'failed_count']);
  const bounced = finiteCount(raw(aliases.bounced));
  const complained = finiteCount(raw(aliases.complained));
  const suppressed = finiteCount(raw(aliases.suppressed));
  const providerFailed = finiteCount(nestedFailed ?? raw(aliases.providerFailed));
  const acceptedFallback = launchCounts(launch).accepted;

  return {
    sent: finiteCount(raw(aliases.sent)),
    delivered: finiteCount(raw(aliases.delivered)),
    delayed: finiteCount(raw(aliases.delayed)),
    bounced,
    complained,
    suppressed,
    providerFailed,
    problems: raw(aliases.problems) === undefined ? bounced + complained + suppressed + providerFailed : finiteCount(raw(aliases.problems)),
    waiting: raw(aliases.waiting) === undefined
      ? (acceptedUnverified === undefined ? (hasProviderData ? 0 : acceptedFallback) : finiteCount(acceptedUnverified))
      : finiteCount(raw(aliases.waiting)),
    acceptedUnverified: acceptedUnverified === undefined
      ? (hasProviderData ? 0 : acceptedFallback)
      : finiteCount(acceptedUnverified),
  };
};

const timestampAliases = {
  sent: ['sentAt', 'sent_at', 'providerSentAt', 'provider_sent_at'],
  delivered: ['deliveredAt', 'delivered_at', 'providerDeliveredAt', 'provider_delivered_at'],
  delayed: ['delayedAt', 'delayed_at', 'providerDelayedAt', 'provider_delayed_at'],
  bounced: ['bouncedAt', 'bounced_at', 'providerBouncedAt', 'provider_bounced_at'],
  complained: ['complainedAt', 'complained_at', 'providerComplainedAt', 'provider_complained_at'],
  suppressed: ['suppressedAt', 'suppressed_at', 'providerSuppressedAt', 'provider_suppressed_at'],
  providerFailed: ['providerFailedAt', 'provider_failed_at', 'failedAt', 'failed_at'],
};

export const providerTimestamps = (delivery) => {
  const nested = delivery?.providerTimestamps || delivery?.provider_timestamps
    || delivery?.providerOutcomeTimestamps || delivery?.provider_outcome_timestamps || {};
  const sources = [nested, delivery || {}];
  return Object.fromEntries(Object.entries(timestampAliases).map(([outcome, keys]) => [
    outcome,
    sources.map((source) => firstValue(source, keys)).find((value) => value !== undefined && value !== null) || null,
  ]));
};

const normalizeStatus = (value) => String(value || '').trim().toLowerCase().replace(/[\s-]+/g, '_');

export const providerOutcome = (delivery) => {
  const rawOutcome = delivery?.providerOutcome || delivery?.provider_outcome;
  const explicit = normalizeStatus(typeof rawOutcome === 'object'
    ? (rawOutcome?.outcome || rawOutcome?.status || rawOutcome?.effectiveOutcome || rawOutcome?.effective_outcome)
    : rawOutcome);
  const aliases = {
    complaint: 'complained', email_complained: 'complained', bounce: 'bounced', email_bounced: 'bounced',
    delivery_delayed: 'delayed', email_delivery_delayed: 'delayed', email_delivered: 'delivered',
    failed: 'provider_failed', provider_failure: 'provider_failed', email_failed: 'provider_failed',
    provider_suppressed: 'suppressed', email_suppressed: 'suppressed', sent: 'sent', email_sent: 'sent',
    accepted: 'accepted_unverified', legacy_assumed_accepted: 'accepted_unverified',
    none: 'none', not_queued: 'none', unverified: 'accepted_unverified',
  };
  if (explicit) return aliases[explicit] || explicit;

  const timestamps = providerTimestamps(delivery);
  const timestampOutcome = [
    ['complained', timestamps.complained], ['bounced', timestamps.bounced],
    ['suppressed', timestamps.suppressed], ['provider_failed', timestamps.providerFailed],
    ['delivered', timestamps.delivered], ['delayed', timestamps.delayed], ['sent', timestamps.sent],
  ].find(([, value]) => value)?.[0];
  if (timestampOutcome) return timestampOutcome;

  const dispatch = normalizeStatus(delivery?.dispatchStatus || delivery?.dispatch_status || delivery?.emailStatus || delivery?.email_status || delivery?.status);
  return ['accepted', 'legacy_assumed_accepted'].includes(dispatch) ? 'accepted_unverified' : 'none';
};

export const providerOutcomeLabel = (outcome) => ({
  complained: 'Complained', bounced: 'Bounced', suppressed: 'Suppressed',
  provider_failed: 'Provider failed', delivered: 'Delivered', delayed: 'Delayed',
  sent: 'Provider accepted', accepted_unverified: 'Accepted / unverified', none: 'No provider outcome',
}[normalizeStatus(outcome)] || String(outcome || 'No provider outcome').replaceAll('_', ' '));

export const providerOutcomeTimestamp = (delivery, outcome = providerOutcome(delivery)) => {
  const key = normalizeStatus(outcome) === 'provider_failed' ? 'providerFailed' : normalizeStatus(outcome);
  const rawOutcome = delivery?.providerOutcome || delivery?.provider_outcome;
  return providerTimestamps(delivery)[key]
    || (typeof rawOutcome === 'object' && (rawOutcome.occurredAt || rawOutcome.occurred_at || rawOutcome.timestamp))
    || delivery?.providerOutcomeAt || delivery?.provider_outcome_at || null;
};

export const launchStatus = (launch) => {
  const explicit = launch?.status || launch?.launchStatus;
  if (explicit) return String(explicit).toLowerCase();
  const counts = launchCounts(launch);
  if (counts.pending + counts.leased + counts.retryWait > 0) return 'processing';
  if (counts.target > 0 && counts.accepted + counts.failed + counts.uncertain + counts.cancelled >= counts.target) {
    return counts.failed + counts.uncertain + counts.cancelled > 0 ? 'completed_with_issues' : 'completed';
  }
  return 'queued';
};
export const isLaunchRunning = (launch) => ['queued', 'processing'].includes(launchStatus(launch));

export const PROVIDER_RECONCILIATION_HORIZON_MS = 7 * 24 * 60 * 60 * 1000;

export const shouldPollLaunch = (launch, now = Date.now()) => {
  if (!launch) return false;
  if (isLaunchRunning(launch)) return true;
  const value = launch.providerUpdatedAt || launch.provider_updated_at || launch.finishedAt
    || launch.finished_at || launch.updatedAt || launch.updated_at || launch.createdAt || launch.created_at;
  const occurredAt = new Date(value).getTime();
  return Number.isFinite(occurredAt) && occurredAt >= now - PROVIDER_RECONCILIATION_HORIZON_MS;
};

export const formatDateTime = (value) => {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString();
};

export const errorMessage = (error, fallback) => {
  const status = error?.response?.status;
  const detail = error?.response?.data?.message || error?.response?.data?.error;
  if (detail) return detail;
  if (status === 409) return 'This survey was already launched or changed by another user. Refresh and try again.';
  if (status === 422) return 'The survey is not ready to launch. Review the blockers below.';
  if (status === 429) return 'Launch requests are temporarily limited. Keep this dialog open and try again shortly.';
  if (status === 503) return 'Email delivery is currently unavailable. Keep this dialog open and try again later.';
  if (status >= 500) return 'The service could not accept the request. The same launch key will be reused when you retry.';
  return fallback;
};
