import React, { useState, useEffect } from 'react';
import { DataGrid, GridToolbar } from '@mui/x-data-grid';

const initialRows = [];

const columns = [
  { field: 'id', headerName: 'ID', width: 90 },
  { field: 'name', headerName: 'Survey Name', width: 150},
  { field: 'respondents', headerName: 'Respondents', width: 200 },
  { field: 'questions', headerName: 'Questions', width: 200 },
  { field: 'date', headerName: 'Creation Date', width: 200 },
];

const SurveyTable = (props) => {
  const [rows, setRows] = useState(initialRows);
  const [lastClickedRow, setLastClickedRow] = useState(null);

  useEffect(() => {
    if (props.rows) {
        const updatedRows = props.rows.map(row => ({
          ...row,
          questions: row.questions === "null" ? "0" : row.questions
        }));
        console.log(updatedRows);
        setRows(updatedRows);
    }
  }, [props]);

  const handleProcessRowUpdate = (newRow) => {
    const updatedRows = rows.map((row) => (row.id === newRow.id ? newRow : row));
    setRows(updatedRows);
    return newRow;
  };

  const handleRowClick = (params) => {
    setLastClickedRow(params.row);
    props.selectRow(params.row)
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
        onRowClick={handleRowClick}
        components={{
          Toolbar: GridToolbar,
        }}
        sx={{
          '& .MuiDataGrid-columnHeader:hover': {
            backgroundColor: 'rgba(66, 179, 175, 0.3)',
          },
          '& .MuiDataGrid-row:hover': {
            backgroundColor: 'rgba(0, 178, 140, 0.1)',
          },
        }}
      />
    </div>
  );
};

export default SurveyTable;
