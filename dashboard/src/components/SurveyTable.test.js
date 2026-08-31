import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';
import SurveyTable from './SurveyTable';
import { responseRateDescription, responseRateLabel, responseRateSortValue, responseRateSummary } from './surveyResponseRate';

vi.mock('../api/axios', () => ({ default: { get: vi.fn() } }));

vi.mock('@mui/x-data-grid', () => ({
  GridToolbar: () => null,
  DataGrid: ({ rows, columns }) => (
    <div>
      {columns.filter((column) => ['responseRateSortValue', 'invitationSummary', 'providerSummary'].includes(column.field)).map((column) => (
        <section
          key={column.field}
          aria-label={column.headerName}
          data-sortable={String(column.sortable !== false)}
          data-sorted-values={rows.map((row) => row[column.field]).sort((a, b) => a - b).join(',')}
          data-export-values={column.valueFormatter ? rows.map((row) => column.valueFormatter(row[column.field], row)).join('|') : ''}
        >
          {rows.map((row, index) => <span key={row.id}>{column.renderCell({ row, hasFocus: index === 0 })}</span>)}
        </section>
      ))}
    </div>
  ),
}));

vi.mock('./SurveyTableMenuCell', () => ({ default: () => null }));

const row = (id, values) => ({
  id,
  name: `Survey ${id}`,
  respondents: 0,
  questions: 0,
  lifecycleStatus: 'draft',
  ...values,
});

test('keeps survey dispatch acceptance separate from provider outcomes', () => {
  render(<SurveyTable rows={[{
    id: 'survey-1', name: 'Survey', latestLaunch: {
      targetCount: 4, acceptedCount: 4,
      providerOutcomeCounts: { deliveredCount: 2, bouncedCount: 1, providerProblemCount: 1, providerWaitingCount: 3, acceptedUnverifiedCount: 2 },
    },
  }]} selectRow={() => {}} />);

  const dispatch = screen.getByRole('region', { name: 'Invitation dispatch' });
  expect(dispatch).toHaveTextContent('4 / 4 submitted');
  expect(dispatch).toHaveTextContent('Complete');

  const provider = screen.getByRole('region', { name: 'Provider outcomes' });
  expect(provider).toHaveTextContent('2 confirmed delivered');
  expect(provider).toHaveTextContent('1 with a problem');
  expect(provider).not.toHaveTextContent('accepted / unverified');
  const details = screen.getByLabelText(/2 delivery confirmations, 3 awaiting a final result, 1 invitation with delivery problems/);
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

describe('survey response-rate normalization', () => {
  test.each([
    [{ eligibleRespondents:0, completedResponses:0, responseRatePercent:null }, { eligibleCount:0, completedCount:0, responseRatePercent:null }],
    [{ eligibleRespondents:'5', completedResponses:'0', responseRatePercent:'0' }, { eligibleCount:5, completedCount:0, responseRatePercent:0 }],
    [{ eligibleRespondents:4, completedResponses:3, responseRatePercent:75 }, { eligibleCount:4, completedCount:3, responseRatePercent:75 }],
    [{ eligibleRespondents:'7', completedResponses:'7', responseRatePercent:'100' }, { eligibleCount:7, completedCount:7, responseRatePercent:100 }],
  ])('normalizes numeric and string API values without recomputing the server rate', (input, expected) => {
    expect(responseRateSummary(input)).toEqual(expected);
  });

  test('uses safe finite fallbacks and a humane zero-denominator label', () => {
    const summary = responseRateSummary({
      eligibleRespondents: 'not-a-number',
      completedResponses: Infinity,
      responseRatePercent: Infinity,
    });
    expect(summary).toEqual({ eligibleCount:0, completedCount:0, responseRatePercent:null });
    expect(responseRateLabel(summary)).toBe('No eligible respondents');
    expect(responseRateDescription(summary)).toMatch(/no eligible respondents/i);
    expect(responseRateSortValue(summary)).toBe(-1);
    expect(responseRateSortValue(responseRateSummary({
      eligibleRespondents: 5,
      completedResponses: 0,
      responseRatePercent: 0,
    }))).toBe(0);
  });
});

test('renders a sortable, accessible Response Rate column for every survey', () => {
  render(<SurveyTable
    rows={[
      row('zero', { eligibleRespondents:0, completedResponses:0, responseRatePercent:null }),
      row('none-complete', { eligibleRespondents:5, completedResponses:0, responseRatePercent:0 }),
      row('partial', { eligibleRespondents:'4', completedResponses:'3', responseRatePercent:'75' }),
    ]}
    selectRow={() => {}}
  />);

  const responseRate = screen.getByRole('region', { name: 'Response Rate' });
  expect(responseRate).toHaveAttribute('data-sortable', 'true');
  expect(responseRate).toHaveAttribute('data-sorted-values', '-1,0,75');
  expect(responseRate).toHaveAttribute('data-export-values', 'No eligible respondents|0 / 5 (0%)|3 / 4 (75%)');
  expect(screen.getByText('No eligible respondents')).toHaveAccessibleName(
    'Response rate unavailable because this survey has no eligible respondents.',
  );
  expect(screen.getByText('3 / 4 (75%)')).toHaveAccessibleName(
    '3 of 4 eligible respondents completed the survey (75% response rate).',
  );
});
