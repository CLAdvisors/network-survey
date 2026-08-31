import React from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, test, vi } from 'vitest';
import RespondentTable from './RespondentTable';
import api from '../api/axios';
import { formatDateTime } from './surveyLifecycle';

vi.mock('@network-survey/frontend-shared', () => ({ LANGUAGES: [{ label: 'English' }] }));
vi.mock('../api/axios', () => ({ default: { get: vi.fn(), post: vi.fn(), delete: vi.fn() } }));

vi.mock('@mui/x-data-grid', () => ({
  GridToolbar: () => null,
  DataGrid: ({ rows, columns, processRowUpdate }) => (
    <div>
      <span data-testid="respondent-name">{rows[0]?.name || ''}</span>
      {processRowUpdate && rows[0] && <button onClick={() => processRowUpdate({ ...rows[0], name: `${rows[0].name} Edited` })}>Edit respondent</button>}
      {columns.filter((column) => ['dispatchStatus', 'providerOutcome', 'providerOutcomeAt'].includes(column.field)).map((column) => (
        <section key={column.field} aria-label={column.headerName}>
          {rows.map((row) => {
            const value = column.valueGetter ? column.valueGetter(undefined, row) : row[column.field];
            return <span key={row.id}>{column.valueFormatter ? column.valueFormatter(value) : value}</span>;
          })}
        </section>
      ))}
    </div>
  ),
}));

vi.mock('./TableUploadButton', () => ({ default: ({ disabled }) => <button disabled={disabled}>Upload respondents</button> }));
vi.mock('./AddRowButton', () => ({ default: ({ disabled, onClick }) => <button disabled={disabled} onClick={onClick}>Add respondent</button> }));
vi.mock('./TableMenuCell', () => ({ default: () => null }));

const deferred = () => {
  let resolve;
  const promise = new Promise((yes) => { resolve = yes; });
  return { promise, resolve };
};

beforeEach(() => vi.clearAllMocks());

test('presents dispatch and provider outcomes as separate respondent fields', async () => {
  const deliveredAt = '2026-01-02T03:04:05Z';
  render(<RespondentTable readOnly surveyName="Survey" rows={[
    {
      id: 1, name: 'One', email: 'one@example.test', dispatch_status: 'accepted',
      provider_outcome: 'delivered', provider_delivered_at: deliveredAt,
    },
    { id: 2, name: 'Legacy', email: 'legacy@example.test', emailStatus: 'legacy_assumed_accepted' },
  ]} />);

  expect(screen.queryByRole('button', { name: 'Edit respondent' })).not.toBeInTheDocument();
  expect(await screen.findByRole('region', { name: 'Dispatch status' })).toHaveTextContent('accepted');
  const outcomes = screen.getByRole('region', { name: 'Provider outcome' });
  expect(outcomes).toHaveTextContent('Delivered');
  expect(outcomes).toHaveTextContent('Accepted / unverified');
  expect(screen.getByRole('region', { name: 'Provider outcome time' })).toHaveTextContent(formatDateTime(deliveredAt));
});

test('keeps respondent mutations unavailable until the roster loads successfully', async () => {
  const retry = vi.fn();
  const view = render(<RespondentTable rows={null} surveyName="survey-1" loading onRetry={retry} />);

  expect(screen.getByText('Loading survey respondents…')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Add respondent' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Upload respondents' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Edit respondent' })).not.toBeInTheDocument();

  view.rerender(<RespondentTable rows={null} surveyName="survey-1" loadError="Unable to load survey respondents." onRetry={retry} />);
  expect(screen.getByText('Unable to load survey respondents.')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Add respondent' })).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
  expect(retry).toHaveBeenCalledTimes(1);
});

test('retains the respondent draft when persistence succeeds but target reload fails', async () => {
  const onSurveyDataChanged = vi.fn().mockResolvedValue([]);
  const onDirtyChange = vi.fn();
  api.post.mockResolvedValue({ status: 200 });
  api.get.mockRejectedValue(new Error('target reload failed'));

  render(
    <RespondentTable
      surveyName="survey-1"
      rows={[{ id: 1, name: 'One Person', email: 'one@example.test', canRespond: true }]}
      onSurveyDataChanged={onSurveyDataChanged}
      onDirtyChange={onDirtyChange}
    />
  );
  await userEvent.click(await screen.findByRole('button', { name: 'Edit respondent' }));
  await userEvent.click(screen.getByRole('button', { name: 'Save' }));

  await waitFor(() => expect(onSurveyDataChanged).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled());
  expect(onDirtyChange).not.toHaveBeenCalledWith('survey-1', 'respondents', false);
  expect(screen.getByTestId('respondent-name')).toHaveTextContent('One Person Edited');
});

test('reconciles a retained draft after a later roster reload confirms it was persisted', async () => {
  const onDirtyChange = vi.fn();
  const onSurveyDataChanged = vi.fn().mockResolvedValue([]);
  api.post.mockResolvedValue({ status: 200 });
  api.get.mockRejectedValueOnce(new Error('target reload failed'));
  const view = render(<RespondentTable
    surveyName="survey-1"
    rows={[{ id: 1, name: 'One Person', email: 'one@example.test', canRespond: true }]}
    onDirtyChange={onDirtyChange}
    onSurveyDataChanged={onSurveyDataChanged}
  />);

  await userEvent.click(screen.getByRole('button', { name: 'Edit respondent' }));
  await userEvent.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled());
  onDirtyChange.mockClear();

  view.rerender(<RespondentTable
    surveyName="survey-1"
    rows={[{ id: 99, name: 'One Person Edited', email: 'one@example.test', canRespond: true }]}
    onDirtyChange={onDirtyChange}
    onSurveyDataChanged={onSurveyDataChanged}
  />);

  await waitFor(() => expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument());
  expect(onDirtyChange).toHaveBeenCalledWith('survey-1', 'respondents', false);
  expect(screen.getByTestId('respondent-name')).toHaveTextContent('One Person Edited');
});

test('allows an incomplete newly added respondent to be discarded', async () => {
  const onDirtyChange = vi.fn();
  render(<RespondentTable surveyName="survey-1" rows={[]} onDirtyChange={onDirtyChange} />);

  await userEvent.click(screen.getByRole('button', { name: 'Add respondent' }));
  expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  expect(screen.getByText(/Complete each respondent’s name and email, or discard changes/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Discard changes' })).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Discard changes' }));

  expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument();
  expect(screen.getByTestId('respondent-name')).toBeEmptyDOMElement();
  expect(onDirtyChange).toHaveBeenLastCalledWith('survey-1', 'respondents', false);
});

test('clears the owning survey respondent draft when its save succeeds after switching away', async () => {
  const pendingSave = deferred();
  const onDirtyChange = vi.fn();
  const onSurveyDataChanged = vi.fn().mockResolvedValue([]);
  api.post.mockReturnValue(pendingSave.promise);

  const view = render(
    <RespondentTable
      surveyName="survey-1"
      rows={[{ id: 1, name: 'One Person', email: 'one@example.test', canRespond: true }]}
      onDirtyChange={onDirtyChange}
      onSurveyDataChanged={onSurveyDataChanged}
    />
  );
  await userEvent.click(await screen.findByRole('button', { name: 'Edit respondent' }));
  await userEvent.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(api.post).toHaveBeenCalled());
  expect(screen.queryByRole('button', { name: 'Edit respondent' })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();

  view.rerender(
    <RespondentTable
      surveyName="survey-2"
      rows={[{ id: 2, name: 'Two Person', email: 'two@example.test', canRespond: true }]}
      onDirtyChange={onDirtyChange}
      onSurveyDataChanged={onSurveyDataChanged}
    />
  );
  await waitFor(() => expect(screen.getByTestId('respondent-name')).toHaveTextContent('Two Person'));
  onDirtyChange.mockClear();

  await act(async () => pendingSave.resolve({ status: 200 }));
  expect(onDirtyChange).toHaveBeenCalledWith('survey-1', 'respondents', false);
  expect(onSurveyDataChanged).toHaveBeenCalledTimes(1);
  expect(screen.getByTestId('respondent-name')).toHaveTextContent('Two Person');
});
