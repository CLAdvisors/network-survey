import React from 'react';
import { readFileSync } from 'node:fs';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeProvider as EmotionThemeProvider } from '@emotion/react';
import { createTheme, ThemeProvider } from '@mui/material/styles';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';
import { beforeEach, expect, test, vi } from 'vitest';
import Dashboard from './Dashboard';
import api from '../api/axios';
import { advanceSurveyOperationGeneration } from './useSurveyOperationState';

vi.mock('../api/axios', () => ({ default: { get: vi.fn(), post: vi.fn() } }));
const authAccess = vi.hoisted(() => ({
  canEditSurvey: (survey) => Boolean(survey) && survey.role !== 'viewer',
  canViewSensitiveSurveyData: (survey) => Boolean(survey) && survey.role !== 'viewer',
  hasSurveyRole: () => false,
}));
vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ memberships: [{ role: 'editor' }], ...authAccess }),
}));

vi.mock('./SurveyTable', () => ({
  default: ({ rows, selectRow, onSurveyCopied, dirtyBySurvey }) => <div>{(rows || []).map((survey) => (
    <React.Fragment key={survey.id}>
      <button onClick={() => selectRow(survey)}>Select {survey.name}</button>
      <button onClick={() => onSurveyCopied?.({ id: 'survey-copy', name: 'AlphaCopy' })}>Copy {survey.name}</button>
      <span data-testid={`list-dirty-${survey.id}`}>{Object.keys(dirtyBySurvey?.[survey.id] || {}).sort().join(',')}</span>
    </React.Fragment>
  ))}</div>,
}));

// The workspace action menu surfaces the owning survey's unsaved/pending state;
// the mock keeps those indicators observable while a survey is being edited.
vi.mock('./SurveyTableMenuCell', () => ({
  default: ({ row, onSurveyCopied, unsavedChanges = {}, pendingOperations = {} }) => (
    <div data-testid="workspace-menu" data-survey={row?.id}>
      <span data-testid={`dirty-${row?.id}`}>{Object.keys(unsavedChanges).sort().join(',')}</span>
      <span data-testid={`pending-${row?.id}`}>{Object.keys(pendingOperations).sort().join(',')}</span>
      <span data-testid={`respondent-count-${row?.id}`}>{row?.respondents}</span>
      <button onClick={() => onSurveyCopied?.({ id: 'survey-copy', name: 'AlphaCopy' })}>Copy {row?.name}</button>
    </div>
  ),
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
vi.mock('./EmailHistory', () => ({ default: ({ survey }) => <div data-testid="email-history" data-survey={survey?.id}>Email history</div> }));
vi.mock('./CreateSurveyDialog', () => ({ default: () => null }));

let mountSequence = 0;
vi.mock('./SurveyInstructionsEditor', () => ({
  default: ({ surveyId, readOnly, readOnlyMessage, onDirtyChange, onOperationChange }) => <div data-testid="instructions-editor" data-survey={surveyId} data-readonly={String(readOnly)} data-readonly-message={readOnlyMessage || ''}>Survey Instructions<button onClick={() => onDirtyChange?.(surveyId, 'instructions', true)}>Dirty instructions</button><button onClick={() => onOperationChange?.(surveyId, 'instructions', true)}>Start instructions operation</button></div>,
}));
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

const theme = createTheme();

// Drives survey selection the way the real application does: by workspace URL.
const Harness = () => {
  const navigate = useNavigate();
  return (
    <>
      {surveys.map((survey) => (
        <button key={survey.id} onClick={() => navigate(`/surveys/${survey.id}/overview`)}>{`Open ${survey.id}`}</button>
      ))}
      <button onClick={() => navigate('/')}>Open list</button>
      <Routes>
        <Route path="*" element={<Dashboard />} />
      </Routes>
    </>
  );
};

const renderDashboard = () => render(
  <ThemeProvider theme={theme}>
    <EmotionThemeProvider theme={theme}>
      <MemoryRouter initialEntries={['/']}>
        <Harness />
      </MemoryRouter>
    </EmotionThemeProvider>
  </ThemeProvider>,
);

beforeEach(() => {
  vi.clearAllMocks();
  authAccess.canEditSurvey = (survey) => Boolean(survey) && survey.role !== 'viewer';
  authAccess.canViewSensitiveSurveyData = (survey) => Boolean(survey) && survey.role !== 'viewer';
  authAccess.hasSurveyRole = () => false;
  mountSequence = 0;
  api.get.mockImplementation((url) => {
    if (url === '/surveys') return Promise.resolve({ data: { surveys } });
    if (url.startsWith('/listQuestions')) return Promise.resolve({ data: { questions: [] } });
    return Promise.resolve({ data: [] });
  });
});

test('keeps dashboard spacing bounded on narrow viewports', () => {
  const source = readFileSync('src/components/Dashboard.js', 'utf8');
  expect(source).toMatch(/px: \{ xs: 1\.5, sm: 3, md: 4 \}/);
  expect(source).not.toMatch(/padding: "40px"|marginLeft: "13%"|md: '13%'/);
});

test('renders the visual survey list with search and lifecycle filters', async () => {
  renderDashboard();
  expect(await screen.findByRole('heading', { name: 'Surveys' })).toBeInTheDocument();
  await screen.findByRole('button', { name: 'Select Alpha' });

  await userEvent.type(screen.getByRole('textbox', { name: 'Search surveys' }), 'beta');
  expect(screen.queryByRole('button', { name: 'Select Alpha' })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Select Beta' })).toBeInTheDocument();

  await userEvent.clear(screen.getByRole('textbox', { name: 'Search surveys' }));
  await userEvent.click(screen.getByRole('button', { name: 'Launched' }));
  expect(screen.getByRole('button', { name: 'Select Beta' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Select Alpha' })).not.toBeInTheDocument();
});

test('selecting a survey opens its workspace at a stable URL', async () => {
  renderDashboard();
  await userEvent.click(await screen.findByRole('button', { name: 'Select Alpha' }));
  expect(await screen.findByTestId('survey-workspace')).toHaveAttribute('aria-label', 'Alpha workspace');
  expect(screen.getByRole('heading', { name: 'Alpha' })).toBeInTheDocument();
});

test('shows email history only to users already authorized for the selected survey roster', async () => {
  renderDashboard();
  await userEvent.click(await screen.findByRole('button', { name: 'Select Alpha' }));
  expect(await screen.findByTestId('email-history')).toHaveAttribute('data-survey', 'survey-a');
  await userEvent.click(screen.getByRole('button', { name: 'Open survey-d' }));
  await waitFor(() => expect(screen.queryByTestId('email-history')).not.toBeInTheDocument());
});

test('dirty state remains scoped to its owning survey across every editable section', async () => {
  renderDashboard();
  await userEvent.click(await screen.findByRole('button', { name: 'Select Alpha' }));

  await userEvent.click(screen.getByRole('button', { name: 'Dirty instructions', hidden: true }));
  await userEvent.click(screen.getByRole('button', { name: 'Dirty subject', hidden: true }));
  await userEvent.click(screen.getByRole('button', { name: 'Dirty body', hidden: true }));
  await userEvent.click(screen.getByRole('button', { name: 'Dirty questions', hidden: true }));
  await userEvent.click(screen.getByRole('button', { name: 'Dirty respondents', hidden: true }));
  expect(await screen.findByTestId('dirty-survey-a')).toHaveTextContent('instructions,invitationBody,invitationSubject,questions,respondents');

  await userEvent.click(screen.getByRole('button', { name: 'Open survey-c' }));
  await waitFor(() => expect(screen.getByTestId('dirty-survey-c')).toBeEmptyDOMElement());
  expect(screen.queryByTestId('dirty-survey-a')).not.toBeInTheDocument();

  await userEvent.click(screen.getByRole('button', { name: 'Open survey-a' }));
  await waitFor(() => expect(screen.getByTestId('dirty-survey-a')).toHaveTextContent('instructions,invitationBody,invitationSubject,questions,respondents'));
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

  renderDashboard();
  await userEvent.click(await screen.findByRole('button', { name: 'Select Alpha' }));

  await waitFor(() => expect(screen.getByTestId('respondent-error')).toHaveTextContent('Unable to load survey respondents'));
  await userEvent.click(screen.getByRole('button', { name: 'Retry respondents', hidden: true }));
  await waitFor(() => {
    expect(targetLoads).toBeGreaterThanOrEqual(2);
    expect(screen.getByTestId('respondent-error')).toBeEmptyDOMElement();
    expect(screen.getByTestId('respondent-loading')).toHaveTextContent('false');
  });
});

test('keeps owning editor instances and scoped drafts while visiting a survey without edit access', async () => {
  renderDashboard();
  await userEvent.click(await screen.findByRole('button', { name: 'Select Alpha' }));
  const subjectMount = screen.getByTestId('subject-editor').dataset.mount;
  await userEvent.click(screen.getByRole('button', { name: 'Dirty subject', hidden: true }));
  await userEvent.click(screen.getByRole('button', { name: 'Dirty respondents', hidden: true }));

  await userEvent.click(screen.getByRole('button', { name: 'Open survey-d' }));
  await userEvent.click(screen.getByRole('button', { name: 'Open survey-a' }));
  expect(await screen.findByTestId('dirty-survey-a')).toHaveTextContent('invitationSubject,respondents');
  expect(screen.getByTestId('subject-editor')).toHaveAttribute('data-mount', subjectMount);
});

test('keeps an editor mounted while its owning survey operation is pending', async () => {
  renderDashboard();
  await userEvent.click(await screen.findByRole('button', { name: 'Select Alpha' }));
  const subjectMount = screen.getByTestId('subject-editor').dataset.mount;
  await userEvent.click(screen.getByRole('button', { name: 'Start subject operation', hidden: true }));
  expect(await screen.findByTestId('pending-survey-a')).toHaveTextContent('invitationSubject');

  await userEvent.click(screen.getByRole('button', { name: 'Open survey-d' }));
  await userEvent.click(screen.getByRole('button', { name: 'Open survey-a' }));
  expect(await screen.findByTestId('subject-editor')).toHaveAttribute('data-mount', subjectMount);
});

test('switching workspace tabs preserves an unsaved editor draft', async () => {
  renderDashboard();
  await userEvent.click(await screen.findByRole('button', { name: 'Select Alpha' }));
  const subjectMount = screen.getByTestId('subject-editor').dataset.mount;
  await userEvent.click(screen.getByRole('button', { name: 'Dirty subject', hidden: true }));

  await userEvent.click(screen.getByRole('button', { name: 'Content' }));
  await userEvent.click(screen.getByRole('button', { name: 'Overview' }));
  expect(screen.getByTestId('subject-editor')).toHaveAttribute('data-mount', subjectMount);
  expect(screen.getByTestId('dirty-survey-a')).toHaveTextContent('invitationSubject');
});

test('selects a successful copy by returned stable ID and loads its related data', async () => {
  const copied = { id: 'survey-copy', name: 'AlphaCopy', role: 'editor', lifecycleStatus: 'draft', respondents: '0' };
  api.get.mockImplementation((url) => {
    if (url === '/surveys') return Promise.resolve({ data: { surveys: [...surveys, copied] } });
    if (url.startsWith('/listQuestions')) return Promise.resolve({ data: { questions: [] } });
    return Promise.resolve({ data: [] });
  });
  renderDashboard();

  await userEvent.click(await screen.findByRole('button', { name: 'Select Alpha' }));
  await userEvent.click(await screen.findByRole('button', { name: 'Copy Alpha' }));
  await waitFor(() => expect(screen.getByTestId('subject-editor')).toHaveAttribute('data-survey', 'survey-copy'));
  await waitFor(() => expect(api.get).toHaveBeenCalledWith('/listQuestions?surveyName=survey-copy', expect.any(Object)));
  await waitFor(() => expect(api.get).toHaveBeenCalledWith('/targets?surveyName=survey-copy', expect.any(Object)));
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

  renderDashboard();
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

  renderDashboard();
  await userEvent.click(await screen.findByRole('button', { name: 'Select Alpha' }));
  expect(screen.getByTestId('subject-editor')).toHaveAttribute('data-readonly', 'false');

  fireEvent.click(screen.getByRole('button', { name: 'Refresh after question change', hidden: true }));
  fireEvent.click(screen.getByRole('button', { name: 'Refresh after respondent change', hidden: true }));
  await waitFor(() => expect(screen.getByTestId('subject-editor')).toHaveAttribute('data-readonly', 'true'));
  delayedDraftRefresh.resolve({ data: { surveys } });
  await waitFor(() => expect(screen.getByTestId('subject-editor')).toHaveAttribute('data-readonly', 'true'));
  expect(api.get.mock.calls.filter(([url]) => url === '/surveys')).toHaveLength(3);
});

test('uses launched terminology in lifecycle lock messaging while retaining active state logic', async () => {
  renderDashboard();
  await userEvent.click(await screen.findByRole('button', { name: 'Select Beta' }));

  expect(screen.getByTestId('instructions-editor')).toHaveAttribute(
    'data-readonly-message',
    'Instructions are read-only while this survey is launched.',
  );
  expect(screen.getByText('Questions are read-only while this survey is launched.', { hidden: true })).toBeInTheDocument();
  expect(screen.getByText('Respondent identities are read-only while this survey is launched.', { hidden: true })).toBeInTheDocument();
  expect(screen.getByTestId('subject-editor')).toHaveAttribute('data-readonly', 'true');
});

test('repeated survey and lifecycle switches never accumulate or alias email editors', async () => {
  renderDashboard();
  await screen.findByRole('button', { name: 'Select Alpha' });

  let subjectMount;
  let bodyMount;
  for (const id of ['survey-a', 'survey-b', 'survey-c', 'survey-a', 'survey-b', 'survey-a', 'survey-c']) {
    await userEvent.click(screen.getByRole('button', { name: `Open ${id}` }));
    await waitFor(() => expect(screen.getByTestId('subject-editor')).toHaveAttribute('data-survey', id));
    expect(screen.getAllByTestId('subject-editor')).toHaveLength(1);
    expect(screen.getAllByTestId('body-editor')).toHaveLength(1);
    subjectMount ||= screen.getByTestId('subject-editor').dataset.mount;
    bodyMount ||= screen.getByTestId('body-editor').dataset.mount;
    expect(screen.getByTestId('subject-editor')).toHaveAttribute('data-mount', subjectMount);
    expect(screen.getByTestId('body-editor')).toHaveAttribute('data-mount', bodyMount);
    expect(subjectMount).toMatch(/^subject-/);
    expect(bodyMount).toMatch(/^body-/);
    expect(subjectMount).not.toBe(bodyMount);
    expect(screen.getByTestId('subject-editor')).toHaveAttribute('data-readonly', String(id === 'survey-b'));
    expect(screen.getByTestId('body-editor')).toHaveAttribute('data-readonly', String(id === 'survey-b'));
  }
});
