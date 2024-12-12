import React, { useState, useEffect } from 'react';
import { DataGrid, GridToolbar } from '@mui/x-data-grid';
import { IconButton, Menu, MenuItem } from '@mui/material';
import MoreHorizIcon from '@mui/icons-material/MoreHoriz';
import DeleteIcon from '@mui/icons-material/Delete';
import PlayCircle from '@mui/icons-material/PlayCircle';
import VisibilityIcon from '@mui/icons-material/Visibility';
import EmailIcon from '@mui/icons-material/Email';
import SendDemoDialog from './SendDemoDialog';
import api from '../api/axios';

const MenuCell = ({ row, onSurveyDeleted }) => {
  const [anchorEl, setAnchorEl] = useState(null);
  const [sendDemoOpen, setSendDemoOpen] = useState(false);
  const open = Boolean(anchorEl);
  
  const handleClick = (event) => {
    event.stopPropagation();
    setAnchorEl(event.currentTarget);
  };
  
  const handleClose = (event) => {
    if (event) {
      event.stopPropagation();
    }
    setAnchorEl(null);
  };

  const handleStart = async (event) => {
    event.stopPropagation();
    try {
      await api.post('/startSurvey', { surveyName: row.name });
      // Could add success notification here
    } catch (error) {
      console.error('Error starting survey:', error);
      // Could add error notification here
    }
    handleClose();
  };

  const handleDelete = async (event) => {
    event.stopPropagation();
    try {
      const response = await api.delete(`/survey/${row.name}`);
      if (response.status === 200) {
        onSurveyDeleted(); // Trigger refetch of survey data
      }
    } catch (error) {
      console.error('Error deleting survey:', error);
      // Could add error notification here
    }
    handleClose();
  };

  const handleView = (event) => {
    event.stopPropagation();
    window.open(`${process.env.REACT_APP_SURVEY_PROTOCOL}://${process.env.REACT_APP_SURVEY_ENDPOINT}/?surveyName=${row.name}&userId=demo`);
    handleClose();
  };

  const handleSendDemo = (event) => {
    event.stopPropagation();
    setSendDemoOpen(true);
    handleClose();
  };

  const handleSendDemoSubmit = async (email, language) => {
    try {
      await api.post('/testEmail', {
        surveyName: row.name,
        email: email,
        language: language
      });
      setSendDemoOpen(false);
    } catch (error) {
      console.error('Error sending demo email:', error);
    }
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
      <SendDemoDialog
        open={sendDemoOpen}
        onClose={() => setSendDemoOpen(false)}
        onSubmit={handleSendDemoSubmit}
        surveyName={row.name}
      />
    </>
  );
};

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
    renderCell: (params) => <MenuCell row={params.row} onSurveyDeleted={params.row.onSurveyDeleted} />
  },
];

const SurveyTable = ({ rows, selectRow }) => {
  const [tableRows, setTableRows] = useState([]);
  const [selectedRow, setSelectedRow] = useState(null);

  useEffect(() => {
    const fetchSurveyData = async () => {
      try {
        const response = await api.get('/surveys');
        const processedRows = response.data.surveys.map(row => ({
          ...row,
          questions: row.questions === "null" ? "0" : row.questions,
          onSurveyDeleted: fetchSurveyData
        }));
        setTableRows(processedRows);
        
        // Clear selected row if it was deleted
        if (selectedRow && !processedRows.find(row => row.id === selectedRow.id)) {
          setSelectedRow(null);
          selectRow(null);
        }
      } catch (error) {
        console.error('Error fetching surveys:', error);
      }
    };

    if (rows) {
      const processedRows = rows.map(row => ({
        ...row,
        questions: row.questions === "null" ? "0" : row.questions,
        onSurveyDeleted: fetchSurveyData
      }));
      setTableRows(processedRows);
    }
  }, [rows, selectedRow, selectRow]);

  const handleRowClick = (params) => {
    setSelectedRow(params.row);
    selectRow(params.row);
  };

  return (
    <div style={{ height: '100%', width: '100%' }}>
      <DataGrid
        rows={tableRows}
        columns={columns}
        initialState={{
          pagination: { paginationModel: { pageSize: 10 } }
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