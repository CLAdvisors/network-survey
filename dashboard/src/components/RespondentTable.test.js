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

vi.mock('./TableUploadButton', () => ({ default: () => null }));
vi.mock('./AddRowButton', () => ({ default: () => null }));
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

  expect(await screen.findByRole('region', { name: 'Dispatch status' })).toHaveTextContent('accepted');
  const outcomes = screen.getByRole('region', { name: 'Provider outcome' });
  expect(outcomes).toHaveTextContent('Delivered');
  expect(outcomes).toHaveTextContent('Accepted / unverified');
  expect(screen.getByRole('region', { name: 'Provider outcome time' })).toHaveTextContent(formatDateTime(deliveredAt));
});

test('refreshes survey summaries when respondent persistence succeeds but target reload fails', async () => {
  const onSurveyDataChanged = vi.fn().mockResolvedValue([]);
  api.post.mockResolvedValue({ status: 200 });
  api.get.mockRejectedValue(new Error('target reload failed'));

  render(
    <RespondentTable
      surveyName="survey-1"
      rows={[{ id: 1, name: 'One Person', email: 'one@example.test', canRespond: true }]}
      onSurveyDataChanged={onSurveyDataChanged}
    />
  );
  await userEvent.click(await screen.findByRole('button', { name: 'Edit respondent' }));
  await userEvent.click(screen.getByRole('button', { name: 'Save' }));

  await waitFor(() => expect(onSurveyDataChanged).toHaveBeenCalledTimes(1));
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
