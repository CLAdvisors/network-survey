import React, { useState, useEffect } from 'react';
import { DataGrid, GridToolbar } from '@mui/x-data-grid';
import MenuCell from './SurveyTableMenuCell';

const columns = [
  { field: 'id', headerName: 'ID', width: 90, hidden: true },
  { field: 'name', headerName: 'Survey Name', width: 150 },
  { field: 'respondents', headerName: 'Respondents', width: 200 },
  { field: 'questions', headerName: 'Questions', width: 200 },
  { field: 'date', headerName: 'Creation Date', width: 200 },
  {
    field: 'actions',
    headerName: 'Actions',
    width: 100,
    sortable: false,
    filterable: false,
    renderCell: (params) => <MenuCell row={params.row} onSurveyDeleted={params.row.onSurveyDeleted} />
  },
];

const SurveyTable = ({ rows, selectRow, onSurveyDeleted, selectedSurvey }) => {
  const [tableRows, setTableRows] = useState([]);

  useEffect(() => {
    if (rows) {
      const processedRows = rows.map(row => ({
        ...row,
        questions: row.questions === "null" ? "0" : row.questions,
        onSurveyDeleted: onSurveyDeleted
      }));
      setTableRows(processedRows);
    }
  }, [rows, onSurveyDeleted]);

  const handleRowClick = (params) => {
    selectRow(params.row);
  };

  return (
    <div style={{ height: '100%', width: '100%' }}>
      <DataGrid
        rows={tableRows}
        columns={columns}
        initialState={{
          pagination: { paginationModel: { pageSize: 10 } },
          columns: {
            columnVisibilityModel: {
              // Hide columns id and lastname.
              // Other columns will remain visible
              id: false,
            },
          }
        }}
        pageSizeOptions={[5, 10, 25, 50, { value: -1, label: 'All' }]}
        disableSelectionOnClick
        onRowClick={handleRowClick}
        components={{
          Toolbar: GridToolbar,
        }}
        sx={{
          '& .MuiDataGrid-columnHeader:hover': {
            backgroundColor: 'rgba(66, 179, 175, 0.3)',
          },
          '& .MuiDataGrid-row:hover': {
            backgroundColor: 'rgba(0, 178, 140, 0.2)',
          },
        }}
      />
    </div>
  );
};

export default SurveyTable;