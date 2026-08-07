import React from 'react';
import { render, screen } from '@testing-library/react';
import { expect, test, vi } from 'vitest';
import RespondentTable from './RespondentTable';
import { formatDateTime } from './surveyLifecycle';

vi.mock('@network-survey/frontend-shared', () => ({ LANGUAGES: [{ label: 'English' }] }));
vi.mock('../api/axios', () => ({ default: { get: vi.fn(), post: vi.fn(), delete: vi.fn() } }));

vi.mock('@mui/x-data-grid', () => ({
  GridToolbar: () => null,
  DataGrid: ({ rows, columns }) => (
    <div>
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
