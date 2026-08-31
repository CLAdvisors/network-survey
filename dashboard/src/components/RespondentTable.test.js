import React from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, test, vi } from 'vitest';
import RespondentTable from './RespondentTable';
import api from '../api/axios';
import { formatDateTime } from './surveyLifecycle';

vi.mock('@network-survey/frontend-shared', () => ({ LANGUAGES: [{ label: 'English' }] }));
vi.mock('../api/axios', () => ({ default: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() } }));

vi.mock('@mui/x-data-grid', () => ({
  GridToolbar: () => null,
  DataGrid: ({ rows, columns, processRowUpdate }) => (
    <div>
      <span data-testid="respondent-name">{rows[0]?.name || ''}</span>
      {processRowUpdate && rows[0] && <button onClick={() => processRowUpdate({ ...rows[0], name: `${rows[0].name} Edited` })}>Edit respondent</button>}
      {processRowUpdate && rows[0] && <button onClick={() => processRowUpdate({ ...rows[0], name: rows[0].name.replace(/ Edited$/, '') })}>Revert respondent</button>}
      {processRowUpdate && rows.slice(1).map((row) => <button key={row.id} onClick={() => processRowUpdate({ ...row, name: `${row.name} Edited` })}>Edit respondent {row.id}</button>)}
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

vi.mock('./TableUploadButton', () => ({ default: ({ disabled, onUpload }) => {
  const initialUpload = React.useRef(onUpload);
  return <><button disabled={disabled}>Upload respondents</button><button onClick={() => initialUpload.current('csv')?.catch(() => {})}>Complete delayed upload</button></>;
} }));
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
  render(<RespondentTable revision={0} readOnly surveyName="Survey" rows={[
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
  const view = render(<RespondentTable revision={0} rows={null} surveyName="survey-1" loading onRetry={retry} />);

  expect(screen.getByText('Loading survey respondents…')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Add respondent' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Upload respondents' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Edit respondent' })).not.toBeInTheDocument();

  view.rerender(<RespondentTable revision={0} rows={null} surveyName="survey-1" loadError="Unable to load survey respondents." onRetry={retry} />);
  expect(screen.getByText('Unable to load survey respondents.')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Add respondent' })).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
  expect(retry).toHaveBeenCalledTimes(1);
});

test('submits every changed existing row in one stable-ID batch request', async () => {
  api.patch.mockResolvedValue({ status: 200, data: { revision: 1 } });
  api.get.mockResolvedValue({
    data: [
      { id: 1, name: 'One Edited', email: 'one@example.test', canRespond: true, language: 'English' },
      { id: 2, name: 'Two Edited', email: 'two@example.test', canRespond: true, language: 'English' },
    ],
    headers: { 'x-roster-revision': '1' },
  });
  render(<RespondentTable revision={0} surveyName="survey-1" rows={[
    { id: 1, name: 'One', email: 'one@example.test', canRespond: true, language: 'English' },
    { id: 2, name: 'Two', email: 'two@example.test', canRespond: true, language: 'English' },
  ]} />);

  await userEvent.click(await screen.findByRole('button', { name: 'Edit respondent' }));
  await userEvent.click(screen.getByRole('button', { name: 'Edit respondent 2' }));
  await userEvent.click(screen.getByRole('button', { name: 'Save' }));

  await waitFor(() => expect(api.patch).toHaveBeenCalledTimes(1));
  expect(api.patch).toHaveBeenCalledWith('/surveys/survey-1/respondents', {
    expectedRevision: 0,
    updates: [
      { respondentId: 1, name: 'One Edited', email: 'one@example.test', language: 'English', canRespond: true },
      { respondentId: 2, name: 'Two Edited', email: 'two@example.test', language: 'English', canRespond: true },
    ],
    additions: [],
  });
  expect(api.post).not.toHaveBeenCalled();
});

test('shows actionable API errors and retains the dirty draft', async () => {
  api.patch.mockRejectedValue({ response: { data: { error: 'roster_stale', message: 'Roster changed elsewhere. Refresh and reapply.' } } });
  const onDirtyChange = vi.fn();
  render(<RespondentTable revision={4} surveyName="survey-1" rows={[
    { id: 1, name: 'One', email: 'one@example.test', canRespond: true, language: 'English' },
  ]} onDirtyChange={onDirtyChange} />);

  await userEvent.click(await screen.findByRole('button', { name: 'Edit respondent' }));
  await userEvent.click(screen.getByRole('button', { name: 'Save' }));

  expect(await screen.findByText('Roster changed elsewhere. Refresh and reapply.')).toBeInTheDocument();
  expect(screen.getByTestId('respondent-name')).toHaveTextContent('One Edited');
  expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();
  expect(onDirtyChange).not.toHaveBeenCalledWith('survey-1', 'respondents', false);
});

test('keeps a draft pinned to its base revision when newer background data arrives', async () => {
  api.patch.mockRejectedValue({ response: { data: { message: 'stale' } } });
  const baseRows = [{ id: 1, name: 'One', email: 'one@example.test', canRespond: true, language: 'English' }];
  const view = render(<RespondentTable revision={4} surveyName="survey-1" rows={baseRows} />);
  await userEvent.click(await screen.findByRole('button', { name: 'Edit respondent' }));

  view.rerender(<RespondentTable revision={5} surveyName="survey-1" rows={baseRows} />);
  expect(screen.getByTestId('respondent-name')).toHaveTextContent('One Edited');
  await userEvent.click(screen.getByRole('button', { name: 'Save' }));

  await waitFor(() => expect(api.patch).toHaveBeenCalled());
  expect(api.patch.mock.calls[0][1].expectedRevision).toBe(4);
});

test('ignores a lower-revision parent roster after accepting newer authoritative props', async () => {
  const view = render(<RespondentTable revision={2} surveyName="survey-1" rows={[
    { id: 1, name: 'Newer', email: 'one@example.test', canRespond: true, language: 'English' },
  ]} />);
  await screen.findByText('Newer');

  view.rerender(<RespondentTable revision={1} surveyName="survey-1" rows={[
    { id: 1, name: 'Older', email: 'one@example.test', canRespond: true, language: 'English' },
  ]} />);
  expect(screen.getByTestId('respondent-name')).toHaveTextContent('Newer');
});

test('ignores an older mutation refresh after a newer authoritative roster arrives', async () => {
  const oldRefresh = deferred();
  api.patch.mockResolvedValue({ status: 200, data: { revision: 5 } });
  api.get.mockReturnValue(oldRefresh.promise);
  const baseRows = [{ id: 1, name: 'One', email: 'one@example.test', canRespond: true, language: 'English' }];
  const view = render(<RespondentTable revision={4} surveyName="survey-1" rows={baseRows} />);
  await userEvent.click(await screen.findByRole('button', { name: 'Edit respondent' }));
  await userEvent.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(api.get).toHaveBeenCalled());

  view.rerender(<RespondentTable revision={6} surveyName="survey-1" rows={[
    { id: 1, name: 'Server Newer', email: 'one@example.test', canRespond: true, language: 'English' },
  ]} />);
  await act(async () => oldRefresh.resolve({
    data: [{ id: 1, name: 'One Edited', email: 'one@example.test', canRespond: true, language: 'English' }],
    headers: { 'x-roster-revision': '5' },
  }));

  expect(screen.getByTestId('respondent-name')).toHaveTextContent('One Edited');
  expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();
});

test('manual draft reversion restores the latest authoritative roster and revision', async () => {
  const baseRows = [{ id: 1, name: 'One', email: 'one@example.test', canRespond: true, language: 'English' }];
  const view = render(<RespondentTable revision={4} surveyName="survey-1" rows={baseRows} />);
  await userEvent.click(await screen.findByRole('button', { name: 'Edit respondent' }));
  view.rerender(<RespondentTable revision={5} surveyName="survey-1" rows={[
    { id: 1, name: 'Server Newer', email: 'one@example.test', canRespond: true, language: 'English' },
  ]} />);

  await userEvent.click(screen.getByRole('button', { name: 'Revert respondent' }));
  expect(screen.getByTestId('respondent-name')).toHaveTextContent('Server Newer');
  expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument();
});

test('aborts a delayed CSV upload if a respondent draft was created while the file was read', async () => {
  render(<RespondentTable revision={0} surveyName="survey-1" rows={[
    { id: 1, name: 'One', email: 'one@example.test', canRespond: true, language: 'English' },
  ]} />);
  await userEvent.click(await screen.findByRole('button', { name: 'Edit respondent' }));
  await userEvent.click(screen.getByRole('button', { name: 'Complete delayed upload' }));

  expect(api.post).not.toHaveBeenCalled();
  expect(await screen.findByText('Finish or discard the current respondent draft before importing a CSV file.')).toBeInTheDocument();
  expect(screen.getByTestId('respondent-name')).toHaveTextContent('One Edited');
});

test('clears an obsolete refresh error when a later parent load is authoritative', async () => {
  api.post.mockResolvedValue({ status: 200, data: { revision: 1 } });
  api.get.mockRejectedValue(new Error('reload failed'));
  const view = render(<RespondentTable revision={0} surveyName="survey-1" rows={[]} />);

  await userEvent.click(screen.getByRole('button', { name: 'Complete delayed upload' }));
  expect(await screen.findByText(/authoritative roster could not be refreshed/i)).toBeInTheDocument();

  view.rerender(<RespondentTable revision={0} surveyName="survey-1" rows={[]} />);
  expect(screen.getByText(/authoritative roster could not be refreshed/i)).toBeInTheDocument();

  view.rerender(<RespondentTable revision={1} surveyName="survey-1" rows={[
    { id: 1, name: 'Imported', email: 'imported@example.test', canRespond: true, language: 'English' },
  ]} />);
  await waitFor(() => expect(screen.queryByText(/authoritative roster could not be refreshed/i)).not.toBeInTheDocument());
});

test('retains the respondent draft when persistence succeeds but target reload fails', async () => {
  const onSurveyDataChanged = vi.fn().mockResolvedValue([]);
  const onDirtyChange = vi.fn();
  api.patch.mockResolvedValue({ status: 200, data: { revision: 1 } });
  api.get.mockRejectedValue(new Error('target reload failed'));

  render(
    <RespondentTable
      revision={0}
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
  api.patch.mockResolvedValue({ status: 200, data: { revision: 1 } });
  api.get.mockRejectedValueOnce(new Error('target reload failed'));
  const view = render(<RespondentTable
    revision={0}
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
    revision={1}
    surveyName="survey-1"
    rows={[{ id: 1, name: 'One Person Edited', email: 'one@example.test', canRespond: true }]}
    onDirtyChange={onDirtyChange}
    onSurveyDataChanged={onSurveyDataChanged}
  />);

  await waitFor(() => expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument());
  expect(onDirtyChange).toHaveBeenCalledWith('survey-1', 'respondents', false);
  expect(screen.getByTestId('respondent-name')).toHaveTextContent('One Person Edited');
  expect(screen.queryByText(/change may have saved/i)).not.toBeInTheDocument();
});

test('allows an incomplete newly added respondent to be discarded', async () => {
  const onDirtyChange = vi.fn();
  render(<RespondentTable revision={0} surveyName="survey-1" rows={[]} onDirtyChange={onDirtyChange} />);

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
  api.patch.mockReturnValue(pendingSave.promise);
  api.get.mockResolvedValue({
    data: [{ id: 1, name: 'One Person Edited', email: 'one@example.test', canRespond: true }],
    headers: { 'x-roster-revision': '1' },
  });

  const view = render(
    <RespondentTable
      revision={0}
      surveyName="survey-1"
      rows={[{ id: 1, name: 'One Person', email: 'one@example.test', canRespond: true }]}
      onDirtyChange={onDirtyChange}
      onSurveyDataChanged={onSurveyDataChanged}
    />
  );
  await userEvent.click(await screen.findByRole('button', { name: 'Edit respondent' }));
  await userEvent.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(api.patch).toHaveBeenCalled());
  expect(screen.queryByRole('button', { name: 'Edit respondent' })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();

  view.rerender(
    <RespondentTable
      revision={0}
      surveyName="survey-2"
      rows={[{ id: 2, name: 'Two Person', email: 'two@example.test', canRespond: true }]}
      onDirtyChange={onDirtyChange}
      onSurveyDataChanged={onSurveyDataChanged}
    />
  );
  await waitFor(() => expect(screen.getByTestId('respondent-name')).toHaveTextContent('Two Person'));
  onDirtyChange.mockClear();

  await act(async () => pendingSave.resolve({ status: 200, data: { revision: 1 } }));
  expect(onDirtyChange).toHaveBeenCalledWith('survey-1', 'respondents', false);
  expect(onSurveyDataChanged).toHaveBeenCalledTimes(1);
  expect(screen.getByTestId('respondent-name')).toHaveTextContent('Two Person');
});
