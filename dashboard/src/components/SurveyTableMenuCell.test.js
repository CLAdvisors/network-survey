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

  await userEvent.click(screen.getByRole('button', { name: 'Survey actions for Leadership Survey' }));
  await userEvent.click(await screen.findByText('Send Email Demo'));
  await userEvent.type(screen.getByLabelText('Email Address'), 'demo@example.com');
  await userEvent.click(screen.getByRole('button', { name: 'Send Demo' }));

  await waitFor(() => expect(api.post).toHaveBeenCalledWith(
    '/surveys/survey-1/demo-email',
    { email: 'demo@example.com', language: 'English' }
  ));
  expect(await screen.findByText('Demo sent.')).toBeInTheDocument();
});

test('an editor copies a survey with a clear destination name and sees success', async () => {
  const copiedSurvey = { id: 'survey-copy', name: 'Leadership Survey 2027', title: 'Leadership' };
  const onSurveyCopied = vi.fn();
  api.post.mockResolvedValue({
    data: { message: 'Survey copied successfully as "Leadership Survey 2027".', survey: copiedSurvey },
  });
  render(
    <SurveyTableMenuCell
      row={{ id: 'survey-1', name: 'Leadership Survey' }}
      onSurveyCopied={onSurveyCopied}
    />
  );

  await userEvent.click(screen.getByRole('button', { name: 'Survey actions for Leadership Survey' }));
  await userEvent.click(await screen.findByText('Copy Survey'));
  expect(screen.getByText(/complete configuration and respondent roster from “Leadership Survey”/)).toBeInTheDocument();

  const nameInput = screen.getByLabelText(/Copied survey name/);
  await userEvent.clear(nameInput);
  await userEvent.type(nameInput, 'Leadership Survey 2027{enter}');

  await waitFor(() => expect(api.post).toHaveBeenCalledWith(
    '/surveys/survey-1/copy',
    { name: 'Leadership Survey 2027' }
  ));
  expect(await screen.findByText('Survey copied successfully as "Leadership Survey 2027".')).toBeInTheDocument();
  expect(onSurveyCopied).toHaveBeenCalledWith(copiedSurvey);
});

test('copy validation and API collisions remain visible in the dialog', async () => {
  api.post.mockRejectedValue({
    response: { data: { message: 'A survey with that name already exists.' } },
  });
  render(<SurveyTableMenuCell row={{ id: 'survey-1', name: 'Leadership Survey' }} />);

  await userEvent.click(screen.getByRole('button', { name: 'Survey actions for Leadership Survey' }));
  await userEvent.click(await screen.findByText('Copy Survey'));
  const nameInput = screen.getByLabelText(/Copied survey name/);
  await userEvent.clear(nameInput);
  await userEvent.click(screen.getByRole('button', { name: 'Copy survey' }));
  expect(screen.getByText('Enter a name for the copied survey.')).toBeInTheDocument();
  expect(api.post).not.toHaveBeenCalled();

  await userEvent.type(nameInput, 'Existing Survey');
  await userEvent.click(screen.getByRole('button', { name: 'Copy survey' }));
  expect(await screen.findByText('A survey with that name already exists.')).toBeInTheDocument();
  expect(nameInput).toHaveValue('Existing Survey');
  expect(screen.getByRole('dialog')).toBeInTheDocument();
});

test('users without edit access do not see copy or email demo actions', async () => {
  canEdit = false;
  render(<SurveyTableMenuCell row={{ id: 'survey-1', name: 'Leadership Survey' }} />);

  await userEvent.click(screen.getByRole('button', { name: 'Survey actions for Leadership Survey' }));
  expect(screen.queryByText('Copy Survey')).not.toBeInTheDocument();
  expect(screen.queryByText('Send Email Demo')).not.toBeInTheDocument();
});
