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
          {rows.map((row, index) => <span key={row.id}>{column.renderCell({ row, hasFocus: index === 0 })}</span>)}
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

  const dispatch = screen.getByRole('region', { name: 'Invitation dispatch' });
  expect(dispatch).toHaveTextContent('4 / 4 accepted');
  expect(dispatch).toHaveTextContent('Complete');

  const provider = screen.getByRole('region', { name: 'Provider outcomes' });
  expect(provider).toHaveTextContent('2 delivered');
  expect(provider).toHaveTextContent('1 issue');
  expect(provider).not.toHaveTextContent('accepted / unverified');
  const details = screen.getByLabelText(/0 provider accepted, 2 delivered, 0 delayed, 1 bounced/);
  expect(details).toBeInTheDocument();
  expect(details).toHaveAttribute('tabindex', '0');
});

test('does not promise provider outcomes when no invitations were accepted', () => {
  render(<SurveyTable rows={[{
    id: 'survey-failed', name: 'Failed survey', latestLaunch: {
      targetCount: 2, failedCount: 1, cancelledCount: 1,
    },
  }]} selectRow={() => {}} />);

  const provider = screen.getByRole('region', { name: 'Provider outcomes' });
  expect(provider).toHaveTextContent('No provider activity');
  expect(provider).not.toHaveTextContent('Awaiting outcomes');
});
