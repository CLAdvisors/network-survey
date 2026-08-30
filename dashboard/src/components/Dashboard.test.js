import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeProvider as EmotionThemeProvider } from '@emotion/react';
import { createTheme, ThemeProvider } from '@mui/material/styles';
import { beforeEach, expect, test, vi } from 'vitest';
import Dashboard from './Dashboard';
import api from '../api/axios';

vi.mock('../api/axios', () => ({ default: { get: vi.fn(), post: vi.fn() } }));
vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({
    memberships: [{ role: 'editor' }],
    canEditSurvey: (survey) => Boolean(survey),
    canViewSensitiveSurveyData: () => true,
  }),
}));

vi.mock('./SurveyTable', () => ({
  default: ({ rows, selectRow, onSurveyCopied, dirtyBySurvey }) => <div>{(rows || []).map((survey) => (
    <React.Fragment key={survey.id}>
      <button onClick={() => selectRow(survey)}>Select {survey.name}</button>
      <button onClick={() => onSurveyCopied?.({ id: 'survey-copy', name: 'AlphaCopy' })}>Copy {survey.name}</button>
      <span data-testid={`dirty-${survey.id}`}>{Object.keys(dirtyBySurvey?.[survey.id] || {}).sort().join(',')}</span>
    </React.Fragment>
  ))}</div>,
}));
vi.mock('./QuestionTable', () => ({
  default: ({ surveyName, onDirtyChange }) => <button onClick={() => onDirtyChange?.(surveyName, 'questions', true)}>Dirty questions</button>,
}));
vi.mock('./RespondentTable', () => ({
  default: ({ surveyName, onDirtyChange }) => <button onClick={() => onDirtyChange?.(surveyName, 'respondents', true)}>Dirty respondents</button>,
}));
vi.mock('./SurveyLifecyclePanel', () => ({ default: () => null }));
vi.mock('./CreateSurveyDialog', () => ({ default: () => null }));

let mountSequence = 0;
vi.mock('./InvitationSubjectEditor', () => ({
  default: ({ surveyId, readOnly, onDirtyChange }) => {
    const mount = React.useRef(++mountSequence);
    return <div data-testid="subject-editor" data-survey={surveyId} data-readonly={String(readOnly)} data-mount={`subject-${mount.current}`}>Invitation Email Subject<button onClick={() => onDirtyChange?.(surveyId, 'invitationSubject', true)}>Dirty subject</button></div>;
  },
}));
vi.mock('./EmailNotificationEditor', () => ({
  default: ({ surveyId, readOnly, onDirtyChange }) => {
    const mount = React.useRef(++mountSequence);
    return <div data-testid="body-editor" data-survey={surveyId} data-readonly={String(readOnly)} data-mount={`body-${mount.current}`}>Invitation Email Body<button onClick={() => onDirtyChange?.(surveyId, 'invitationBody', true)}>Dirty body</button></div>;
  },
}));

const surveys = [
  { id: 'survey-a', name: 'Alpha', role: 'editor', lifecycleStatus: 'draft' },
  { id: 'survey-b', name: 'Beta', role: 'editor', lifecycleStatus: 'active' },
  { id: 'survey-c', name: 'Gamma', role: 'editor', lifecycleStatus: 'draft' },
];

beforeEach(() => {
  vi.clearAllMocks();
  mountSequence = 0;
  api.get.mockImplementation((url) => {
    if (url === '/surveys') return Promise.resolve({ data: { surveys } });
    if (url.startsWith('/listQuestions')) return Promise.resolve({ data: { questions: [] } });
    return Promise.resolve({ data: [] });
  });
});

test('dirty state remains scoped to its owning survey across every editable section', async () => {
  const theme = createTheme();
  render(<ThemeProvider theme={theme}><EmotionThemeProvider theme={theme}><Dashboard /></EmotionThemeProvider></ThemeProvider>);
  await userEvent.click(await screen.findByRole('button', { name: 'Select Alpha' }));

  await userEvent.click(screen.getByRole('button', { name: 'Dirty subject' }));
  await userEvent.click(screen.getByRole('button', { name: 'Dirty body' }));
  await userEvent.click(screen.getByRole('button', { name: 'Dirty questions' }));
  await userEvent.click(screen.getByRole('button', { name: 'Dirty respondents' }));
  expect(screen.getByTestId('dirty-survey-a')).toHaveTextContent('invitationBody,invitationSubject,questions,respondents');

  await userEvent.click(screen.getByRole('button', { name: 'Select Gamma' }));
  expect(screen.getByTestId('dirty-survey-c')).toBeEmptyDOMElement();
  expect(screen.getByTestId('dirty-survey-a')).toHaveTextContent('invitationBody,invitationSubject,questions,respondents');
});

test('selects a successful copy by returned stable ID and loads its related data', async () => {
  const copied = { id: 'survey-copy', name: 'AlphaCopy', role: 'editor', lifecycleStatus: 'draft' };
  api.get.mockImplementation((url) => {
    if (url === '/surveys') return Promise.resolve({ data: { surveys: [...surveys, copied] } });
    if (url.startsWith('/listQuestions')) return Promise.resolve({ data: { questions: [] } });
    return Promise.resolve({ data: [] });
  });
  const theme = createTheme();
  render(<ThemeProvider theme={theme}><EmotionThemeProvider theme={theme}><Dashboard /></EmotionThemeProvider></ThemeProvider>);

  await userEvent.click(await screen.findByRole('button', { name: 'Copy Alpha' }));
  await waitFor(() => expect(screen.getByTestId('subject-editor')).toHaveAttribute('data-survey', 'survey-copy'));
  expect(api.get).toHaveBeenCalledWith('/listQuestions?surveyName=survey-copy', expect.any(Object));
  expect(api.get).toHaveBeenCalledWith('/targets?surveyName=survey-copy', expect.any(Object));
});

test('repeated survey and lifecycle switches never accumulate or alias email editors', async () => {
  const theme = createTheme();
  render(<ThemeProvider theme={theme}><EmotionThemeProvider theme={theme}><Dashboard /></EmotionThemeProvider></ThemeProvider>);
  await screen.findByRole('button', { name: 'Select Alpha' });

  let subjectMount;
  let bodyMount;
  for (const name of ['Alpha', 'Beta', 'Gamma', 'Alpha', 'Beta', 'Alpha', 'Gamma']) {
    fireEvent.click(screen.getByRole('button', { name: `Select ${name}` }));
    const selected = surveys.find((survey) => survey.name === name);
    await waitFor(() => expect(screen.getByTestId('subject-editor')).toHaveAttribute('data-survey', selected.id));
    expect(screen.getAllByTestId('subject-editor')).toHaveLength(1);
    expect(screen.getAllByTestId('body-editor')).toHaveLength(1);
    subjectMount ||= screen.getByTestId('subject-editor').dataset.mount;
    bodyMount ||= screen.getByTestId('body-editor').dataset.mount;
    expect(screen.getByTestId('subject-editor')).toHaveAttribute('data-mount', subjectMount);
    expect(screen.getByTestId('body-editor')).toHaveAttribute('data-mount', bodyMount);
    expect(subjectMount).toMatch(/^subject-/);
    expect(bodyMount).toMatch(/^body-/);
    expect(subjectMount).not.toBe(bodyMount);
    expect(screen.getByTestId('subject-editor')).toHaveAttribute('data-readonly', String(name === 'Beta'));
    expect(screen.getByTestId('body-editor')).toHaveAttribute('data-readonly', String(name === 'Beta'));
  }
});
