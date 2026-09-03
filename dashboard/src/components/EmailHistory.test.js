import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, expect, test, vi } from 'vitest';
import api from '../api/axios';
import EmailHistory from './EmailHistory';

vi.mock('../api/axios', () => ({ default: { get: vi.fn() } }));
const authState = vi.hoisted(() => ({ user: { id: 7 } }));
vi.mock('../context/AuthContext', () => ({ useAuth: () => authState }));

const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};

const message = (overrides = {}) => ({
  messageType: 'invitation',
  campaign: { launchId: 'launch-safe', kind: 'initial', queuedAt: '2026-08-01T09:59:00Z' },
  recipient: { displayName: 'A Recipient With A Very Long Name That Must Wrap', address: 'a.very.long.address.for.responsive.layout@example.test' },
  status: { code: 'provider_accepted', label: 'Provider accepted', explanation: 'The email provider accepted the message for delivery; recipient delivery is not confirmed.', occurredAt: '2026-08-01T10:02:00Z' },
  attempts: 3,
  providerAttempts: 1,
  timestamps: {
    queuedAt: '2026-08-01T10:00:00Z', firstAttemptedAt: '2026-08-01T10:01:00Z',
    lastAttemptedAt: '2026-08-01T10:02:00Z', providerAcceptedAt: '2026-08-01T10:02:00Z',
    deliveredAt: null, lastUpdatedAt: '2026-08-01T10:03:00Z',
  },
  ...overrides,
});

const response = (surveyId, messages = [message()], pageInfo = { limit: 25, hasMore: false, nextCursor: null }) => ({
  data: { surveyId, messages, pageInfo },
});

beforeEach(() => {
  vi.clearAllMocks();
  authState.user = { id: 7 };
  api.get.mockResolvedValue(response('survey-1'));
});

test('renders semantic desktop table and responsive cards with privacy-safe status semantics', async () => {
  render(<EmailHistory survey={{ id: 'survey-1', name: 'Lifecycle survey' }} />);
  const table = await screen.findByRole('table', { name: 'Email message history' });
  expect(within(table).getByRole('columnheader', { name: 'Type' })).toBeInTheDocument();
  expect(within(table).getByRole('columnheader', { name: 'Recipient' })).toBeInTheDocument();
  expect(within(table).getByRole('columnheader', { name: 'Status' })).toBeInTheDocument();
  expect(within(table).getByRole('columnheader', { name: 'Provider attempts' })).toBeInTheDocument();
  expect(within(table).getByRole('columnheader', { name: 'Worker attempts' })).toBeInTheDocument();
  expect(screen.getByTestId('email-history-table-view')).toBeInTheDocument();
  expect(screen.getByTestId('email-history-card-view')).toHaveAttribute('aria-label', 'Email message history cards');
  expect(screen.getByRole('article', { name: /Message 1: Invitation for A Recipient With A Very Long Name/ })).toBeInTheDocument();
  expect(screen.getByRole('heading', { level: 3, name: /Message 1: Invitation for A Recipient With A Very Long Name/ })).toBeInTheDocument();
  expect(screen.getAllByText('Provider accepted').length).toBeGreaterThanOrEqual(2);
  expect(screen.getAllByText(/Outcome reported/).length).toBeGreaterThanOrEqual(2);
  expect(screen.getByText(/only “Delivered” confirms receipt/i)).toBeInTheDocument();
  expect(screen.getAllByText('A Recipient With A Very Long Name That Must Wrap').length).toBeGreaterThanOrEqual(2);
  expect(screen.getAllByText('a.very.long.address.for.responsive.layout@example.test').length).toBeGreaterThanOrEqual(2);
  expect(screen.getByLabelText('1 provider attempt')).toBeInTheDocument();
  expect(screen.getByLabelText('3 worker attempts')).toBeInTheDocument();
  expect(screen.getByText(/Provider attempts count work that crossed the provider dispatch boundary/i)).toBeInTheDocument();
  expect(screen.getByRole('heading', { level: 2, name: 'Email history' })).toHaveAttribute('tabindex', '-1');
  expect(document.body.textContent).not.toMatch(/respondent[_ -]?token|message body|provider[_ -]?message[_ -]?id|lease[_ -]?token/i);
});

test('gives repeated messages for the same recipient distinct mobile article names and preserves unavailable provider counts', async () => {
  api.get.mockResolvedValueOnce(response('survey-1', [message(), message({ providerAttempts: null, campaign: { launchId: 'launch-two', kind: 'initial' } })]));
  render(<EmailHistory survey={{ id: 'survey-1', name: 'Lifecycle survey' }} />);
  expect(await screen.findByRole('article', { name: /Message 1: Invitation for A Recipient/ })).toBeInTheDocument();
  expect(screen.getByRole('article', { name: /Message 2: Invitation for A Recipient/ })).toBeInTheDocument();
  expect(screen.getByLabelText('Provider attempts unavailable')).toBeInTheDocument();
});

test('shows bounded loading, empty, error/retry, and explicit refresh states', async () => {
  const first = deferred();
  api.get.mockReturnValueOnce(first.promise);
  const { rerender } = render(<EmailHistory survey={{ id: 'survey-1', name: 'Lifecycle survey' }} />);
  expect(screen.getByText('Loading email history…')).toBeInTheDocument();
  expect(screen.getAllByRole('status')).toHaveLength(1);
  await act(async () => { first.resolve(response('survey-1', [])); await first.promise; });
  expect(await screen.findByText(/No invitation or reminder messages/)).toBeInTheDocument();

  api.get.mockRejectedValueOnce({ response: { data: { message: 'History is temporarily unavailable.' } } });
  fireEvent.click(screen.getByRole('button', { name: 'Refresh email history for Lifecycle survey' }));
  expect(await screen.findByText('History is temporarily unavailable.')).toBeInTheDocument();
  api.get.mockResolvedValueOnce(response('survey-1'));
  fireEvent.click(screen.getByRole('button', { name: 'Retry email history page 1' }));
  expect((await screen.findAllByText('A Recipient With A Very Long Name That Must Wrap')).length).toBeGreaterThanOrEqual(2);
  expect(api.get.mock.calls.every(([, options]) => options?.signal)).toBe(true);

  api.get.mockResolvedValueOnce(response('survey-1', [message({ recipient: { displayName: 'Refreshed person', address: 'refresh@example.test' } })]));
  fireEvent.click(screen.getByRole('button', { name: 'Refresh email history for Lifecycle survey' }));
  expect((await screen.findAllByText('Refreshed person')).length).toBeGreaterThanOrEqual(2);
  rerender(<EmailHistory survey={{ id: 'survey-1', name: 'Lifecycle survey' }} />);
});

test('paginates with opaque cursors, supports previous, and focuses the section after navigation', async () => {
  api.get
    .mockResolvedValueOnce(response('survey-1', [message()], { limit: 25, hasMore: true, nextCursor: 'opaque.cursor' }))
    .mockResolvedValueOnce(response('survey-1', [message({ messageType: 'reminder', recipient: { displayName: 'Page two', address: 'two@example.test' } })]))
    .mockResolvedValueOnce(response('survey-1', [message()], { limit: 25, hasMore: true, nextCursor: 'opaque.cursor' }))
    .mockResolvedValueOnce(response('survey-1', [message({ recipient: { displayName: 'Refreshed newest', address: 'newest@example.test' } })]));
  render(<EmailHistory survey={{ id: 'survey-1', name: 'Lifecycle survey' }} />);
  await screen.findAllByText('A Recipient With A Very Long Name That Must Wrap');
  fireEvent.click(screen.getByRole('button', { name: 'Next email history page' }));
  expect((await screen.findAllByText('Page two')).length).toBeGreaterThanOrEqual(2);
  expect(api.get.mock.calls[1][0]).toContain('cursor=opaque.cursor');
  await waitFor(() => expect(screen.getByRole('heading', { name: 'Email history' })).toHaveFocus());
  expect(screen.getByText('Page 2')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Previous email history page' }));
  expect((await screen.findAllByText('A Recipient With A Very Long Name That Must Wrap')).length).toBeGreaterThanOrEqual(2);
  expect(api.get.mock.calls[2][0]).not.toContain('cursor=');
  fireEvent.click(screen.getByRole('button', { name: 'Refresh email history for Lifecycle survey' }));
  expect((await screen.findAllByText('Refreshed newest')).length).toBeGreaterThanOrEqual(2);
  expect(api.get.mock.calls[3][0]).not.toContain('cursor=');
});

test('keeps previous and current-page retry available when a later page fails', async () => {
  api.get
    .mockResolvedValueOnce(response('survey-1', [message()], { limit: 25, hasMore: true, nextCursor: 'page-two.cursor' }))
    .mockRejectedValueOnce({ response: { data: { message: 'Page two unavailable.' } } })
    .mockResolvedValueOnce(response('survey-1', [message({ recipient: { displayName: 'Retried page two', address: 'retried@example.test' } })]));
  render(<EmailHistory survey={{ id: 'survey-1', name: 'Lifecycle survey' }} />);
  await screen.findAllByText('A Recipient With A Very Long Name That Must Wrap');
  fireEvent.click(screen.getByRole('button', { name: 'Next email history page' }));
  expect(await screen.findByText('Page two unavailable.')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Previous email history page' })).toBeEnabled();
  fireEvent.click(screen.getByRole('button', { name: 'Retry email history page 2' }));
  expect((await screen.findAllByText('Retried page two')).length).toBeGreaterThanOrEqual(2);
  expect(api.get.mock.calls[2][0]).toContain('cursor=page-two.cursor');
});

test('never flashes or accepts stale recipients across survey and session switches', async () => {
  const oldSurvey = deferred();
  const oldSession = deferred();
  api.get.mockImplementation((url) => {
    if (String(url).includes('survey-1')) return authState.user.id === 7 ? oldSurvey.promise : oldSession.promise;
    return Promise.resolve(response('survey-2', [message({ recipient: { displayName: 'Current survey person', address: 'current@example.test' } })]));
  });
  const { rerender } = render(<EmailHistory survey={{ id: 'survey-1', name: 'First' }} />);
  rerender(<EmailHistory survey={{ id: 'survey-2', name: 'Second' }} />);
  expect((await screen.findAllByText('Current survey person')).length).toBeGreaterThanOrEqual(2);
  await act(async () => { oldSurvey.resolve(response('survey-1', [message({ recipient: { displayName: 'Forbidden stale person', address: 'stale@example.test' } })])); await oldSurvey.promise; });
  expect(screen.queryByText('Forbidden stale person')).not.toBeInTheDocument();

  rerender(<EmailHistory survey={{ id: 'survey-1', name: 'First' }} />);
  authState.user = { id: 8 };
  rerender(<EmailHistory survey={{ id: 'survey-1', name: 'First' }} />);
  await act(async () => { oldSession.resolve(response('survey-1', [message({ recipient: { displayName: 'New session person', address: 'new@example.test' } })])); await oldSession.promise; });
  expect((await screen.findAllByText('New session person')).length).toBeGreaterThanOrEqual(2);
  expect(screen.queryByText('Forbidden stale person')).not.toBeInTheDocument();
});

test('rejects mismatched survey responses instead of displaying their recipients', async () => {
  api.get.mockResolvedValueOnce(response('survey-other', [message({ recipient: { displayName: 'Wrong survey person', address: 'wrong@example.test' } })]));
  render(<EmailHistory survey={{ id: 'survey-1', name: 'First' }} />);
  expect(await screen.findByText(/did not match the selected survey/i)).toBeInTheDocument();
  expect(screen.queryByText('Wrong survey person')).not.toBeInTheDocument();
});
