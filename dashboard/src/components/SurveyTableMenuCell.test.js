import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, test, vi } from 'vitest';
import SurveyTableMenuCell from './SurveyTableMenuCell';
import api from '../api/axios';

let canEdit = true;

vi.mock('../api/axios', () => ({
  default: { post: vi.fn(), delete: vi.fn() },
}));

vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({
    canEditSurvey: () => canEdit,
    canArchiveSurvey: () => false,
  }),
}));

beforeEach(() => {
  canEdit = true;
  vi.clearAllMocks();
});

test('an editor can send a no-results email demo from a survey row', async () => {
  api.post.mockResolvedValue({ data: { message: 'Demo sent.' } });
  render(<SurveyTableMenuCell row={{ id: 'survey-1', name: 'Leadership Survey' }} />);

  await userEvent.click(screen.getByRole('button'));
  await userEvent.click(await screen.findByText('Send Email Demo'));
  await userEvent.type(screen.getByLabelText('Email Address'), 'demo@example.com');
  await userEvent.click(screen.getByRole('button', { name: 'Send Demo' }));

  await waitFor(() => expect(api.post).toHaveBeenCalledWith(
    '/surveys/survey-1/demo-email',
    { email: 'demo@example.com', language: 'English' }
  ));
  expect(await screen.findByText('Demo sent.')).toBeInTheDocument();
});

test('users without edit access do not see the email demo action', async () => {
  canEdit = false;
  render(<SurveyTableMenuCell row={{ id: 'survey-1', name: 'Leadership Survey' }} />);

  await userEvent.click(screen.getByRole('button'));
  expect(screen.queryByText('Send Email Demo')).not.toBeInTheDocument();
});
