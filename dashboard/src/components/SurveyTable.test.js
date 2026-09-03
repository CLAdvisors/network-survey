import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { createTheme } from '@mui/material/styles';
import { describe, expect, test, vi } from 'vitest';
import SurveyTable, { surveyTableSx } from './SurveyTable';
import { responseRateDescription, responseRateLabel, responseRateSortValue, responseRateSummary } from './surveyResponseRate';

vi.mock('../api/axios', () => ({ default: { get: vi.fn() } }));

vi.mock('@mui/x-data-grid', () => ({
  GridToolbar: () => null,
  DataGrid: ({ rows, columns, onRowClick, rowSelectionModel, sx }) => (
    <div
      data-testid="survey-grid"
      data-selection={JSON.stringify(rowSelectionModel)}
      data-selection-styles={String(Boolean(sx?.['& .MuiDataGrid-row.Mui-selected .MuiDataGrid-cell']))}
    >
      {rows.map((row) => <button key={`select-${row.id}`} onClick={() => onRowClick({ row })}>Select row {row.name}</button>)}
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
      providerOutcomeCounts: { deliveredCount: 2, delayedCount: 1, bouncedCount: 1, providerProblemCount: 1, providerWaitingCount: 3, acceptedUnverifiedCount: 2 },
    },
  }]} selectRow={() => {}} />);

  const dispatch = screen.getByRole('region', { name: 'Email dispatch' });
  expect(dispatch).toHaveTextContent('Invitation: 4 / 4 submitted');
  expect(dispatch).toHaveTextContent('Complete');

  const provider = screen.getByRole('region', { name: 'Provider outcomes' });
  expect(provider).toHaveTextContent('2 confirmed delivered');
  expect(provider).toHaveTextContent('1 with a problem');
  expect(provider).not.toHaveTextContent('accepted / unverified');
  const details = screen.getByLabelText(/2 delivery confirmations, 3 awaiting a final result, 1 invitation with delivery problems/);
  expect(details).toBeInTheDocument();
  expect(details).toHaveAccessibleName(/1 delay report/);
  expect(details).not.toHaveAccessibleName(/\bdelayed\b/i);
  expect(details).toHaveAttribute('tabindex', '0');
});

test('keeps selected-row indicators visible across horizontal scroll, hover, focus, and forced colors', () => {
  const selectRow = vi.fn();
  const selected = row('selected', {});
  const other = row('other', {});
  render(<SurveyTable rows={[selected, other]} selectedSurvey={selected} selectRow={selectRow} />);

  expect(screen.getByTestId('survey-grid')).toHaveAttribute('data-selection', '["selected"]');
  expect(screen.getByTestId('survey-grid')).toHaveAttribute('data-selection-styles', 'true');
  fireEvent.click(screen.getByRole('button', { name: 'Select row Survey other' }));
  expect(selectRow).toHaveBeenCalledWith(expect.objectContaining(other));

  const theme = createTheme({ palette: { primary: { main: '#42b4af', dark: '#3b9f9b' }, text: { primary: '#333333' } } });
  const selectedStyle = surveyTableSx['& .MuiDataGrid-row.Mui-selected'];
  const selectedHoverStyle = surveyTableSx['& .MuiDataGrid-row.Mui-selected:hover'];
  const selectedFocusStyle = surveyTableSx['& .MuiDataGrid-row.Mui-selected:focus-within'];
  const selectedCellStyle = surveyTableSx['& .MuiDataGrid-row.Mui-selected .MuiDataGrid-cell'];
  expect(selectedStyle.boxShadow(theme)).toContain('inset 4px 0 0 #333333');
  expect(selectedStyle.backgroundColor(theme)).not.toBe(selectedHoverStyle.backgroundColor(theme));
  expect(surveyTableSx['@media (hover: none)']['& .MuiDataGrid-columnHeader:hover'].backgroundColor).toBe('inherit');
  expect(surveyTableSx['@media (hover: none)']['& .MuiDataGrid-row:hover'].backgroundColor).toBe('transparent');
  expect(surveyTableSx['@media (hover: none)']['& .MuiDataGrid-row.Mui-selected:hover'].backgroundColor(theme)).toBe(selectedStyle.backgroundColor(theme));
  expect(selectedFocusStyle.outline(theme)).toBe(`2px solid ${theme.palette.text.primary}`);
  expect(selectedCellStyle.boxShadow(theme)).toBe('inset 0 2px 0 #333333, inset 0 -2px 0 #333333');
  expect(surveyTableSx['& .MuiDataGrid-row.Mui-selected .MuiDataGrid-cell[data-field="name"]']).toEqual({ fontWeight: 700 });
  expect(surveyTableSx['@media (forced-colors: active)']['& .MuiDataGrid-row.Mui-selected']).toMatchObject({
    backgroundColor: 'Canvas',
    boxShadow: 'none',
    color: 'CanvasText',
  });
  expect(surveyTableSx['@media (forced-colors: active)']['& .MuiDataGrid-row.Mui-selected:focus-within'].outline).toBe('2px solid Highlight');
  expect(surveyTableSx['@media (forced-colors: active)']['& .MuiDataGrid-row.Mui-selected .MuiDataGrid-cell']).toMatchObject({
    borderBlockStart: '2px solid Highlight',
    borderBlockEnd: '2px solid Highlight',
    boxShadow: 'none',
  });
});

test('labels reminder campaigns separately from initial invitations', () => {
  render(<SurveyTable rows={[{
    id: 'survey-reminder', name: 'Reminder survey', latestLaunch: {
      kind: 'reminder', targetCount: 2, acceptedCount: 1,
      providerOutcomeCounts: { providerProblemCount: 1, delayedCount: 2, bouncedCount: 1 },
    },
  }]} selectRow={() => {}} />);

  expect(screen.getByRole('region', { name: 'Email dispatch' })).toHaveTextContent('Reminder: 1 / 2 submitted');
  const details = screen.getByLabelText(/1 reminder with delivery problems/);
  expect(details).toHaveAccessibleName(/2 delay reports/);
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
