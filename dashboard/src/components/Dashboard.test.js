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
    canViewSensitiveSurveyData: () => false,
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
vi.mock('./QuestionTable', () => ({ default: () => null }));
vi.mock('./RespondentTable', () => ({ default: () => null }));
vi.mock('./CreateSurveyDialog', () => ({ default: () => null }));

beforeEach(() => {
  vi.clearAllMocks();
  api.get.mockImplementation(async (url) => {
    if (url === '/surveys') return { data: { surveys: [] } };
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
