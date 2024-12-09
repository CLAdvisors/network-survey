import React, { useState, useEffect } from 'react';
import { DataGrid, GridToolbar } from '@mui/x-data-grid';
import TableUploadButton from './TableUploadButton';
import AddRowButton from './AddRowButton';
import api from '../api/axios';
import { Box, Paper, Typography, Button } from '@mui/material';
import { useTheme } from '@mui/material/styles';
import SaveIcon from '@mui/icons-material/Save';

const columns = [
  { field: 'id', headerName: 'ID', width: 90 },
  { field: 'name', headerName: 'User Name', width: 150, editable: true },
  { field: 'email', headerName: 'Email', width: 200, editable: true },
  { field: 'status', headerName: 'Status', width: 200 },
];

const TEMPLATE_DATA = [
  'name,email,status',
  'John Doe,john@example.com,pending',
  'Jane Smith,jane@example.com,pending'
];

const CSV_HEADER = 'First,Last,Email,Respondent,Location,Level,Gender,Race,Manager,VP,Business Group,Business Group - 1,Business Group - 2,Language';

const formatRowsToCSV = (rows, originalRows) => {
  const dataRows = rows.map(row => {
    // Find if this is a modification of an existing row
    const originalRow = originalRows.find(origRow => origRow.id === row.id);
    
    const nameParts = row.name.trim().split(/\s+/);
    const firstName = nameParts[0] || '';
    const lastName = nameParts.slice(1).join(' ') || '';
    
    // If this is a modified row, keep its original UUID (which is stored in the originalRow)
    // If it's a new row, let the server generate a new UUID
    const additionalId = originalRow ? `,${originalRow.uuid}` : '';
    
    return `${firstName},${lastName},${row.email},true,,,,,,,,,,en${additionalId}`;
  });

  const headerWithId = originalRows.length > 0 ? 
    `${CSV_HEADER},uuid` : 
    CSV_HEADER;

  return `${headerWithId}\n${dataRows.join('\n')}`;
};

const RespondentTable = ({ rows, surveyName, onRespondentsUpdate }) => {
  const theme = useTheme();
  const [tableRows, setTableRows] = useState([]);
  const [hasChanges, setHasChanges] = useState(false);
  const [originalRows, setOriginalRows] = useState([]);
  const [sortModel, setSortModel] = useState([
    {
      field: 'id',
      sort: 'asc',
    },
  ]);

  useEffect(() => {
    if (rows) {
      const updatedRows = rows.map(row => ({
        ...row,
        questions: row.questions === "null" ? "0" : row.questions
      }));
      setTableRows(updatedRows);
      setOriginalRows(JSON.parse(JSON.stringify(updatedRows)));
    }
  }, [rows]);

  const handleProcessRowUpdate = (newRow) => {
    const updatedRows = tableRows.map((row) => (row.id === newRow.id ? newRow : row));
    setTableRows(updatedRows);
    
    const hasUnsavedChanges = updatedRows.some((row) => {
      const original = originalRows.find(origRow => origRow.id === row.id);
      return !original || original.name !== row.name || original.email !== row.email;
    });
    
    setHasChanges(hasUnsavedChanges);
    return newRow;
  };

  const handleSave = async () => {
    try {
      // Get all modified or new rows that have both name and email
      const changedRows = tableRows.filter(row => {
        const original = originalRows.find(origRow => origRow.id === row.id);
        return (!original || original.name !== row.name || original.email !== row.email) && row.name && row.email;
      });

      if (changedRows.length > 0) {
        const csvData = formatRowsToCSV(changedRows, originalRows);
        await api.post('/updateTarget', {
          csvData,
          surveyName
        });

        // Refresh the respondent data
        const respondentResponse = await api.get(`/targets?surveyName=${surveyName}`);
        const refreshedRows = respondentResponse.data;
        setTableRows(refreshedRows);
        setOriginalRows(JSON.parse(JSON.stringify(refreshedRows)));
        setHasChanges(false);

        // Refresh the survey counts
        const surveysResponse = await api.get('/surveys');
        if (onRespondentsUpdate) {
          onRespondentsUpdate(surveysResponse.data.surveys);
        }
      }
    } catch (error) {
      console.error('Failed to save changes:', error);
    }
  };

  const handleUpload = async (csvContent) => {
    const data = { csvData: csvContent, surveyName: surveyName };

    try {
      const response = await api.post('/updateTargets', data);
      if (response.status === 200) {
        const respondentResponse = await api.get(`/targets?surveyName=${surveyName}`);
        const refreshedRows = respondentResponse.data;
        setTableRows(refreshedRows);
        setOriginalRows(JSON.parse(JSON.stringify(refreshedRows)));
        
        const surveysResponse = await api.get('/surveys');
        if (onRespondentsUpdate) {
          onRespondentsUpdate(surveysResponse.data.surveys);
        }
      }
    } catch (err) {
      console.error('Error updating respondents:', err);
      throw err;
    }
  };

  const handleAddRow = () => {
    const newId = Math.max(0, ...tableRows.map(row => row.id)) + 1;
    const newRow = {
      id: newId,
      name: '',
      email: '',
      status: 'pending'
    };
    
    setTableRows([newRow, ...tableRows]);
    setHasChanges(true);

    setSortModel([
      {
        field: 'id',
        sort: 'desc',
      },
    ]);
  };

  return (
    <Paper elevation={2} sx={{ p: 3, bgcolor: theme.palette.background.paper, borderRadius: 2 }}>
      <Box sx={{ 
        display: 'flex', 
        justifyContent: 'space-between', 
        alignItems: 'center',
        mb: 3,
        borderBottom: `2px solid ${theme.palette.primary.main}`,
        pb: 1
      }}>
        <Typography variant="h6" color="primary" sx={{ fontWeight: 'bold' }}>
          Survey Respondents
        </Typography>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <AddRowButton onClick={handleAddRow} />
          <TableUploadButton
            onUpload={handleUpload}
            templateData={TEMPLATE_DATA}
            tableName="Respondents"
          />
          {hasChanges && (
            <Button
              variant="contained"
              startIcon={<SaveIcon />}
              onClick={handleSave}
              size="small"
            >
              Save
            </Button>
          )}
        </Box>
      </Box>

      <DataGrid
        rows={tableRows}
        columns={columns}
        initialState={{
          pagination: { paginationModel: { pageSize: 10, page: 0 } },
        }}
        pageSizeOptions={[10, 25, 50, { value: -1, label: 'All' }]}
        disableSelectionOnClick
        processRowUpdate={handleProcessRowUpdate}
        components={{
          Toolbar: GridToolbar,
        }}
        sortModel={sortModel}
        onSortModelChange={(model) => setSortModel(model)}
        sx={{
          '& .MuiDataGrid-columnHeader:hover': {
            backgroundColor: 'rgba(66, 179, 175, 0.3)',
          },
          '& .MuiDataGrid-row:hover': {
            backgroundColor: 'rgba(0, 178, 140, 0.2)',
          },
        }}
      />
    </Paper>
  );
};

export default RespondentTable;