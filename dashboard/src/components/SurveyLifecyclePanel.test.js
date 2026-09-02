import React from 'react';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import api from '../api/axios';
import SurveyLifecyclePanel, { LifecycleChip } from './SurveyLifecyclePanel';
import {
  launchCounts, launchStatus, lifecycleLabel, lifecycleStatus, providerCounts, providerOutcome, providerOutcomeLabel,
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

test('presents the internal active lifecycle contract as Launched', () => {
  const survey = { lifecycle_status: 'active' };
  expect(lifecycleStatus(survey)).toBe('active');
  expect(lifecycleLabel(lifecycleStatus(survey))).toBe('Launched');
  render(<LifecycleChip status={lifecycleStatus(survey)} />);
  expect(screen.getByText('Launched')).toBeInTheDocument();
  expect(screen.queryByText('Active')).not.toBeInTheDocument();
});

test('describes draft lifecycle timing without implying it has launched', async () => {
  api.get.mockResolvedValue({ data: { launches: [] } });
  render(<SurveyLifecyclePanel survey={{ id: 'survey-draft', name: 'Draft survey', lifecycleStatus: 'draft' }} />);
  expect(screen.getByText('Not launched')).toBeInTheDocument();
  expect(screen.queryByText(/^Launched /)).not.toBeInTheDocument();
});

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
      complained_count: 1, suppressed_count: 0, provider_failed_count: '1', provider_problem_count: '2', provider_waiting_count: '3', accepted_unverified_count: '1',
    },
  })).toEqual({
    sent: 4, delivered: 2, delayed: 1, bounced: 1, complained: 1,
    suppressed: 0, providerFailed: 1, problems: 2, waiting: 3, acceptedUnverified: 1,
  });
  expect(providerCounts({ acceptedCount: 3 })).toMatchObject({ acceptedUnverified: 3, waiting: 3 });

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

  const sendingSummary = await screen.findByRole('region', { name: 'Invitation sending summary' });
  expect(screen.getByLabelText('3 submitted for sending')).toBeInTheDocument();
  const deliverySummary = screen.getByRole('region', { name: 'Delivery confirmation summary' });
  expect(within(deliverySummary).getByLabelText('2 delivery confirmations')).toBeInTheDocument();
  expect(within(deliverySummary).getByLabelText('1 invitation with a delivery problem')).toBeInTheDocument();
  expect(within(deliverySummary).getByLabelText('1 awaiting a final delivery result')).toBeInTheDocument();
  expect(deliverySummary).not.toHaveTextContent('3 delivery confirmations');
});

test('uses plain-language aggregates instead of exposing operational keyword lists', async () => {
  api.get.mockResolvedValue({ data: { launches: [{
    id: 'launch-demo', status: 'processing', created_at: new Date().toISOString(),
    target_count: 13, pending_count: 1, retry_wait_count: 1, accepted_count: 8,
    failed_count: 1, uncertain_count: 1, cancelled_count: 1,
    provider_outcome_counts: {
      delivered_count: 2, delayed_count: 1, bounced_count: 1, complained_count: 1,
      suppressed_count: 1, provider_failed_count: 1, provider_problem_count: 3,
      provider_waiting_count: 2, accepted_unverified_count: 1,
    },
  }] } });
  render(<SurveyLifecyclePanel survey={{ id: 'survey-1', name: 'Delivery demo', lifecycleStatus: 'active' }} />);

  const sending = await screen.findByRole('region', { name: 'Invitation sending summary' });
  expect(sending).toHaveTextContent('13 invitations in this launch');
  expect(screen.getByLabelText('8 submitted for sending')).toBeInTheDocument();
  expect(screen.getByLabelText('2 still processing')).toBeInTheDocument();
  expect(screen.getByLabelText('3 not confirmed sent')).toBeInTheDocument();
  expect(sending).not.toHaveTextContent(/pending|retrying|uncertain|cancelled|issues/i);

  const delivery = screen.getByRole('region', { name: 'Delivery confirmation summary' });
  expect(within(delivery).getByLabelText('2 delivery confirmations')).toBeInTheDocument();
  expect(within(delivery).getByLabelText('3 invitations with delivery problems')).toBeInTheDocument();
  expect(within(delivery).getByLabelText('2 awaiting a final delivery result')).toBeInTheDocument();
  expect(within(delivery).getByLabelText('1 delay report')).toBeInTheDocument();
  expect(delivery).not.toHaveTextContent(/bounced|complained|suppressed|provider failed/i);
  expect(screen.getByRole('status')).toHaveTextContent('Delivery update: 2 confirmations, 2 invitations awaiting a final result, 3 invitations with delivery problems, 1 delay report.');
  expect(screen.getByRole('heading', { level: 2, name: 'Survey lifecycle' })).toBeInTheDocument();
  expect(screen.getByRole('heading', { level: 3, name: 'Invitation sending' })).toBeInTheDocument();
  expect(screen.getByText(/while this survey is launched.*only while the survey is launched/i)).toBeInTheDocument();
  expect(screen.queryByRole('heading', { name: /^\d+$/ })).not.toBeInTheDocument();

  const explanation = screen.getByLabelText('Current launch explanation');
  fireEvent.click(within(explanation).getByText('How are these numbers calculated?'));
  expect(within(explanation).getByText(/1 permanent failure, 1 result that could not be safely confirmed, and 1 intentionally stopped invitation/)).toBeVisible();
  expect(within(explanation).getByText(/1 mail-server rejection, 1 spam complaint, 1 blocked address, and 1 provider delivery failure/)).toBeVisible();
});

test('does not render prior survey history while the next survey is loading', async () => {
  const second = deferred();
  api.get
    .mockResolvedValueOnce({ data: { launches: [{ id: 'old', status: 'failed', counts: { target: 99, failed: 99 } }] } })
    .mockReturnValueOnce(second.promise);
  const { rerender } = render(<SurveyLifecyclePanel survey={{ id: 'survey-1', name: 'First', lifecycleStatus: 'closed' }} />);
  expect(await screen.findByLabelText('99 not confirmed sent')).toBeInTheDocument();
  rerender(<SurveyLifecyclePanel survey={{ id: 'survey-2', name: 'Second', lifecycleStatus: 'active' }} />);
  expect(screen.queryByLabelText('99 not confirmed sent')).not.toBeInTheDocument();
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
  expect(await screen.findByLabelText('2 submitted for sending')).toBeInTheDocument();

  await act(async () => {
    first.resolve({ data: { launches: [{ id: 'old', status: 'failed', counts: { target: 99, failed: 99 } }] } });
    await first.promise;
  });
  expect(screen.queryByLabelText('99 not confirmed sent')).not.toBeInTheDocument();
  expect(screen.getByLabelText('Email campaign history')).toBeInTheDocument();
  expect(screen.getByLabelText('2 submitted for sending')).toBeInTheDocument();
});
