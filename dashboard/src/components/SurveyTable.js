import React, { useState } from 'react';
import { DataGrid, GridToolbar } from '@mui/x-data-grid';

const initialRows = [
  { id: 1, name: 'ONA Survey', respondents: '18', questions: '8', date: '2021-10-01' },
  { id: 2, name: 'Stress Test', respondents: '2500',questions: '12', date: '2021-10-01' },
  { id: 3, name: 'Test Questions', respondents: '222',questions: '4', date: '2021-10-01' }
];

const columns = [
  { field: 'id', headerName: 'ID', width: 90 },
  { field: 'name', headerName: 'Survey Name', width: 150},
  { field: 'respondents', headerName: 'Respondents', width: 200 },
  { field: 'questions', headerName: 'Questions', width: 200 },
  { field: 'date', headerName: 'Creation Date', width: 200 },

];

const SurveyTable = () => {
  const [rows, setRows] = useState(initialRows);

  const handleProcessRowUpdate = (newRow) => {
    const updatedRows = rows.map((row) => (row.id === newRow.id ? newRow : row));
    setRows(updatedRows);
    return newRow;
  };

  return (
    <div style={{ height: '100%', width: '100%' }}>
      <DataGrid
        rows={rows}
        columns={columns}
        pageSize={5}
        rowsPerPageOptions={[5]}
        disableSelectionOnClick
        processRowUpdate={handleProcessRowUpdate}
        components={{
          Toolbar: GridToolbar,
        }}
        sx={{
          // Column Headers Hover Effect
          '& .MuiDataGrid-columnHeader:hover': {
            backgroundColor: 'rgba(66, 179, 175, 0.3)', // Darker green on hover
          },
          // Row Hover Effect
          '& .MuiDataGrid-row:hover': {
            backgroundColor: 'rgba(0, 178, 140, 0.1)', // Subtle highlight
          },
        }}
        
      />
    </div>
  );
};

export default SurveyTable;
