import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, test, vi } from 'vitest';
import InvitationSubjectEditor from './InvitationSubjectEditor';
import api from '../api/axios';

vi.mock('../api/axios', () => ({
  default: { get: vi.fn(), put: vi.fn() },
}));

beforeEach(() => vi.clearAllMocks());

test('loads and saves the localized invitation subject without changing its body', async () => {
  api.get.mockResolvedValue({
    data: {
      notifications: { English: 'Existing invitation body' },
      notificationSubjects: { English: 'Existing subject' },
    },
  });
  api.put.mockResolvedValue({ data: { message: 'saved' } });

  render(<InvitationSubjectEditor surveyId="survey-1" />);
  const subject = await screen.findByLabelText(/Invitation email subject/);
  await waitFor(() => expect(subject).toHaveValue('Existing subject'));

  await userEvent.clear(subject);
  await userEvent.type(subject, 'Leadership survey invitation');
  await userEvent.click(screen.getByRole('button', { name: 'Save' }));

  await waitFor(() => expect(api.put).toHaveBeenCalledWith(
    '/survey-notifications/survey-1/subject',
    { language: 'English', subject: 'Leadership survey invitation' }
  ));
  expect(await screen.findByText('Invitation email subject saved.')).toBeInTheDocument();
});

test('disables subject changes when the survey lifecycle is read-only', async () => {
  api.get.mockResolvedValue({
    data: { notifications: { English: 'Body' }, notificationSubjects: { English: 'Locked subject' } },
  });

  render(<InvitationSubjectEditor surveyId="survey-1" readOnly />);
  const subject = await screen.findByLabelText(/Invitation email subject/);
  await waitFor(() => expect(subject).toHaveValue('Locked subject'));
  expect(subject).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  expect(screen.getByText(/Invitation subjects are read-only/)).toBeInTheDocument();
});

test('preserves an unsaved subject draft across survey switches and allows reverting it', async () => {
  api.get.mockImplementation(async (url) => ({
    data: url.includes('survey-1')
      ? { notifications: { English: 'Body 1' }, notificationSubjects: { English: 'Subject 1' } }
      : { notifications: { English: 'Body 2' }, notificationSubjects: { English: 'Subject 2' } },
  }));

  const view = render(<InvitationSubjectEditor surveyId="survey-1" />);
  const subject = await screen.findByLabelText(/Invitation email subject/);
  await waitFor(() => expect(subject).toHaveValue('Subject 1'));
  await userEvent.clear(subject);
  await userEvent.type(subject, 'Unsaved draft');

  view.rerender(<InvitationSubjectEditor surveyId="survey-2" />);
  await waitFor(() => expect(subject).toHaveValue('Subject 2'));
  view.rerender(<InvitationSubjectEditor surveyId="survey-1" />);
  await waitFor(() => expect(subject).toHaveValue('Unsaved draft'));

  await userEvent.click(screen.getByRole('button', { name: 'Revert' }));
  expect(subject).toHaveValue('Subject 1');
});
