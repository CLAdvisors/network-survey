import React from 'react';
import { render, screen } from '@testing-library/react';
import { expect, test, vi } from 'vitest';
import SurveyTable from './SurveyTable';

vi.mock('../api/axios', () => ({ default: { get: vi.fn() } }));

vi.mock('@mui/x-data-grid', () => ({
  GridToolbar: () => null,
  DataGrid: ({ rows, columns }) => (
    <div>
      {columns.filter((column) => ['invitationSummary', 'providerSummary'].includes(column.field)).map((column) => (
        <section key={column.field} aria-label={column.headerName}>
          {rows.map((row) => <span key={row.id}>{column.renderCell({ row })}</span>)}
        </section>
      ))}
    </div>
  ),
}));

vi.mock('./SurveyTableMenuCell', () => ({ default: () => null }));

test('keeps survey dispatch acceptance separate from provider outcomes', () => {
  render(<SurveyTable rows={[{
    id: 'survey-1', name: 'Survey', latestLaunch: {
      targetCount: 4, acceptedCount: 4,
      providerOutcomeCounts: { deliveredCount: 2, bouncedCount: 1, acceptedUnverifiedCount: 2 },
    },
  }]} selectRow={() => {}} />);

  expect(screen.getByRole('region', { name: 'Invitation dispatch' })).toHaveTextContent('4 accepted / 4');
  const provider = screen.getByRole('region', { name: 'Provider outcomes' });
  expect(provider).toHaveTextContent('2 delivered');
  expect(provider).toHaveTextContent('1 bounced');
  expect(provider).toHaveTextContent('2 accepted / unverified');
});
