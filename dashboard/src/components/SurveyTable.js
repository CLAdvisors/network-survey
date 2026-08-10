import React, { useMemo } from 'react';
import { DataGrid, GridToolbar } from '@mui/x-data-grid';
import { Chip, Stack, Tooltip, Typography } from '@mui/material';
import MenuCell from './SurveyTableMenuCell';
import { LifecycleChip } from './SurveyLifecyclePanel';
import { launchCounts, lifecycleStatus, providerCounts } from './surveyLifecycle';

const SurveyTable = ({
  rows,
  selectRow,
  onSurveyDeleted,
  onSurveyCopied,
  selectedSurvey,
  onLifecycleChange,
}) => {
  const tableRows = useMemo(() => (rows || []).map((row) => ({
    ...row,
    questions: row.questions === 'null' ? '0' : row.questions,
  })), [rows]);

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
    { field: 'questions', headerName: 'Questions', width: 110 },
    {
      field: 'invitationSummary',
      headerName: 'Invitation dispatch',
      width: 190,
      sortable: false,
      renderCell: ({ row, hasFocus }) => {
        const latest = row.latestLaunch || row.latest_launch;
        if (!latest) return <Typography variant="body2" color="text.secondary">Not launched</Typography>;
        const counts = launchCounts(latest);
        const active = counts.pending + counts.leased + counts.retryWait;
        const issues = counts.failed + counts.uncertain + counts.cancelled;
        const details = `${counts.target} targets: ${counts.pending} pending, ${counts.leased} sending, ${counts.retryWait} retrying, ${counts.accepted} accepted, ${counts.failed} failed, ${counts.uncertain} uncertain, ${counts.cancelled} cancelled.`;
        return <Tooltip title={details} arrow>
          <Stack spacing={0.25} justifyContent="center" aria-label={details} tabIndex={hasFocus ? 0 : -1} sx={{ minWidth: 0 }}>
            <Typography variant="body2" fontWeight={600} noWrap>{counts.accepted} / {counts.target} accepted</Typography>
            <Stack direction="row" spacing={0.5}>
              {active > 0 && <Chip size="small" variant="outlined" color="info" label={`${active} active`} sx={{ height: 20 }} />}
              {issues > 0 && <Chip size="small" variant="outlined" color="warning" label={`${issues} ${issues === 1 ? 'issue' : 'issues'}`} sx={{ height: 20 }} />}
              {active === 0 && issues === 0 && <Chip size="small" variant="outlined" color="success" label="Complete" sx={{ height: 20 }} />}
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
        const adverse = counts.bounced + counts.complained + counts.suppressed + counts.providerFailed;
        const details = `${counts.sent} provider accepted, ${counts.delivered} delivered, ${counts.delayed} delayed, ${counts.bounced} bounced, ${counts.complained} complained, ${counts.suppressed} suppressed, ${counts.providerFailed} provider failed, ${counts.acceptedUnverified} accepted and unverified.`;
        return <Tooltip title={details} arrow>
          <Stack spacing={0.25} justifyContent="center" aria-label={details} tabIndex={hasFocus ? 0 : -1} sx={{ minWidth: 0 }}>
            <Typography variant="body2" fontWeight={600} noWrap>{counts.delivered} delivered</Typography>
            {adverse > 0
              ? <Chip size="small" variant="outlined" color="warning" label={`${adverse} ${adverse === 1 ? 'issue' : 'issues'}`} sx={{ height: 20, width: 'fit-content' }} />
              : counts.delayed > 0
                ? <Chip size="small" variant="outlined" color="info" label={`${counts.delayed} delayed`} sx={{ height: 20, width: 'fit-content' }} />
                : counts.acceptedUnverified > 0
                  ? <Chip size="small" variant="outlined" label={`${counts.acceptedUnverified} unverified`} sx={{ height: 20, width: 'fit-content' }} />
                  : counts.sent > 0
                    ? <Chip size="small" variant="outlined" label={`${counts.sent} provider accepted`} sx={{ height: 20, width: 'fit-content' }} />
                    : <Typography variant="caption" color="text.secondary">{counts.delivered > 0 ? 'No issues reported' : dispatch.accepted > 0 ? 'Awaiting outcomes' : 'No provider activity'}</Typography>}
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
        />
      ),
    },
  ], [onSurveyDeleted, onSurveyCopied, onLifecycleChange, selectRow]);

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
        sx={{
          '& .MuiDataGrid-columnHeader:hover': { backgroundColor: 'rgba(66, 179, 175, 0.3)' },
          '& .MuiDataGrid-row:hover': { backgroundColor: 'rgba(0, 178, 140, 0.2)' },
        }}
      />
    </div>
  );
};

export default SurveyTable;
