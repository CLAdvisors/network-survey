import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, test, vi } from 'vitest';
import SurveyTableMenuCell from './SurveyTableMenuCell';
import api from '../api/axios';

let canEdit = true;
let canArchive = false;

vi.mock('../api/axios', () => ({
  default: { get: vi.fn(), post: vi.fn(), delete: vi.fn() },
}));

vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({
    canEditSurvey: () => canEdit,
    canArchiveSurvey: () => canArchive,
    hasSurveyRole: () => false,
  }),
}));

const deferred = () => {
  let resolve;
  const promise = new Promise((yes) => { resolve = yes; });
  return { promise, resolve };
};

beforeEach(() => {
  canEdit = true;
  canArchive = false;
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
  expect(screen.getByText(/Copy the survey title, question schema, and invitation email subject\/body templates from “Leadership Survey”/)).toBeInTheDocument();
  expect(screen.getByText(/No participants, contact details, response state, invitation links, or delivery history will be copied/)).toBeInTheDocument();
  expect(screen.getByText(/empty participant roster/i)).toBeInTheDocument();

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

test('blocks copy and archive while this survey has drafts or pending updates', async () => {
  canArchive = true;
  const view = render(<SurveyTableMenuCell
    row={{ id: 'survey-1', name: 'Leadership Survey' }}
    unsavedChanges={{ questions: true }}
  />);

  await userEvent.click(screen.getByRole('button', { name: 'Survey actions for Leadership Survey' }));
  await userEvent.click(screen.getByText('Copy Survey'));
  expect(await screen.findByText(/Save or undo changes to “Leadership Survey” before continuing.*Copy uses only persisted survey content/)).toBeInTheDocument();
  expect(screen.queryByRole('dialog', { name: 'Copy survey' })).not.toBeInTheDocument();

  await userEvent.click(screen.getByRole('button', { name: 'Survey actions for Leadership Survey' }));
  await userEvent.click(screen.getByText('Send Email Demo'));
  expect(await screen.findByText(/Save or undo changes to “Leadership Survey” before continuing.*Email demos use only persisted survey content/)).toBeInTheDocument();
  expect(screen.queryByRole('dialog', { name: /send demo survey email/i })).not.toBeInTheDocument();

  view.rerender(<SurveyTableMenuCell
    row={{ id: 'survey-1', name: 'Leadership Survey' }}
    pendingOperations={{ respondents: true }}
  />);
  await userEvent.click(screen.getByRole('button', { name: 'Survey actions for Leadership Survey' }));
  await userEvent.click(screen.getByText('Archive Survey'));
  expect(await screen.findByText(/Wait for the current update to “Leadership Survey” to finish.*Archive is unavailable/)).toBeInTheDocument();
  expect(screen.queryByText(/Archive “Leadership Survey”/)).not.toBeInTheDocument();
  expect(api.post).not.toHaveBeenCalled();
  expect(api.delete).not.toHaveBeenCalled();
});

test('users without edit access do not see copy or email demo actions', async () => {
  canEdit = false;
  render(<SurveyTableMenuCell row={{ id: 'survey-1', name: 'Leadership Survey' }} />);

  await userEvent.click(screen.getByRole('button', { name: 'Survey actions for Leadership Survey' }));
  expect(screen.queryByText('Copy Survey')).not.toBeInTheDocument();
  expect(screen.queryByText('Send Email Demo')).not.toBeInTheDocument();
});

test('locks a selected survey immediately after launch acceptance while refresh is delayed', async () => {
  const refresh = deferred();
  const viewed = vi.fn();
  api.get.mockResolvedValue({ data: {
    lifecycleStatus: 'draft', eligibleCount: 1, excludedCount: 0,
    canLaunch: true, blockers: [], warnings: [], templateCoverage: [],
  } });
  api.post.mockResolvedValue({ status: 202, data: { lifecycleStatus: 'active', launch: { id: 'launch-1' } } });
  render(<SurveyTableMenuCell
    row={{ id: 'survey-1', name: 'Leadership Survey', lifecycleStatus: 'draft' }}
    onLifecycleChange={() => refresh.promise}
    onViewLifecycle={viewed}
  />);

  await userEvent.click(screen.getByRole('button', { name: 'Survey actions for Leadership Survey' }));
  await userEvent.click(screen.getByText('Launch Survey'));
  await screen.findByText('1 eligible');
  await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument());
  await waitFor(() => expect(screen.getByRole('button', { name: 'Queue invitations' })).toBeEnabled());
  await userEvent.click(screen.getByRole('button', { name: 'Queue invitations' }));
  await waitFor(() => expect(viewed).toHaveBeenCalledWith(expect.objectContaining({ id: 'survey-1', lifecycleStatus: 'active' })));
  refresh.resolve([]);
});

test('passes only this row’s unsaved sections into the launch blocker', async () => {
  api.get.mockResolvedValue({ data: {
    lifecycleStatus: 'draft', eligibleCount: 1, excludedCount: 0,
    canLaunch: true, blockers: [], warnings: [], templateCoverage: [],
  } });
  render(<SurveyTableMenuCell
    row={{ id: 'survey-1', name: 'Leadership Survey', lifecycleStatus: 'draft' }}
    unsavedChanges={{ questions: true, respondents: true }}
  />);

  await userEvent.click(screen.getByRole('button', { name: 'Survey actions for Leadership Survey' }));
  await userEvent.click(screen.getByText('Launch Survey'));
  expect(await screen.findByText(/“Leadership Survey” has unsaved changes in survey questions, survey respondents/i)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Queue invitations' })).toBeDisabled();
});

test('blocks Close Survey from the menu while this survey is dirty or pending', async () => {
  const row={ id: 'survey-1', name: 'Leadership Survey', lifecycleStatus: 'active' };
  const view=render(<SurveyTableMenuCell row={row} unsavedChanges={{reminderTemplate:true}} />);

  await userEvent.click(screen.getByRole('button', { name: 'Actions for Leadership Survey' }));
  await userEvent.click(screen.getByText('Close Survey'));
  expect(await screen.findByText(/Save or undo changes to “Leadership Survey” before continuing.*Close is unavailable/)).toBeInTheDocument();
  expect(screen.queryByRole('dialog',{name:'Close survey'})).not.toBeInTheDocument();
  expect(api.post).not.toHaveBeenCalled();

  view.rerender(<SurveyTableMenuCell row={row} pendingOperations={{reminderTemplate:true}} />);
  await userEvent.click(screen.getByRole('button', { name: 'Actions for Leadership Survey' }));
  await userEvent.click(screen.getByText('Close Survey'));
  expect(await screen.findByText(/Wait for the current update to “Leadership Survey” to finish.*Close is unavailable/)).toBeInTheDocument();
  expect(api.post).not.toHaveBeenCalled();
});

test('an active survey offers status and close, but no launch or reminder bypass', async () => {
  api.post.mockResolvedValue({ status: 200, data: {} });
  const changed = vi.fn();
  render(<SurveyTableMenuCell row={{ id: 'survey-1', name: 'Leadership Survey', lifecycleStatus: 'active' }} onLifecycleChange={changed} />);

  await userEvent.click(screen.getByRole('button', { name: 'Actions for Leadership Survey' }));
  expect(screen.getByText('View Delivery Status')).toBeInTheDocument();
  expect(screen.getByText('Close Survey')).toBeInTheDocument();
  expect(screen.queryByText('Launch Survey')).not.toBeInTheDocument();
  expect(screen.queryByText(/reminder/i)).not.toBeInTheDocument();

  await userEvent.click(screen.getByText('Close Survey'));
  await userEvent.click(screen.getByRole('button', { name: 'Close survey' }));
  await waitFor(() => expect(api.post).toHaveBeenCalledWith('/surveys/survey-1/close'));
  expect(changed).toHaveBeenCalledWith('survey-1');
});
