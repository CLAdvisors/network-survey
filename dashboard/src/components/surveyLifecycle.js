export const surveyId = (survey) => survey?.id || survey?.surveyId || survey?.name;

export const lifecycleStatus = (survey) =>
  String(survey?.lifecycleStatus || survey?.lifecycle_status || 'draft').toLowerCase();

export const lifecycleLabel = (status) => ({
  draft: 'Draft',
  active: 'Active',
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
