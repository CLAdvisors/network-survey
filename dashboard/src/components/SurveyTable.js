import React, { useMemo } from 'react';
import { DataGrid, GridToolbar } from '@mui/x-data-grid';
import { alpha } from '@mui/material/styles';
import { Chip, Stack, Tooltip, Typography } from '@mui/material';
import MenuCell from './SurveyTableMenuCell';
import { LifecycleChip } from './SurveyLifecyclePanel';
import { launchCounts, lifecycleStatus, providerCounts } from './surveyLifecycle';
import { responseRateDescription, responseRateLabel, responseRateSortValue, responseRateSummary } from './surveyResponseRate';

export const surveyTableSx = {
  '& .MuiDataGrid-columnHeader:hover': { backgroundColor: 'rgba(66, 179, 175, 0.3)' },
  '& .MuiDataGrid-row:hover': { backgroundColor: 'rgba(0, 178, 140, 0.2)' },
  '& .MuiDataGrid-row.Mui-selected': {
    backgroundColor: (theme) => alpha(theme.palette.primary.dark, theme.palette.action.selectedOpacity),
    boxShadow: (theme) => `inset 4px 0 0 ${theme.palette.text.primary}`,
  },
  '& .MuiDataGrid-row.Mui-selected:hover': {
    backgroundColor: (theme) => alpha(
      theme.palette.primary.dark,
      theme.palette.action.selectedOpacity + theme.palette.action.hoverOpacity,
    ),
  },
  '& .MuiDataGrid-row.Mui-selected:focus-within': {
    outline: (theme) => `2px solid ${theme.palette.text.primary}`,
    outlineOffset: '-2px',
  },
  '& .MuiDataGrid-row.Mui-selected .MuiDataGrid-cell': {
    boxShadow: (theme) => `inset 0 2px 0 ${theme.palette.text.primary}, inset 0 -2px 0 ${theme.palette.text.primary}`,
  },
  '& .MuiDataGrid-row.Mui-selected .MuiDataGrid-cell[data-field="name"]': {
    fontWeight: 700,
  },
  '@media (hover: none)': {
    '& .MuiDataGrid-row.Mui-selected:hover': {
      backgroundColor: (theme) => alpha(theme.palette.primary.dark, theme.palette.action.selectedOpacity),
    },
  },
  '@media (forced-colors: active)': {
    '& .MuiDataGrid-row.Mui-selected': {
      backgroundColor: 'Canvas',
      boxShadow: 'none',
      color: 'CanvasText',
    },
    '& .MuiDataGrid-row.Mui-selected:hover': {
      backgroundColor: 'Canvas',
    },
    '& .MuiDataGrid-row.Mui-selected:focus-within': {
      outline: '2px solid Highlight',
    },
    '& .MuiDataGrid-row.Mui-selected .MuiDataGrid-cell': {
      borderBlockStart: '2px solid Highlight',
      borderBlockEnd: '2px solid Highlight',
      boxShadow: 'none',
      boxSizing: 'border-box',
    },
  },
};

const SurveyTable = ({
  rows,
  selectRow,
  onSurveyDeleted,
  onSurveyCopied,
  selectedSurvey,
  onLifecycleChange,
  dirtyBySurvey = {},
  operationsBySurvey = {},
}) => {
  const tableRows = useMemo(() => (rows || []).map((row) => {
    const responseRate = responseRateSummary(row);
    return {
      ...row,
      questions: row.questions === 'null' ? '0' : row.questions,
      responseRate,
      responseRateSortValue: responseRateSortValue(responseRate),
    };
  }), [rows]);

  const columns = useMemo(() => [
    { field: 'id', headerName: 'ID', width: 90 },
    { field: 'name', headerName: 'Survey Name', minWidth: 170, flex: 1 },
    {
      field: 'lifecycle',
      headerName: 'Lifecycle',
      width: 110,
      sortable: false,
      renderCell: ({ row }) => <LifecycleChip status={lifecycleStatus(row)} />,
    },
    { field: 'respondents', headerName: 'Respondents', width: 125 },
    {
      field: 'responseRateSortValue',
      headerName: 'Response Rate',
      width: 185,
      valueFormatter: (_value, row) => responseRateLabel(row.responseRate),
      renderCell: ({ row, hasFocus }) => {
        const details = responseRateDescription(row.responseRate);
        return <Tooltip title={details} arrow>
          <Typography
            variant="body2"
            aria-label={details}
            tabIndex={hasFocus ? 0 : -1}
            noWrap
          >
            {responseRateLabel(row.responseRate)}
          </Typography>
        </Tooltip>;
      },
    },
    { field: 'questions', headerName: 'Questions', width: 110 },
    {
      field: 'invitationSummary',
      headerName: 'Email dispatch',
      width: 190,
      sortable: false,
      renderCell: ({ row, hasFocus }) => {
        const latest = row.latestLaunch || row.latest_launch;
        if (!latest) return <Typography variant="body2" color="text.secondary">Not launched</Typography>;
        const counts = launchCounts(latest);
        const campaignName = latest.kind === 'reminder' ? 'Reminder' : 'Invitation';
        const processing = counts.pending + counts.leased + counts.retryWait;
        const notConfirmed = counts.failed + counts.uncertain + counts.cancelled;
        const details = `${counts.target} targets: ${counts.pending} pending, ${counts.leased} sending, ${counts.retryWait} retrying, ${counts.accepted} accepted, ${counts.failed} failed, ${counts.uncertain} uncertain, ${counts.cancelled} cancelled.`;
        return <Tooltip title={details} arrow>
          <Stack spacing={0.25} justifyContent="center" aria-label={details} tabIndex={hasFocus ? 0 : -1} sx={{ minWidth: 0 }}>
            <Typography variant="body2" fontWeight={600} noWrap>{campaignName}: {counts.accepted} / {counts.target} submitted</Typography>
            <Stack direction="row" spacing={0.5}>
              {processing > 0 && <Chip size="small" variant="outlined" color="info" label={`${processing} processing`} sx={{ height: 20 }} />}
              {notConfirmed > 0 && <Chip size="small" variant="outlined" color="warning" label={`${notConfirmed} not confirmed`} sx={{ height: 20 }} />}
              {processing === 0 && notConfirmed === 0 && <Chip size="small" variant="outlined" color="success" label="Complete" sx={{ height: 20 }} />}
            </Stack>
          </Stack>
        </Tooltip>;
      },
    },
    {
      field: 'providerSummary',
      headerName: 'Provider outcomes',
      width: 190,
      sortable: false,
      renderCell: ({ row, hasFocus }) => {
        const latest = row.latestLaunch || row.latest_launch;
        if (!latest) return <Typography variant="body2" color="text.secondary">No outcomes</Typography>;
        const counts = providerCounts(latest);
        const dispatch = launchCounts(latest);
        const adverse = counts.problems;
        const emailKind = latest.kind === 'reminder' ? 'reminder' : 'invitation';
        const details = `${counts.delivered} delivery confirmations, ${counts.waiting} awaiting a final result, ${counts.problems} ${counts.problems === 1 ? emailKind : `${emailKind}s`} with delivery problems; ${counts.sent} provider accepted, ${counts.delayed} ${counts.delayed === 1 ? 'delay report' : 'delay reports'}, ${counts.bounced} bounced, ${counts.complained} complained, ${counts.suppressed} suppressed, ${counts.providerFailed} provider failed, ${counts.acceptedUnverified} accepted and unverified.`;
        return <Tooltip title={details} arrow>
          <Stack spacing={0.25} justifyContent="center" aria-label={details} tabIndex={hasFocus ? 0 : -1} sx={{ minWidth: 0 }}>
            <Typography variant="body2" fontWeight={600} noWrap>{counts.delivered} confirmed delivered</Typography>
            {adverse > 0
              ? <Chip size="small" variant="outlined" color="warning" label={`${adverse} with ${adverse === 1 ? 'a problem' : 'problems'}`} sx={{ height: 20, width: 'fit-content' }} />
              : counts.waiting > 0
                ? <Chip size="small" variant="outlined" color="info" label={`${counts.waiting} awaiting final result`} sx={{ height: 20, width: 'fit-content' }} />
                : <Typography variant="caption" color="text.secondary">{counts.delivered > 0 ? 'No problems reported' : dispatch.accepted > 0 ? 'Awaiting delivery updates' : 'No provider activity'}</Typography>}
          </Stack>
        </Tooltip>;
      },
    },
    { field: 'date', headerName: 'Creation Date', width: 170 },
    {
      field: 'actions',
      headerName: 'Actions',
      width: 90,
      sortable: false,
      filterable: false,
      renderCell: ({ row }) => (
        <MenuCell
          row={row}
          onSurveyDeleted={onSurveyDeleted}
          onSurveyCopied={onSurveyCopied}
          onLifecycleChange={onLifecycleChange}
          onViewLifecycle={selectRow}
          unsavedChanges={dirtyBySurvey[row.id || row.name] || {}}
          pendingOperations={operationsBySurvey[row.id || row.name] || {}}
        />
      ),
    },
  ], [onSurveyDeleted, onSurveyCopied, onLifecycleChange, selectRow, dirtyBySurvey, operationsBySurvey]);

  return (
    <div style={{ height: '100%', width: '100%' }}>
      <DataGrid
        rows={tableRows}
        columns={columns}
        getRowId={(row) => row.id || row.name}
        initialState={{
          pagination: { paginationModel: { pageSize: 10 } },
          columns: { columnVisibilityModel: { id: false } },
        }}
        pageSizeOptions={[5, 10, 25, 50, { value: -1, label: 'All' }]}
        disableRowSelectionOnClick
        onRowClick={(params) => selectRow(params.row)}
        rowSelectionModel={selectedSurvey ? [selectedSurvey.id || selectedSurvey.name] : []}
        slots={{ toolbar: GridToolbar }}
        sx={surveyTableSx}
      />
    </div>
  );
};

export default SurveyTable;
