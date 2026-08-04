import React from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeProvider } from '@emotion/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import Dashboard from './Dashboard';
import api from '../api/axios';

vi.mock('../api/axios', () => ({
  default: { get: vi.fn(), post: vi.fn() },
}));
vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({
    memberships: [{ role: 'editor' }],
    canViewSensitiveSurveyData: () => true,
    canEditSurvey: () => true,
  }),
}));
vi.mock('./CollapsibleSection', () => ({ default: ({ children }) => <div>{children}</div> }));
vi.mock('./SurveyTable', () => ({
  default: ({ selectRow, selectedSurvey, guardSurveyAction }) => (
    <div>
      <div data-testid="selected-survey">{selectedSurvey?.name || 'none'}</div>
      <button onClick={() => selectRow({ id: 'one', name: 'Survey One' })}>Select one</button>
      <button onClick={() => selectRow({ id: 'two', name: 'Survey Two' })}>Select two</button>
      <button onClick={() => guardSurveyAction(selectedSurvey)}>Act on selected</button>
      <button onClick={() => guardSurveyAction({ id: 'other', name: 'Other' })}>Act on other</button>
    </div>
  ),
}));
vi.mock('./EmailNotificationEditor', () => ({
  default: ({ onBusyChange }) => <button onClick={() => onBusyChange(true)}>Begin import</button>,
}));
vi.mock('./SurveyContentEditor', () => ({
  default: ({ onDirtyChange }) => <button onClick={() => onDirtyChange(true)}>Edit content</button>,
}));
vi.mock('./QuestionTable', () => ({
  default: ({ rows, onDirtyChange, onBusyChange }) => (
    <div>
      <div data-testid="question-rows">{JSON.stringify(rows)}</div>
      <button onClick={() => onDirtyChange(true)}>Edit question</button>
      <button onClick={() => onBusyChange(true)}>Save question</button>
    </div>
  ),
}));
vi.mock('./RespondentTable', () => ({
  default: ({ rows, onDirtyChange, onBusyChange }) => (
    <div>
      <div data-testid="respondent-rows">{JSON.stringify(rows)}</div>
      <button onClick={() => onDirtyChange(true)}>Edit respondent</button>
      <button onClick={() => onBusyChange(true)}>Save respondent</button>
    </div>
  ),
}));
vi.mock('./CreateSurveyDialog', () => ({ default: () => null }));

beforeEach(() => {
  vi.clearAllMocks();
  api.get.mockImplementation(async (url) => {
    if (url === '/surveys') return { data: { surveys: [] } };
    if (url.startsWith('/targets')) return { data: [] };
    return { data: { questions: [] } };
  });
});

const renderDashboard = (routerOptions = {}) => {
  const theme = { palette: { divider: '#ddd', mode: 'light', background: { paper: '#fff' } } };
  const router = createMemoryRouter([
    { path: '/', element: <Dashboard /> },
    { path: '/settings', element: <div>Settings page</div> },
  ], routerOptions);
  const rendered = render(<ThemeProvider theme={theme}><RouterProvider router={router} /></ThemeProvider>);
  return { ...rendered, router };
};

test('rapid survey switching cannot apply stale question or respondent fetches', async () => {
  const deferred = () => {
    let resolve;
    const promise = new Promise((done) => { resolve = done; });
    return { promise, resolve };
  };
  const oneQuestions = deferred();
  const twoQuestions = deferred();
  const oneTargets = deferred();
  const twoTargets = deferred();
  api.get.mockImplementation((url) => {
    if (url === '/surveys') return Promise.resolve({ data: { surveys: [] } });
    if (url.includes('listQuestions?surveyName=one')) return oneQuestions.promise;
    if (url.includes('listQuestions?surveyName=two')) return twoQuestions.promise;
    if (url.includes('targets?surveyName=one')) return oneTargets.promise;
    if (url.includes('targets?surveyName=two')) return twoTargets.promise;
    throw new Error(`Unexpected URL ${url}`);
  });

  renderDashboard();
  await userEvent.click(screen.getByRole('button', { name: 'Select one' }));
  await userEvent.click(screen.getByRole('button', { name: 'Select two' }));
  expect(screen.getByTestId('question-rows')).toHaveTextContent('null');
  expect(screen.getByTestId('respondent-rows')).toHaveTextContent('null');

  twoQuestions.resolve({ data: { questions: [{ text: 'two question' }] } });
  await waitFor(() => expect(screen.getByTestId('question-rows')).toHaveTextContent('two question'));
  twoTargets.resolve({ data: [{ name: 'Two Respondent' }] });
  await waitFor(() => expect(screen.getByTestId('respondent-rows')).toHaveTextContent('Two Respondent'));

  oneQuestions.resolve({ data: { questions: [{ text: 'stale one question' }] } });
  oneTargets.resolve({ data: [{ name: 'Stale One Respondent' }] });
  await act(async () => { await Promise.resolve(); });
  expect(screen.getByTestId('question-rows')).not.toHaveTextContent('stale one question');
  expect(screen.getByTestId('respondent-rows')).not.toHaveTextContent('Stale One Respondent');
});

test('rejects survey switching with clear feedback while notification save/import is busy', async () => {
  renderDashboard();
  await userEvent.click(screen.getByRole('button', { name: 'Select one' }));
  await waitFor(() => expect(screen.getByTestId('selected-survey')).toHaveTextContent('Survey One'));

  await userEvent.click(screen.getByRole('button', { name: 'Begin import' }));
  await userEvent.click(screen.getByRole('button', { name: 'Select two' }));

  expect(screen.getByTestId('selected-survey')).toHaveTextContent('Survey One');
  expect(screen.getByText(/wait for the current save or CSV import/i)).toBeInTheDocument();
});

test('refuses data-router navigation and browser unload while an import is busy', async () => {
  const { router } = renderDashboard();
  await userEvent.click(screen.getByRole('button', { name: 'Select one' }));
  await userEvent.click(screen.getByRole('button', { name: 'Begin import' }));

  act(() => { void router.navigate('/settings'); });
  expect(await screen.findByText(/before leaving the dashboard/i)).toBeInTheDocument();
  expect(router.state.location.pathname).toBe('/');

  const unloadEvent = new Event('beforeunload', { cancelable: true });
  let unloadAllowed;
  act(() => { unloadAllowed = window.dispatchEvent(unloadEvent); });
  expect(unloadAllowed).toBe(false);
});

test('retains survey-switch confirmation and blocks selected-survey actions for dirty drafts', async () => {
  renderDashboard();
  await userEvent.click(screen.getByRole('button', { name: 'Select one' }));
  await userEvent.click(screen.getByRole('button', { name: 'Edit content' }));
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);

  await userEvent.click(screen.getByRole('button', { name: 'Select two' }));
  expect(screen.getByTestId('selected-survey')).toHaveTextContent('Survey One');
  expect(confirm).toHaveBeenCalledWith('Discard unsaved changes and switch surveys?');

  await userEvent.click(screen.getByRole('button', { name: 'Act on selected' }));
  expect(screen.getByText(/Save or reset unsaved changes before starting or archiving/i)).toBeInTheDocument();

  // The guard only applies to the survey whose editors own the dirty draft.
  await userEvent.click(screen.getByRole('button', { name: 'Act on other' }));
  confirm.mockRestore();
});

test.each([
  ['question', 'Edit question'],
  ['respondent', 'Edit respondent'],
])('includes dirty %s table edits in survey switching and start/archive guards', async (_editor, buttonName) => {
  renderDashboard();
  await userEvent.click(screen.getByRole('button', { name: 'Select one' }));
  await userEvent.click(screen.getByRole('button', { name: buttonName }));
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);

  await userEvent.click(screen.getByRole('button', { name: 'Select two' }));
  expect(screen.getByTestId('selected-survey')).toHaveTextContent('Survey One');
  expect(confirm).toHaveBeenCalledWith('Discard unsaved changes and switch surveys?');

  await userEvent.click(screen.getByRole('button', { name: 'Act on selected' }));
  expect(screen.getByText(/Save or reset unsaved changes before starting or archiving/i)).toBeInTheDocument();
  confirm.mockRestore();
});

test('respondent saves block starting so stale local recipient edits cannot be used', async () => {
  renderDashboard();
  await userEvent.click(screen.getByRole('button', { name: 'Select one' }));
  await userEvent.click(screen.getByRole('button', { name: 'Save respondent' }));
  await userEvent.click(screen.getByRole('button', { name: 'Act on selected' }));
  expect(screen.getByText(/wait for the current save or CSV import.*starting or archiving/i)).toBeInTheDocument();
});

test('reselecting the current survey preserves dirty navigation and action protection', async () => {
  const { router } = renderDashboard();
  await userEvent.click(screen.getByRole('button', { name: 'Select one' }));
  await userEvent.click(screen.getByRole('button', { name: 'Edit content' }));

  await userEvent.click(screen.getByRole('button', { name: 'Select one' }));
  await userEvent.click(screen.getByRole('button', { name: 'Act on selected' }));
  expect(screen.getByText(/Save or reset unsaved changes before starting or archiving/i)).toBeInTheDocument();

  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
  act(() => { void router.navigate('/settings'); });
  await waitFor(() => expect(confirm).toHaveBeenCalledWith('Discard unsaved changes and leave the dashboard?'));
  expect(router.state.location.pathname).toBe('/');
  confirm.mockRestore();
});

test('allows or cancels data-router navigation from a dirty draft based on confirmation', async () => {
  const { router } = renderDashboard();
  await userEvent.click(screen.getByRole('button', { name: 'Select one' }));
  await userEvent.click(screen.getByRole('button', { name: 'Edit content' }));
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);

  act(() => { void router.navigate('/settings'); });
  await waitFor(() => expect(confirm).toHaveBeenCalledTimes(1));
  expect(router.state.location.pathname).toBe('/');
  confirm.mockReturnValue(true);
  act(() => { void router.navigate('/settings'); });
  await waitFor(() => expect(router.state.location.pathname).toBe('/settings'));
  confirm.mockRestore();
});

test('blocks POP history navigation while busy', async () => {
  const { router } = renderDashboard({ initialEntries: ['/settings', '/'], initialIndex: 1 });
  await userEvent.click(screen.getByRole('button', { name: 'Select one' }));
  await userEvent.click(screen.getByRole('button', { name: 'Begin import' }));

  act(() => { void router.navigate(-1); });
  expect(await screen.findByText(/before leaving the dashboard/i)).toBeInTheDocument();
  expect(router.state.location.pathname).toBe('/');
});
