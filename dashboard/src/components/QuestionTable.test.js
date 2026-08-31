import React from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';
import QuestionTable from './QuestionTable';
import api from '../api/axios';

vi.mock('../api/axios', () => ({
  default: { get: vi.fn(), post: vi.fn(), delete: vi.fn() },
}));

vi.mock('@mui/x-data-grid', () => ({
  GridToolbar: () => null,
  DataGrid: ({ rows, processRowUpdate }) => <div>
    <span data-testid="question-text">{rows[0]?.text || ''}</span>
    {processRowUpdate && rows[0] && (
      <button onClick={() => processRowUpdate({ ...rows[0], text: `${rows[0].text} edited` })}>Edit question</button>
    )}
  </div>,
}));

vi.mock('./TableUploadButton', () => ({
  default: ({ onUpload, disabled }) => <button disabled={disabled} onClick={() => onUpload('Title,Question name,Question title,Question type,Max answers,Required\nSurvey,q2,Imported,text,,true')}>Upload questions</button>,
}));
vi.mock('./AddRowButton', () => ({ default: () => null }));
vi.mock('./TableMenuCell', () => ({ default: () => null }));

const deferred = () => {
  let resolve;
  const promise = new Promise((yes) => { resolve = yes; });
  return { promise, resolve };
};

test('locks question mutations while an upload is pending', async () => {
  const pendingUpload = deferred();
  const onDirtyChange = vi.fn();
  const onSurveyDataChanged = vi.fn().mockResolvedValue([]);
  api.get.mockImplementation((url) => {
    if (url === '/admin/questions') return Promise.resolve({ data: { questions: { pages: [{ elements: [{ name: 'question_1', title: 'One', type: 'text' }] }] } } });
    return Promise.resolve({ data: { questions: [{ name: 'question_1', text: 'Uploaded', type: 'text' }] } });
  });
  api.post.mockReturnValue(pendingUpload.promise);

  render(
    <QuestionTable
      rows={[{ name: 'question_1', text: 'One', type: 'text' }]}
      surveyName="survey-1"
      onDirtyChange={onDirtyChange}
      onSurveyDataChanged={onSurveyDataChanged}
    />
  );
  await userEvent.click(screen.getByRole('button', { name: 'Upload questions' }));
  await waitFor(() => expect(api.post).toHaveBeenCalled());
  expect(screen.queryByRole('button', { name: 'Edit question' })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Upload questions' })).toBeDisabled();

  await act(async () => pendingUpload.resolve({ status: 200 }));
  expect(screen.getByTestId('question-text')).toHaveTextContent('Uploaded');
  expect(screen.getByRole('button', { name: 'Upload questions' })).toBeEnabled();
  expect(onSurveyDataChanged).toHaveBeenCalledTimes(1);
});

test('clears the owning survey question draft when its save succeeds after switching away', async () => {
  const pendingSave = deferred();
  const onDirtyChange = vi.fn();
  const onSurveyDataChanged = vi.fn().mockResolvedValue([]);
  api.get.mockImplementation((url) => {
    if (url === '/admin/questions') return Promise.resolve({ data: { questions: { pages: [{ elements: [{ name: 'question_1', title: 'One', type: 'text' }] }] } } });
    return Promise.resolve({ data: { questions: [] } });
  });
  api.post.mockReturnValue(pendingSave.promise);

  const view = render(
    <QuestionTable
      rows={[{ name: 'question_1', text: 'One', type: 'text' }]}
      surveyName="survey-1"
      onDirtyChange={onDirtyChange}
      onSurveyDataChanged={onSurveyDataChanged}
    />
  );
  await userEvent.click(screen.getByRole('button', { name: 'Edit question' }));
  await userEvent.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(api.post).toHaveBeenCalled());

  view.rerender(
    <QuestionTable
      rows={[{ name: 'question_1', text: 'Two', type: 'text' }]}
      surveyName="survey-2"
      onDirtyChange={onDirtyChange}
      onSurveyDataChanged={onSurveyDataChanged}
    />
  );
  await waitFor(() => expect(screen.getByTestId('question-text')).toHaveTextContent('Two'));
  onDirtyChange.mockClear();

  await act(async () => pendingSave.resolve({ status: 200 }));
  expect(onDirtyChange).toHaveBeenCalledWith('survey-1', 'questions', false);
  expect(onSurveyDataChanged).toHaveBeenCalledTimes(1);
  expect(screen.getByTestId('question-text')).toHaveTextContent('Two');
});
