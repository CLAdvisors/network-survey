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
  const copiedSurvey = { id: 'survey-copy', name: 'LeadershipSurvey2027', title: 'Leadership' };
  const onSurveyCopied = vi.fn();
  api.post.mockResolvedValue({
    data: { message: 'Survey copied successfully as "LeadershipSurvey2027".', survey: copiedSurvey },
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
  expect(nameInput).toHaveValue('LeadershipSurveyCopy');
  await userEvent.clear(nameInput);
  await userEvent.type(nameInput, 'LeadershipSurvey2027{enter}');

  await waitFor(() => expect(api.post).toHaveBeenCalledWith(
    '/surveys/survey-1/copy',
    { name: 'LeadershipSurvey2027' }
  ));
  expect(await screen.findByText('Survey copied successfully as "LeadershipSurvey2027".')).toBeInTheDocument();
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

  await userEvent.type(nameInput, 'Invalid Name');
  expect(screen.getByText('Only letters and numbers are allowed.')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Copy survey' }));
  expect(api.post).not.toHaveBeenCalled();

  await userEvent.clear(nameInput);
  await userEvent.type(nameInput, 'ExistingSurvey');
  await userEvent.click(screen.getByRole('button', { name: 'Copy survey' }));
  expect(await screen.findByText('A survey with that name already exists.')).toBeInTheDocument();
  expect(nameInput).toHaveValue('ExistingSurvey');
  expect(screen.getByRole('dialog')).toBeInTheDocument();
});

test('copy default remains unique and valid at the survey-name length boundary', async () => {
  const sourceName = `${'A'.repeat(251)}Copy`;
  render(<SurveyTableMenuCell row={{ id: 'survey-1', name: sourceName }} />);

  await userEvent.click(screen.getByRole('button', { name: `Survey actions for ${sourceName}` }));
  await userEvent.click(await screen.findByText('Copy Survey'));
  const defaultName = screen.getByLabelText(/Copied survey name/).value;

  expect(defaultName).toBe(`${'A'.repeat(250)}Copy2`);
  expect(defaultName).toHaveLength(255);
  expect(defaultName).not.toBe(sourceName);
  expect(defaultName).toMatch(/^[A-Za-z0-9]+$/);
});

test('users without edit access do not see copy or email demo actions', async () => {
  canEdit = false;
  render(<SurveyTableMenuCell row={{ id: 'survey-1', name: 'Leadership Survey' }} />);

  await userEvent.click(screen.getByRole('button', { name: 'Survey actions for Leadership Survey' }));
  expect(screen.queryByText('Copy Survey')).not.toBeInTheDocument();
  expect(screen.queryByText('Send Email Demo')).not.toBeInTheDocument();
});
