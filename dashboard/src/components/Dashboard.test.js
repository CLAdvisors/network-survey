import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeProvider } from '@emotion/react';
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
  default: ({ selectRow, selectedSurvey }) => (
    <div>
      <div data-testid="selected-survey">{selectedSurvey?.name || 'none'}</div>
      <button onClick={() => selectRow({ id: 'one', name: 'Survey One' })}>Select one</button>
      <button onClick={() => selectRow({ id: 'two', name: 'Survey Two' })}>Select two</button>
    </div>
  ),
}));
vi.mock('./EmailNotificationEditor', () => ({
  default: ({ onBusyChange }) => <button onClick={() => onBusyChange(true)}>Begin import</button>,
}));
vi.mock('./SurveyContentEditor', () => ({ default: () => null }));
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

test('rejects survey switching with clear feedback while notification save/import is busy', async () => {
  const theme = { palette: { divider: '#ddd', mode: 'light', background: { paper: '#fff' } } };
  render(<ThemeProvider theme={theme}><Dashboard /></ThemeProvider>);
  await userEvent.click(screen.getByRole('button', { name: 'Select one' }));
  await waitFor(() => expect(screen.getByTestId('selected-survey')).toHaveTextContent('Survey One'));

  await userEvent.click(screen.getByRole('button', { name: 'Begin import' }));
  await userEvent.click(screen.getByRole('button', { name: 'Select two' }));

  expect(screen.getByTestId('selected-survey')).toHaveTextContent('Survey One');
  expect(screen.getByText(/wait for the current save or CSV import/i)).toBeInTheDocument();
});
