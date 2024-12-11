import React, { useState, useEffect } from 'react';
import { DataGrid, GridToolbar } from '@mui/x-data-grid';
import { IconButton, Menu, MenuItem } from '@mui/material';
import MoreHorizIcon from '@mui/icons-material/MoreHoriz';
import DeleteIcon from '@mui/icons-material/Delete';
import PlayCircle from '@mui/icons-material/PlayCircle';
import VisibilityIcon from '@mui/icons-material/Visibility';
import EmailIcon from '@mui/icons-material/Email';

const MenuCell = ({ row, selectedRow }) => {
  const [anchorEl, setAnchorEl] = useState(null);
  const open = Boolean(anchorEl);
  
  const handleClick = (event) => {
    event.stopPropagation(); // Prevent row selection when clicking menu
    setAnchorEl(event.currentTarget);
  };
  
  const handleClose = (event) => {
    if (event) {
      event.stopPropagation();
    }
    setAnchorEl(null);
  };

  const handleStart = (event) => {
    event.stopPropagation();
    console.log('Start survey:', row);
    handleClose();
  };

  const handleSendDemo = (event) => {
    event.stopPropagation();
    console.log('Start survey:', row);
    handleClose();
  };


  const handleDelete = (event) => {
    event.stopPropagation();
    console.log('Delete survey:', row);
    handleClose();
  };

  const handleView = (event) => {
    event.stopPropagation();
    // Use the row prop directly since it contains the current row's data
    window.open(`${process.env.REACT_APP_SURVEY_PROTOCOL}://${process.env.REACT_APP_SURVEY_ENDPOINT}/?surveyName=${row.name}&userId=demo`);
    handleClose();
  };

  return (
    <>
      <IconButton
        onClick={handleClick}
        size="small"
        sx={{
          '&:hover': {
            backgroundColor: 'rgba(66, 179, 175, 0.1)',
          }
        }}
      >
        <MoreHorizIcon />
      </IconButton>
      <Menu
        anchorEl={anchorEl}
        open={open}
        onClose={handleClose}
        onClick={handleClose}
        PaperProps={{
          elevation: 3,
          sx: {
            minWidth: 150,
            '& .MuiMenuItem-root': {
              px: 2,
              py: 1,
              gap: 1.5,
            },
          },
        }}
        transformOrigin={{ horizontal: 'right', vertical: 'top' }}
        anchorOrigin={{ horizontal: 'right', vertical: 'bottom' }}
      >
        <MenuItem onClick={handleView}>
          <VisibilityIcon fontSize="small" />
          Demo Survey
        </MenuItem>
        <MenuItem onClick={handleSendDemo}>
          <EmailIcon fontSize="small" />
          Send Demo Email
        </MenuItem>
        <MenuItem onClick={handleStart}>
          <PlayCircle fontSize="small" />
          Start Survey
        </MenuItem>
        <MenuItem onClick={handleDelete} sx={{ color: 'error.main' }}>
          <DeleteIcon fontSize="small" />
          Delete Survey
        </MenuItem>
      </Menu>
    </>
  );
};

const initialRows = [];

const columns = [
  { field: 'id', headerName: 'ID', width: 90 },
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
    renderCell: (params) => (
      <MenuCell 
        row={params.row} 
        selectedRow={params.row}
      />
    ),
  },
];

const SurveyTable = (props) => {
  const [rows, setRows] = useState(initialRows);
  const [, setLastClickedRow] = useState(null);

  useEffect(() => {
    if (props.rows) {
      const updatedRows = props.rows.map(row => ({
        ...row,
        questions: row.questions && row.questions !== "null" ? row.questions : "0"
      }));
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
    props.selectRow(params.row);
  };

  return (
    <div style={{ height: '100%', width: '100%' }}>
      <DataGrid
        rows={rows}
        columns={columns}
        initialState={{
          pagination: { paginationModel: { pageSize: 10 } }
        }}
        pageSizeOptions={[5, 10, 25, 50, { value: -1, label: 'All' }]}
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

export default SurveyTable;