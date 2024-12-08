import React, { useState } from 'react';
import { DataGrid, GridToolbar } from '@mui/x-data-grid';

const initialRows = [
  { id: 1, name: 'John Doe', email: 'john.doe@example.com', status: 'Active' },
  { id: 2, name: 'Jane Smith', email: 'jane.smith@example.com', status: 'Completed' },
  { id: 3, name: 'Alice Johnson', email: 'alice.johnson@example.com', status: 'Active' },
];

const columns = [
  { field: 'id', headerName: 'ID', width: 90 },
  { field: 'name', headerName: 'User Name', width: 150},
  { field: 'email', headerName: 'Email', width: 200 },
  { field: 'status', headerName: 'Status', width: 200 },
];

const RespondentTable = () => {
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

export default RespondentTable;
