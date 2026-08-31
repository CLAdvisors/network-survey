import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeProvider as EmotionThemeProvider } from '@emotion/react';
import { createTheme, ThemeProvider } from '@mui/material/styles';
import { beforeEach, expect, test, vi } from 'vitest';
import Dashboard from './Dashboard';
import api from '../api/axios';
import { advanceSurveyOperationGeneration } from './useSurveyOperationState';

vi.mock('../api/axios', () => ({ default: { get: vi.fn(), post: vi.fn() } }));
const authAccess = vi.hoisted(() => ({
  canEditSurvey: (survey) => Boolean(survey) && survey.role !== 'viewer',
  canViewSensitiveSurveyData: (survey) => Boolean(survey) && survey.role !== 'viewer',
}));
vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ memberships: [{ role: 'editor' }], ...authAccess }),
}));

vi.mock('./SurveyTable', () => ({
  default: ({ rows, selectRow, onSurveyCopied, dirtyBySurvey }) => <div>{(rows || []).map((survey) => (
    <React.Fragment key={survey.id}>
      <button onClick={() => selectRow(survey)}>Select {survey.name}</button>
      <button onClick={() => onSurveyCopied?.({ id: 'survey-copy', name: 'AlphaCopy' })}>Copy {survey.name}</button>
      <span data-testid={`dirty-${survey.id}`}>{Object.keys(dirtyBySurvey?.[survey.id] || {}).sort().join(',')}</span>
      <span data-testid={`respondent-count-${survey.id}`}>{survey.respondents}</span>
    </React.Fragment>
  ))}</div>,
}));
vi.mock('./QuestionTable', () => ({
  default: ({ rows, surveyName, onDirtyChange, onSurveyDataChanged }) => <>
    <span data-testid="question-data">{rows?.map((row) => row.text).join(',') || 'none'}</span>
    <button onClick={() => onDirtyChange?.(surveyName, 'questions', true)}>Dirty questions</button>
    <button onClick={() => onSurveyDataChanged?.()}>Refresh after question change</button>
  </>,
}));
vi.mock('./RespondentTable', () => ({
  default: ({ surveyName, loading, loadError, onRetry, onDirtyChange, onSurveyDataChanged }) => <>
    <span data-testid="respondent-loading">{String(Boolean(loading))}</span>
    <span data-testid="respondent-error">{loadError || ''}</span>
    {loadError && <button onClick={onRetry}>Retry respondents</button>}
    <button onClick={() => onDirtyChange?.(surveyName, 'respondents', true)}>Dirty respondents</button>
    <button onClick={() => onSurveyDataChanged?.()}>Refresh after respondent change</button>
  </>,
}));
vi.mock('./SurveyLifecyclePanel', () => ({ default: () => null }));
vi.mock('./CreateSurveyDialog', () => ({ default: () => null }));

let mountSequence = 0;
vi.mock('./InvitationSubjectEditor', () => ({
  default: ({ surveyId, readOnly, onDirtyChange, onOperationChange }) => {
    const mount = React.useRef(++mountSequence);
    return <div data-testid="subject-editor" data-survey={surveyId} data-readonly={String(readOnly)} data-mount={`subject-${mount.current}`}>Invitation Email Subject<button onClick={() => onDirtyChange?.(surveyId, 'invitationSubject', true)}>Dirty subject</button><button onClick={() => onOperationChange?.(surveyId, 'invitationSubject', true)}>Start subject operation</button></div>;
  },
}));
vi.mock('./EmailNotificationEditor', () => ({
  default: ({ surveyId, readOnly, onDirtyChange }) => {
    const mount = React.useRef(++mountSequence);
    return <div data-testid="body-editor" data-survey={surveyId} data-readonly={String(readOnly)} data-mount={`body-${mount.current}`}>Invitation Email Body<button onClick={() => onDirtyChange?.(surveyId, 'invitationBody', true)}>Dirty body</button></div>;
  },
}));

const deferred = () => {
  let resolve;
  const promise = new Promise((yes) => { resolve = yes; });
  return { promise, resolve };
};

const surveys = [
  { id: 'survey-a', name: 'Alpha', role: 'editor', lifecycleStatus: 'draft' },
  { id: 'survey-b', name: 'Beta', role: 'editor', lifecycleStatus: 'active' },
  { id: 'survey-c', name: 'Gamma', role: 'editor', lifecycleStatus: 'draft' },
  { id: 'survey-d', name: 'Delta', role: 'viewer', lifecycleStatus: 'draft' },
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

test('surfaces respondent load failures and retries before permitting edits', async () => {
  let targetLoads = 0;
  api.get.mockImplementation((url) => {
    if (url === '/surveys') return Promise.resolve({ data: { surveys } });
    if (url.startsWith('/listQuestions')) return Promise.resolve({ data: { questions: [] } });
    if (url.startsWith('/targets')) {
      targetLoads += 1;
      return targetLoads === 1
        ? Promise.reject(new Error('targets unavailable'))
        : Promise.resolve({ data: [{ id: 1, name: 'Loaded Person' }] });
    }
    return Promise.resolve({ data: [] });
  });

  const theme = createTheme();
  render(<ThemeProvider theme={theme}><EmotionThemeProvider theme={theme}><Dashboard /></EmotionThemeProvider></ThemeProvider>);
  await userEvent.click(await screen.findByRole('button', { name: 'Select Alpha' }));

  await waitFor(() => expect(screen.getByTestId('respondent-error')).toHaveTextContent('Unable to load survey respondents'));
  await userEvent.click(screen.getByRole('button', { name: 'Retry respondents' }));
  await waitFor(() => {
    expect(targetLoads).toBeGreaterThanOrEqual(2);
    expect(screen.getByTestId('respondent-error')).toBeEmptyDOMElement();
    expect(screen.getByTestId('respondent-loading')).toHaveTextContent('false');
  });
});

test('keeps owning editor instances and scoped drafts while visiting a survey without edit access', async () => {
  const theme = createTheme();
  render(<ThemeProvider theme={theme}><EmotionThemeProvider theme={theme}><Dashboard /></EmotionThemeProvider></ThemeProvider>);
  await userEvent.click(await screen.findByRole('button', { name: 'Select Alpha' }));
  const subjectMount = screen.getByTestId('subject-editor').dataset.mount;
  await userEvent.click(screen.getByRole('button', { name: 'Dirty subject' }));
  await userEvent.click(screen.getByRole('button', { name: 'Dirty respondents' }));

  await userEvent.click(screen.getByRole('button', { name: 'Select Delta' }));
  expect(screen.getByTestId('dirty-survey-a')).toHaveTextContent('invitationSubject,respondents');
  await userEvent.click(screen.getByRole('button', { name: 'Select Alpha' }));
  expect(screen.getByTestId('subject-editor')).toHaveAttribute('data-mount', subjectMount);
  expect(screen.getByTestId('dirty-survey-a')).toHaveTextContent('invitationSubject,respondents');
});

test('keeps an editor mounted while its owning survey operation is pending', async () => {
  const theme = createTheme();
  render(<ThemeProvider theme={theme}><EmotionThemeProvider theme={theme}><Dashboard /></EmotionThemeProvider></ThemeProvider>);
  await userEvent.click(await screen.findByRole('button', { name: 'Select Alpha' }));
  const subjectMount = screen.getByTestId('subject-editor').dataset.mount;
  await userEvent.click(screen.getByRole('button', { name: 'Start subject operation' }));

  await userEvent.click(screen.getByRole('button', { name: 'Select Delta' }));
  await userEvent.click(screen.getByRole('button', { name: 'Select Alpha' }));
  expect(screen.getByTestId('subject-editor')).toHaveAttribute('data-mount', subjectMount);
});

test('selects a successful copy by returned stable ID and loads its related data', async () => {
  const copied = { id: 'survey-copy', name: 'AlphaCopy', role: 'editor', lifecycleStatus: 'draft', respondents: '0' };
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
  expect(screen.getByTestId('respondent-count-survey-copy')).toHaveTextContent('0');
});

test('retries related question data loaded before a successful mutation generation', async () => {
  const staleQuestions = deferred();
  let questionLoads = 0;
  api.get.mockImplementation((url) => {
    if (url === '/surveys') return Promise.resolve({ data: { surveys } });
    if (url.startsWith('/listQuestions')) {
      questionLoads += 1;
      return questionLoads === 1
        ? staleQuestions.promise
        : Promise.resolve({ data: { questions: [{ text: 'Fresh question' }] } });
    }
    return Promise.resolve({ data: [] });
  });

  const theme = createTheme();
  render(<ThemeProvider theme={theme}><EmotionThemeProvider theme={theme}><Dashboard /></EmotionThemeProvider></ThemeProvider>);
  await userEvent.click(await screen.findByRole('button', { name: 'Select Alpha' }));
  await waitFor(() => expect(api.get).toHaveBeenCalledWith('/listQuestions?surveyName=survey-a', expect.any(Object)));
  advanceSurveyOperationGeneration('questions', 'survey-a');
  staleQuestions.resolve({ data: { questions: [{ text: 'Stale question' }] } });

  await waitFor(() => expect(screen.getByTestId('question-data')).toHaveTextContent('Fresh question'));
  expect(screen.getByTestId('question-data')).not.toHaveTextContent('Stale question');
  expect(questionLoads).toBeGreaterThanOrEqual(2);
});

test('child mutations cannot replace a newer lifecycle lock with a delayed survey response', async () => {
  const delayedDraftRefresh = deferred();
  const activeSurveys = surveys.map((survey) => survey.id === 'survey-a'
    ? { ...survey, lifecycleStatus: 'active' }
    : survey);
  let surveyFetch = 0;
  api.get.mockImplementation((url) => {
    if (url === '/surveys') {
      surveyFetch += 1;
      if (surveyFetch === 1) return Promise.resolve({ data: { surveys } });
      if (surveyFetch === 2) return delayedDraftRefresh.promise;
      return Promise.resolve({ data: { surveys: activeSurveys } });
    }
    if (url.startsWith('/listQuestions')) return Promise.resolve({ data: { questions: [] } });
    return Promise.resolve({ data: [] });
  });

  const theme = createTheme();
  render(<ThemeProvider theme={theme}><EmotionThemeProvider theme={theme}><Dashboard /></EmotionThemeProvider></ThemeProvider>);
  await userEvent.click(await screen.findByRole('button', { name: 'Select Alpha' }));
  expect(screen.getByTestId('subject-editor')).toHaveAttribute('data-readonly', 'false');

  fireEvent.click(screen.getByRole('button', { name: 'Refresh after question change' }));
  fireEvent.click(screen.getByRole('button', { name: 'Refresh after respondent change' }));
  await waitFor(() => expect(screen.getByTestId('subject-editor')).toHaveAttribute('data-readonly', 'true'));
  delayedDraftRefresh.resolve({ data: { surveys } });
  await waitFor(() => expect(screen.getByTestId('subject-editor')).toHaveAttribute('data-readonly', 'true'));

  expect(screen.getByTestId('subject-editor')).toHaveAttribute('data-readonly', 'true');
  expect(api.get.mock.calls.filter(([url]) => url === '/surveys')).toHaveLength(3);
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
