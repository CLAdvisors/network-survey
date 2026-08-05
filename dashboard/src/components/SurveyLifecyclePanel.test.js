import React from 'react';
import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import api from '../api/axios';
import SurveyLifecyclePanel from './SurveyLifecyclePanel';
import { launchCounts, launchStatus } from './surveyLifecycle';

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
