import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import QuestionTable from './QuestionTable';
import RespondentTable from './RespondentTable';
import api from '../api/axios';

vi.mock('../api/axios', () => ({
  default: { get: vi.fn(), post: vi.fn(), delete: vi.fn() },
}));
vi.mock('@mui/x-data-grid', () => ({
  GridToolbar: () => null,
  DataGrid: ({ rows, columns, processRowUpdate }) => {
    const row = rows[0];
    const actions = columns.find((column) => column.field === 'actions');
    return (
      <div>
        <button
          onClick={() => processRowUpdate?.({
            ...row,
            text: row?.text === undefined ? undefined : 'Unsaved question',
            email: row?.email === undefined ? undefined : 'unsaved@example.com',
          })}
        >
          Edit row
        </button>
        {row && actions?.renderCell({ row, id: row.id, api: { updateRows: vi.fn() } })}
      </div>
    );
  },
}));
vi.mock('./AddRowButton', () => ({ default: ({ disabled }) => <button disabled={disabled}>Add Row</button> }));
vi.mock('./TableUploadButton', () => ({
  default: ({ disabled, onUpload }) => <button disabled={disabled} onClick={() => onUpload('csv')}>Upload</button>,
}));
vi.mock('./TableMenuCell', () => ({
  default: ({ row, disabled, actions }) => (
    <div>
      {actions.map((action) => (
        <button key={action.label} disabled={disabled} onClick={() => action.handler(row)}>
          {action.label}
        </button>
      ))}
    </div>
  ),
}));

const renderWithTheme = (node) => render(<ThemeProvider theme={createTheme()}>{node}</ThemeProvider>);

beforeEach(() => vi.clearAllMocks());

test('question drafts disable upload and destructive menu actions', async () => {
  renderWithTheme(
    <QuestionTable
      rows={[{ id: 1, name: 'question_1', text: 'Saved question', type: 'text', required: true }]}
      surveyName="survey-id"
    />
  );

  await userEvent.click(screen.getByRole('button', { name: 'Edit row' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Upload' })).toBeDisabled());
  expect(screen.getByRole('button', { name: 'Delete Question' })).toBeDisabled();
  expect(api.delete).not.toHaveBeenCalled();
});

test('respondent drafts disable upload, delete, and reminders so unsaved addresses are never used', async () => {
  renderWithTheme(
    <RespondentTable
      rows={[{
        id: 1,
        name: 'Alice',
        email: 'saved@example.com',
        language: 'English',
        canRespond: true,
        status: 'Incomplete',
      }]}
      surveyName="survey-id"
    />
  );

  await userEvent.click(screen.getByRole('button', { name: 'Edit row' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Upload' })).toBeDisabled());
  expect(screen.getByRole('button', { name: 'Send Reminder' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Delete Respondent' })).toBeDisabled();
  expect(api.post).not.toHaveBeenCalled();
  expect(api.delete).not.toHaveBeenCalled();
});

test('question survey switches clear drafts and cannot save or act until new rows load', async () => {
  const view = renderWithTheme(
    <QuestionTable
      rows={[{ id: 1, name: 'old_question', text: 'Old question', type: 'text', required: true }]}
      surveyName="old-survey"
    />
  );
  await userEvent.click(screen.getByRole('button', { name: 'Edit row' }));
  expect(await screen.findByRole('button', { name: 'Save' })).toBeEnabled();

  view.rerender(
    <ThemeProvider theme={createTheme()}>
      <QuestionTable rows={null} surveyName="new-survey" />
    </ThemeProvider>
  );
  expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Add Row' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Upload' })).toBeDisabled();
  expect(screen.queryByRole('button', { name: 'Delete Question' })).not.toBeInTheDocument();
  expect(api.post).not.toHaveBeenCalled();
  expect(api.delete).not.toHaveBeenCalled();

  api.delete.mockResolvedValue({ status: 200 });
  view.rerender(
    <ThemeProvider theme={createTheme()}>
      <QuestionTable
        rows={[{ id: 1, name: 'new_question', text: 'New question', type: 'text', required: true }]}
        surveyName="new-survey"
      />
    </ThemeProvider>
  );
  await userEvent.click(await screen.findByRole('button', { name: 'Delete Question' }));
  expect(api.delete).toHaveBeenCalledWith('/question', {
    data: { questionName: 'new_question', surveyName: 'new-survey' },
  });
});

test('respondent survey switches clear drafts and quarantine actions through load failure', async () => {
  const view = renderWithTheme(
    <RespondentTable
      rows={[{
        id: 1,
        name: 'Old Person',
        email: 'old@example.com',
        language: 'English',
        canRespond: true,
      }]}
      surveyName="old-survey"
    />
  );
  await userEvent.click(screen.getByRole('button', { name: 'Edit row' }));
  expect(await screen.findByRole('button', { name: 'Save' })).toBeEnabled();

  view.rerender(
    <ThemeProvider theme={createTheme()}>
      <RespondentTable rows={null} surveyName="new-survey" />
    </ThemeProvider>
  );
  expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Add Row' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Upload' })).toBeDisabled();
  expect(screen.queryByRole('button', { name: 'Send Reminder' })).not.toBeInTheDocument();
  expect(api.post).not.toHaveBeenCalled();

  api.post.mockResolvedValue({ data: { message: 'sent' } });
  const alert = vi.spyOn(window, 'alert').mockImplementation(() => {});
  view.rerender(
    <ThemeProvider theme={createTheme()}>
      <RespondentTable
        rows={[{
          id: 2,
          name: 'New Person',
          email: 'new@example.com',
          language: 'Spanish',
          canRespond: true,
        }]}
        surveyName="new-survey"
      />
    </ThemeProvider>
  );
  await userEvent.click(await screen.findByRole('button', { name: 'Send Reminder' }));
  expect(api.post).toHaveBeenCalledWith('/testEmail', {
    email: 'new@example.com',
    surveyName: 'new-survey',
    language: 'Spanish',
  });
  expect(api.post).not.toHaveBeenCalledWith('/testEmail', expect.objectContaining({
    email: 'old@example.com',
  }));
  alert.mockRestore();
});
