import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeProvider as EmotionThemeProvider } from '@emotion/react';
import { createTheme, ThemeProvider } from '@mui/material/styles';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';
import { beforeEach, expect, test, vi } from 'vitest';
import Dashboard from './Dashboard';
import api from '../api/axios';

// This file keeps the REAL InvitationSubjectEditor mounted (unlike Dashboard.test.js)
// to prove that an actual editor's unsaved draft survives leaving to the list and
// reopening the same survey.
vi.mock('../api/axios', () => ({ default: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() } }));
const stableAuth = vi.hoisted(() => ({
  canEditSurvey: (survey) => Boolean(survey) && survey.role !== 'viewer',
  canViewSensitiveSurveyData: (survey) => Boolean(survey) && survey.role !== 'viewer',
  hasSurveyRole: () => false,
}));
vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ memberships: [{ role: 'editor' }], ...stableAuth }),
}));

vi.mock('./SurveyTable', () => ({
  default: ({ rows, selectRow }) => <div>{(rows || []).map((survey) => (
    <button key={survey.id} onClick={() => selectRow(survey)}>Select {survey.name}</button>
  ))}</div>,
}));
vi.mock('./SurveyTableMenuCell', () => ({ default: () => null }));
vi.mock('./QuestionTable', () => ({ default: () => null }));
vi.mock('./RespondentTable', () => ({ default: () => null }));
vi.mock('./SurveyLifecyclePanel', () => ({ default: () => null }));
vi.mock('./EmailHistory', () => ({ default: () => null }));
vi.mock('./CreateSurveyDialog', () => ({ default: () => null }));
vi.mock('./SurveyInstructionsEditor', () => ({ default: () => null }));
vi.mock('./EmailNotificationEditor', () => ({ default: () => null }));
vi.mock('./ReminderTemplateEditor', () => ({ default: () => null }));

const surveys = [{ id: 'survey-a', name: 'Alpha', role: 'editor', lifecycleStatus: 'draft' }];
const theme = createTheme();

const Harness = () => {
  const navigate = useNavigate();
  return (
    <>
      <button onClick={() => navigate('/')}>Open list</button>
      <button onClick={() => navigate('/surveys/survey-a/overview')}>Open Alpha</button>
      <Routes>
        <Route path="*" element={<Dashboard />} />
      </Routes>
    </>
  );
};

beforeEach(() => {
  vi.clearAllMocks();
  api.get.mockImplementation((url) => {
    if (url === '/surveys') return Promise.resolve({ data: { surveys } });
    if (url.startsWith('/listQuestions')) return Promise.resolve({ data: { questions: [] } });
    if (url.startsWith('/targets')) return Promise.resolve({ data: [] });
    if (url === '/survey-notifications/survey-a') return Promise.resolve({ data: { notificationSubjects: { English: 'CLA Network Survey' } } });
    return Promise.resolve({ data: [] });
  });
});

test('a real editor draft survives leaving to the list and reopening the survey', async () => {
  render(
    <ThemeProvider theme={theme}>
      <EmotionThemeProvider theme={theme}>
        <MemoryRouter initialEntries={['/']}>
          <Harness />
        </MemoryRouter>
      </EmotionThemeProvider>
    </ThemeProvider>,
  );

  await userEvent.click(await screen.findByRole('button', { name: 'Select Alpha' }));
  await userEvent.click(screen.getByRole('button', { name: 'Email' }));
  const input = await screen.findByLabelText(/invitation email subject/i);
  await waitFor(() => expect(input).toHaveValue('CLA Network Survey'));

  await userEvent.clear(input);
  await userEvent.type(input, 'Hello team');
  expect(input).toHaveValue('Hello team');

  await userEvent.click(screen.getByRole('button', { name: 'Open list' }));
  expect(await screen.findByRole('heading', { name: 'Surveys' })).toBeInTheDocument();

  await userEvent.click(screen.getByRole('button', { name: 'Open Alpha' }));
  await userEvent.click(await screen.findByRole('button', { name: 'Email' }));
  const reopened = await screen.findByLabelText(/invitation email subject/i);
  await waitFor(() => expect(reopened).toHaveValue('Hello team'));
});
