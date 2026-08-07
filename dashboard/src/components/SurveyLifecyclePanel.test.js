import React from 'react';
import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import api from '../api/axios';
import SurveyLifecyclePanel from './SurveyLifecyclePanel';
import {
  launchCounts, launchStatus, providerCounts, providerOutcome, providerOutcomeLabel,
  providerOutcomeTimestamp, providerTimestamps, shouldPollLaunch,
} from './surveyLifecycle';

vi.mock('../api/axios', () => ({ default: { get: vi.fn() } }));

beforeEach(() => api.get.mockReset());
afterEach(() => vi.useRealTimers());

const deferred = () => {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
};

test('normalizes the real snake_case launch aggregate contract', () => {
  expect(launchCounts({
    target_count: 5, pending_count: 1, leased_count: 1, retry_wait_count: 1,
    accepted_count: 1, failed_count: 0, uncertain_count: 1, cancelled_count: 0,
  })).toEqual({ target: 5, pending: 1, leased: 1, retryWait: 1, accepted: 1, failed: 0, uncertain: 1, cancelled: 0 });
  expect(launchStatus({ targetCount: 42, acceptedCount: 42 })).toBe('completed');
});

test('normalizes additive provider counts, timestamps, and old accepted deliveries', () => {
  expect(providerCounts({
    accepted_count: '5',
    provider_outcome_counts: {
      sent_count: '4', delivered_count: '2', delayed_count: 1, bounced_count: '1',
      complained_count: 1, suppressed_count: 0, provider_failed_count: '1', accepted_unverified_count: '1',
    },
  })).toEqual({
    sent: 4, delivered: 2, delayed: 1, bounced: 1, complained: 1,
    suppressed: 0, providerFailed: 1, acceptedUnverified: 1,
  });
  expect(providerCounts({ acceptedCount: 3 }).acceptedUnverified).toBe(3);

  const delivery = {
    dispatch_status: 'accepted',
    provider_timestamps: { delivered_at: '2026-01-02T03:04:05Z' },
    provider_complained_at: '2026-01-03T03:04:05Z',
  };
  expect(providerTimestamps(delivery)).toMatchObject({
    delivered: '2026-01-02T03:04:05Z', complained: '2026-01-03T03:04:05Z',
  });
  expect(providerOutcome(delivery)).toBe('complained');
  expect(providerOutcomeTimestamp(delivery)).toBe('2026-01-03T03:04:05Z');
  expect(providerOutcome({ emailStatus: 'legacy_assumed_accepted' })).toBe('accepted_unverified');
  expect(providerOutcomeLabel('accepted_unverified')).toBe('Accepted / unverified');
});

test('keeps terminal provider reconciliation polling bounded', () => {
  const now = Date.parse('2026-02-01T00:00:00Z');
  expect(shouldPollLaunch({ status: 'processing', created_at: '2020-01-01T00:00:00Z' }, now)).toBe(true);
  expect(shouldPollLaunch({ status: 'completed', created_at: '2026-01-31T00:00:00Z' }, now)).toBe(true);
  expect(shouldPollLaunch({ status: 'completed', created_at: '2026-01-01T00:00:00Z' }, now)).toBe(false);
});

test('renders provider outcomes separately without changing dispatch arithmetic', async () => {
  api.get.mockResolvedValue({ data: { launches: [{
    id: 'launch-1', status: 'completed', created_at: new Date().toISOString(),
    target_count: 3, accepted_count: 3,
    provider_outcome_counts: { delivered_count: 2, complained_count: 1, accepted_unverified_count: 1 },
  }] } });
  render(<SurveyLifecyclePanel survey={{ id: 'survey-1', name: 'First', lifecycleStatus: 'active' }} />);

  expect(await screen.findByRole('status')).toHaveTextContent('3 of 3 finished');
  const providerSummary = screen.getByRole('region', { name: 'Provider outcome summary' });
  expect(providerSummary).toHaveTextContent('2 delivered');
  expect(providerSummary).toHaveTextContent('1 complained');
  expect(providerSummary).toHaveTextContent('1 accepted / unverified');
  expect(providerSummary).not.toHaveTextContent('3 delivered');
});

test('does not render prior survey history while the next survey is loading', async () => {
  const second = deferred();
  api.get
    .mockResolvedValueOnce({ data: { launches: [{ id: 'old', status: 'failed', counts: { target: 99, failed: 99 } }] } })
    .mockReturnValueOnce(second.promise);
  const { rerender } = render(<SurveyLifecyclePanel survey={{ id: 'survey-1', name: 'First', lifecycleStatus: 'closed' }} />);
  expect(await screen.findByText(/99 of 99 finished/)).toBeInTheDocument();
  rerender(<SurveyLifecyclePanel survey={{ id: 'survey-2', name: 'Second', lifecycleStatus: 'active' }} />);
  expect(screen.queryByText(/99 of 99 finished/)).not.toBeInTheDocument();
  await act(async () => {
    second.resolve({ data: { launches: [] } });
    await second.promise;
  });
});

test('stops automatic terminal polling after the reconciliation horizon', async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-02-01T00:00:00Z'));
  api.get.mockResolvedValue({ data: { launches: [{
    id: 'old', status: 'completed', created_at: '2026-01-01T00:00:00Z',
    target_count: 1, accepted_count: 1,
  }] } });
  render(<SurveyLifecyclePanel survey={{ id: 'survey-1', name: 'First', lifecycleStatus: 'active' }} />);
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
  expect(api.get).toHaveBeenCalledTimes(1);
  await act(async () => { await vi.advanceTimersByTimeAsync(60000); });
  expect(api.get).toHaveBeenCalledTimes(1);
});

test('retries launch history with backoff after a transient failure', async () => {
  vi.useFakeTimers();
  api.get.mockRejectedValueOnce({ response: { status: 503 } }).mockResolvedValueOnce({ data: { launches: [] } });
  render(<SurveyLifecyclePanel survey={{ id: 'survey-1', name: 'First', lifecycleStatus: 'active' }} />);
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
  expect(api.get).toHaveBeenCalledTimes(1);
  await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
  expect(api.get).toHaveBeenCalledTimes(2);
});

test('ignores launch history that resolves after the selected survey changes', async () => {
  const first = deferred();
  const second = deferred();
  api.get.mockImplementation((url) => String(url || '').includes('survey-1') ? first.promise : second.promise);
  const { rerender } = render(<SurveyLifecyclePanel survey={{ id: 'survey-1', name: 'First', lifecycleStatus: 'active' }} />);

  rerender(<SurveyLifecyclePanel survey={{ id: 'survey-2', name: 'Second', lifecycleStatus: 'active' }} />);
  await act(async () => {
    second.resolve({ data: { launches: [{ id: 'new', status: 'completed', counts: { target: 2, accepted: 2 } }] } });
    await second.promise;
  });
  expect(await screen.findByText(/2 of 2 finished/)).toBeInTheDocument();

  await act(async () => {
    first.resolve({ data: { launches: [{ id: 'old', status: 'failed', counts: { target: 99, failed: 99 } }] } });
    await first.promise;
  });
  expect(screen.queryByText(/99 of 99 finished/)).not.toBeInTheDocument();
  expect(screen.getByLabelText('Invitation launch history')).toBeInTheDocument();
  expect(screen.getByRole('status')).toHaveTextContent('2 accepted');
});
