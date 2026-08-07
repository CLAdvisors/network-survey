import React, { useMemo } from 'react';
import { DataGrid, GridToolbar } from '@mui/x-data-grid';
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
      width: 210,
      sortable: false,
      renderCell: ({ row }) => {
        const latest = row.latestLaunch || row.latest_launch;
        if (!latest) return 'Not launched';
        const counts = launchCounts(latest);
        return `${counts.accepted} accepted / ${counts.target}${counts.failed ? ` · ${counts.failed} failed` : ''}${counts.uncertain ? ` · ${counts.uncertain} uncertain` : ''}`;
      },
    },
    {
      field: 'providerSummary',
      headerName: 'Provider outcomes',
      width: 310,
      sortable: false,
      renderCell: ({ row }) => {
        const latest = row.latestLaunch || row.latest_launch;
        if (!latest) return 'No provider outcomes';
        const counts = providerCounts(latest);
        return `${counts.delivered} delivered · ${counts.delayed} delayed · ${counts.bounced} bounced · ${counts.complained} complained · ${counts.suppressed} suppressed · ${counts.providerFailed} provider failed · ${counts.acceptedUnverified} accepted / unverified`;
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
