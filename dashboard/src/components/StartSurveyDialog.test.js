import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, test, vi } from 'vitest';
import api from '../api/axios';
import StartSurveyDialog from './StartSurveyDialog';

vi.mock('../api/axios', () => ({
  default: { get: vi.fn(), post: vi.fn() },
}));

const readiness = {
  lifecycleStatus: 'draft',
  eligibleCount: 3,
  excludedCount: 1,
  canLaunch: true,
  blockers: [],
  warnings: [{ code: 'REAL_EMAIL', message: 'Real email will be sent.' }],
  templateCoverage: [{ language: 'English', covered: true }],
};

beforeEach(() => vi.clearAllMocks());

test('shows readiness and queues one truthful idempotent launch', async () => {
  api.get.mockResolvedValue({ data: readiness });
  api.post.mockResolvedValue({ status: 202, data: { launchId: 'launch-1' } });
  const accepted = vi.fn();
  render(<StartSurveyDialog open survey={{ id: 'survey-1', name: 'Team Survey' }} onClose={() => {}} onAccepted={accepted} />);

  expect(await screen.findByText('3 eligible')).toBeInTheDocument();
  expect(screen.getByText('1 excluded')).toBeInTheDocument();
  expect(screen.getByText(/not proof of delivery/i)).toBeInTheDocument();

  await userEvent.dblClick(screen.getByRole('button', { name: 'Queue invitations' }));
  await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1));
  const [, body, config] = api.post.mock.calls[0];
  expect(body).toEqual({ kind: 'initial' });
  expect(config.headers['Idempotency-Key']).toMatch(/^[0-9a-f-]{36}$/i);
  expect(accepted).toHaveBeenCalledWith({ launchId: 'launch-1' });
});

test('replaces stale readiness with launch-time blockers after a 422', async () => {
  api.get.mockResolvedValue({ data: readiness });
  api.post.mockRejectedValue({ response: { status: 422, data: { message: 'Survey is not ready to launch.', details: {
    ...readiness, canLaunch: false, blockers: [{ code: 'template_missing', message: 'A French template is required.' }],
  } } } });
  render(<StartSurveyDialog open survey={{ id: 'survey-1', name: 'Team Survey' }} onClose={() => {}} onAccepted={() => {}} />);

  await screen.findByText('3 eligible');
  await userEvent.click(screen.getByRole('button', { name: 'Queue invitations' }));
  expect(await screen.findByText('A French template is required.')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Queue invitations' })).toBeDisabled();
});

test('keeps the same idempotency key and accepts a 200 durable replay after an ambiguous error', async () => {
  api.get.mockResolvedValue({ data: readiness });
  api.post
    .mockRejectedValueOnce({ response: { status: 503 } })
    .mockResolvedValueOnce({ status: 200, data: { launch: { id: 'launch-1', replayed: true } } });
  render(<StartSurveyDialog open survey={{ id: 'survey-1', name: 'Team Survey' }} onClose={() => {}} onAccepted={() => {}} />);

  await screen.findByText('3 eligible');
  await waitFor(() => expect(screen.getByRole('button', { name: 'Queue invitations' })).toBeEnabled());
  await userEvent.click(screen.getByRole('button', { name: 'Queue invitations' }));
  expect(await screen.findByText(/delivery is currently unavailable/i)).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Queue invitations' }));

  await waitFor(() => expect(api.post).toHaveBeenCalledTimes(2));
  expect(api.post.mock.calls[1][2].headers['Idempotency-Key']).toBe(api.post.mock.calls[0][2].headers['Idempotency-Key']);
});
