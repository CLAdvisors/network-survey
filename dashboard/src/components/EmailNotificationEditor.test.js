import React from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import EmailNotificationEditor from './EmailNotificationEditor';
import api from '../api/axios';

vi.mock('../api/axios', () => ({
  default: { get: vi.fn(), post: vi.fn() },
}));

const response = (text, subjects = {}) => ({
  data: { notifications: { English: text }, notificationSubjects: subjects },
});

const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.unstubAllGlobals());

test('saves multiline body as a structured template without overwriting subjects', async () => {
  api.get.mockResolvedValue(response('Original body', { English: 'Keep this subject' }));
  api.post.mockResolvedValue({ data: { message: 'saved' } });
  render(<EmailNotificationEditor surveyId="survey-1" />);

  const body = await screen.findByLabelText('Invitation email body');
  await waitFor(() => expect(body).toHaveValue('Original body'));
  await userEvent.clear(body);
  await userEvent.type(body, 'Hello team,{enter}{enter}Please complete the survey.');
  await userEvent.click(screen.getByRole('button', { name: 'Save body' }));

  await waitFor(() => expect(api.post).toHaveBeenCalledWith('/updateEmails', {
    surveyName: 'survey-1',
    templates: [{ language: 'English', text: 'Hello team,\n\nPlease complete the survey.' }],
  }));
  expect(api.post.mock.calls[0][1].templates[0]).not.toHaveProperty('subject');
  expect(await screen.findByText('Notification text saved successfully.')).toBeInTheDocument();
  expect(body).toHaveValue('Hello team,\n\nPlease complete the survey.');
});

test('shows the API save error and keeps the failed edit dirty', async () => {
  api.get.mockResolvedValue(response('Original'));
  api.post.mockRejectedValue({ response: { data: { message: 'Survey is launched and cannot be edited.' } } });
  render(<EmailNotificationEditor surveyId="survey-1" />);

  const body = await screen.findByLabelText('Invitation email body');
  await waitFor(() => expect(body).toHaveValue('Original'));
  await userEvent.type(body, ' changed');
  await userEvent.click(screen.getByRole('button', { name: 'Save body' }));

  expect(await screen.findByText('Survey is launched and cannot be edited.')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Save body' })).toBeEnabled();
  expect(body).toHaveValue('Original changed');
});

test('shows the CSV import API error and restores editing controls', async () => {
  api.get.mockResolvedValue(response('Original'));
  api.post.mockRejectedValue({ response: { data: { message: 'CSV row 3 has an invalid language.' } } });
  const view = render(<EmailNotificationEditor surveyId="survey-1" />);
  const body = await screen.findByLabelText('Invitation email body');
  await waitFor(() => expect(body).toHaveValue('Original'));

  const input = view.container.querySelector('input[type="file"]');
  await userEvent.upload(input, new File(['Language,Text\nEnglish,Hello'], 'templates.csv', { type: 'text/csv' }));

  expect(await screen.findByText('CSV row 3 has an invalid language.')).toBeInTheDocument();
  await waitFor(() => expect(body).toBeEnabled());
  expect(body).toHaveValue('Original');
});

test('releases the body operation lock when FileReader construction fails', async () => {
  const onOperationChange = vi.fn();
  vi.stubGlobal('FileReader', class {
    constructor() { throw new Error('reader unavailable'); }
  });
  api.get.mockResolvedValue(response('Original'));

  const view = render(<EmailNotificationEditor surveyId="survey-1" onOperationChange={onOperationChange} />);
  await waitFor(() => expect(screen.getByLabelText('Invitation email body')).toHaveValue('Original'));
  await userEvent.upload(
    view.container.querySelector('input[type="file"]'),
    new File(['Language,Text\nEnglish,Hello'], 'templates.csv', { type: 'text/csv' })
  );

  expect(await screen.findByText('Failed to read the CSV file.')).toBeInTheDocument();
  expect(onOperationChange).toHaveBeenNthCalledWith(1, 'survey-1', 'invitationBody', true);
  expect(onOperationChange).toHaveBeenNthCalledWith(2, 'survey-1', 'invitationBody', false);
});

test('preserves a dirty body draft across survey switches', async () => {
  api.get.mockImplementation((url) => Promise.resolve(
    url.endsWith('survey-1') ? response('Body one') : response('Body two')
  ));
  const view = render(<EmailNotificationEditor surveyId="survey-1" />);
  const body = await screen.findByLabelText('Invitation email body');
  await waitFor(() => expect(body).toHaveValue('Body one'));
  await userEvent.type(body, ' draft');

  view.rerender(<EmailNotificationEditor surveyId="survey-2" />);
  await waitFor(() => expect(body).toHaveValue('Body two'));
  view.rerender(<EmailNotificationEditor surveyId="survey-1" />);
  await waitFor(() => expect(body).toHaveValue('Body one draft'));
  expect(screen.getByRole('button', { name: 'Save body' })).toBeEnabled();
});

test('does not post a CSV whose file read completes after switching surveys', async () => {
  let reader;
  vi.stubGlobal('FileReader', class {
    readAsText() { reader = this; }
  });
  api.get.mockResolvedValue(response('Original'));
  const view = render(<EmailNotificationEditor surveyId="survey-1" />);
  await waitFor(() => expect(screen.getByLabelText('Invitation email body')).toHaveValue('Original'));
  await userEvent.upload(
    view.container.querySelector('input[type="file"]'),
    new File(['Language,Text\nEnglish,Hello'], 'templates.csv', { type: 'text/csv' })
  );

  view.rerender(<EmailNotificationEditor surveyId="survey-2" />);
  await act(async () => reader.onload({ target: { result: 'Language,Text\nEnglish,Hello' } }));
  expect(api.post).not.toHaveBeenCalled();
});

test('ignores stale loads and stale saves after switching surveys', async () => {
  const firstLoad = deferred();
  const firstSave = deferred();
  api.get.mockImplementation((url) => url.endsWith('survey-1') ? firstLoad.promise : Promise.resolve(response('Survey two body')));
  api.post.mockReturnValue(firstSave.promise);

  const view = render(<EmailNotificationEditor surveyId="survey-1" />);
  view.rerender(<EmailNotificationEditor surveyId="survey-2" />);
  const body = await screen.findByLabelText('Invitation email body');
  await waitFor(() => expect(body).toHaveValue('Survey two body'));
  firstLoad.resolve(response('Stale survey one body'));
  await Promise.resolve();
  expect(body).toHaveValue('Survey two body');

  await userEvent.type(body, ' edited');
  await userEvent.click(screen.getByRole('button', { name: 'Save body' }));
  view.rerender(<EmailNotificationEditor surveyId="survey-3" />);
  api.get.mockResolvedValue(response('Survey three body'));
  firstSave.resolve({ data: { message: 'saved' } });
  await waitFor(() => expect(api.get).toHaveBeenCalledWith('/survey-notifications/survey-3', expect.any(Object)));
  expect(screen.queryByText('Notification text saved successfully.')).not.toBeInTheDocument();
});

test('keeps the owning body locked while its save is pending across survey switches', async () => {
  const pendingSave = deferred();
  api.get.mockImplementation((url) => Promise.resolve(
    url.endsWith('survey-1') ? response('Body one') : response('Body two')
  ));
  api.post.mockReturnValue(pendingSave.promise);

  const view = render(<EmailNotificationEditor surveyId="survey-1" />);
  const body = await screen.findByLabelText('Invitation email body');
  await waitFor(() => expect(body).toHaveValue('Body one'));
  await userEvent.type(body, ' pending');
  await userEvent.click(screen.getByRole('button', { name: 'Save body' }));

  view.rerender(<EmailNotificationEditor surveyId="survey-2" />);
  await waitFor(() => expect(body).toHaveValue('Body two'));
  view.rerender(<EmailNotificationEditor surveyId="survey-1" />);
  await waitFor(() => expect(body).toHaveValue('Body one pending'));
  expect(body).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Saving…' })).toBeDisabled();

  await act(async () => pendingSave.resolve({ data: { message: 'saved' } }));
  expect(body).toBeEnabled();
  expect(body).toHaveValue('Body one pending');
});

test('clears the owning survey dirty state when a body save succeeds after switching away', async () => {
  const pendingSave = deferred();
  const onDirtyChange = vi.fn();
  api.get.mockImplementation((url) => Promise.resolve(
    url.endsWith('survey-1') ? response('Body one') : response('Body two')
  ));
  api.post.mockReturnValue(pendingSave.promise);

  const view = render(<EmailNotificationEditor surveyId="survey-1" onDirtyChange={onDirtyChange} />);
  const body = await screen.findByLabelText('Invitation email body');
  await waitFor(() => expect(body).toHaveValue('Body one'));
  await userEvent.type(body, ' saved');
  await userEvent.click(screen.getByRole('button', { name: 'Save body' }));
  view.rerender(<EmailNotificationEditor surveyId="survey-2" onDirtyChange={onDirtyChange} />);
  await waitFor(() => expect(body).toHaveValue('Body two'));

  onDirtyChange.mockClear();
  await act(async () => pendingSave.resolve({ data: { message: 'saved' } }));
  expect(onDirtyChange).toHaveBeenCalledWith('survey-1', 'invitationBody', false);
  expect(body).toHaveValue('Body two');
});

test('preserves dirty content while disabling editing when lifecycle becomes read-only', async () => {
  api.get.mockResolvedValue(response('Locked body'));
  const view = render(<EmailNotificationEditor surveyId="survey-1" />);
  const body = await screen.findByLabelText('Invitation email body');
  await waitFor(() => expect(body).toHaveValue('Locked body'));
  await userEvent.type(body, ' draft');

  view.rerender(<EmailNotificationEditor surveyId="survey-1" readOnly />);
  await waitFor(() => expect(body).toHaveValue('Locked body draft'));
  expect(body).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Save body' })).toBeDisabled();
  expect(screen.getByText(/read-only after a survey has been launched/i)).toBeInTheDocument();
});
