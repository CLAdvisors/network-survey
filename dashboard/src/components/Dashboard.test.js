import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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
    canViewSensitiveSurveyData: () => false,
  }),
}));

vi.mock('./SurveyTable', () => ({
  default: ({ rows, selectRow }) => <div>{(rows || []).map((survey) => (
    <button key={survey.id} onClick={() => selectRow(survey)}>Select {survey.name}</button>
  ))}</div>,
}));
vi.mock('./QuestionTable', () => ({ default: () => null }));
vi.mock('./RespondentTable', () => ({ default: () => null }));
vi.mock('./SurveyLifecyclePanel', () => ({ default: () => null }));
vi.mock('./CreateSurveyDialog', () => ({ default: () => null }));

let mountSequence = 0;
vi.mock('./InvitationSubjectEditor', () => ({
  default: ({ surveyId, readOnly }) => {
    const mount = React.useRef(++mountSequence);
    return <div data-testid="subject-editor" data-survey={surveyId} data-readonly={String(readOnly)} data-mount={`subject-${mount.current}`}>Invitation Email Subject</div>;
  },
}));
vi.mock('./EmailNotificationEditor', () => ({
  default: ({ surveyId, readOnly }) => {
    const mount = React.useRef(++mountSequence);
    return <div data-testid="body-editor" data-survey={surveyId} data-readonly={String(readOnly)} data-mount={`body-${mount.current}`}>Invitation Email Body</div>;
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
