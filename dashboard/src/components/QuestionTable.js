import React, { useState, useEffect } from 'react';
import { DataGrid, GridToolbar } from '@mui/x-data-grid';

const initialRows = [];

const columns = [
  { field: 'id', headerName: 'ID', width: 90 },
  { field: 'text', headerName: 'Question Text', width: 150},
  { field: 'type', headerName: 'Question Type', width: 200 },
  { field: 'required', headerName: 'Required', width: 200 },
];

const QuestionTable = (props) => {
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
        initialState={{ //Add this prop
          pagination: { paginationModel: { pageSize: 10 } } // Setting initial pageSize
        }}
        pageSizeOptions={[10, 25, 50, { value: -1, label: 'All' }]}
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
            backgroundColor: 'rgba(0, 178, 140, 0.2)',
          },
        }}
      />
    </div>
  );
};

export default QuestionTable;
