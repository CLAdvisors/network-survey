import React, { useState, useEffect } from 'react';
import { DataGrid, GridToolbar } from '@mui/x-data-grid';
import EditableTableWrapper from './EditableTableWrapper';
import TableUploadButton from './TableUploadButton';
import AddRowButton from './AddRowButton';
import api from '../api/axios';
import { Box, Paper, Typography } from '@mui/material';
import { useTheme } from '@mui/material/styles';

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

const formatRowsToCSV = (rows) => {
  const dataRows = rows.map(row => {
    // Split name into first and last
    const nameParts = row.name.trim().split(/\s+/);
    const firstName = nameParts[0] || '';
    const lastName = nameParts.slice(1).join(' ') || '';
    
    // Create CSV row with default values for unspecified fields
    return `${firstName},${lastName},${row.email},true,,,,,,,,,,en`;
  });

  return `${CSV_HEADER}\n${dataRows.join('\n')}`;
};

const RespondentTable = ({ rows, surveyName, onRespondentsUpdate }) => {
  const theme = useTheme();
  const [tableRows, setTableRows] = useState([]);
  const [hasChanges, setHasChanges] = useState(false);
  const [originalRows, setOriginalRows] = useState([]);
  const [originalRowIds, setOriginalRowIds] = useState(new Set());
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
      // Store the IDs of original rows
      setOriginalRowIds(new Set(updatedRows.map(row => row.id)));
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
      // Find all new rows by checking against originalRowIds
      const newRows = tableRows.filter(row => {
        return !originalRowIds.has(row.id) && row.name && row.email;
      });

      console.log('New rows to be saved:', newRows); // Debug log

      // If there are new rows, send them all in one CSV request
      if (newRows.length > 0) {
        const csvData = formatRowsToCSV(newRows);
        await api.post('/updateTargets', {
          csvData,
          surveyName
        });
      }

      // Handle modified existing rows
      const modifiedRows = tableRows.filter(row => {
        if (!originalRowIds.has(row.id)) return false;
        const original = originalRows.find(origRow => origRow.id === row.id);
        return original && (original.name !== row.name || original.email !== row.email);
      });

      if (modifiedRows.length > 0) {
        await api.post('/update-respondents', { respondents: modifiedRows });
      }

      // Refresh the respondent data
      const respondentResponse = await api.get(`/targets?surveyName=${surveyName}`);
      const refreshedRows = respondentResponse.data;
      setTableRows(refreshedRows);
      setOriginalRows(JSON.parse(JSON.stringify(refreshedRows)));
      setOriginalRowIds(new Set(refreshedRows.map(row => row.id)));
      setHasChanges(false);

      // Refresh the survey counts
      const surveysResponse = await api.get('/surveys');
      if (onRespondentsUpdate) {
        onRespondentsUpdate(surveysResponse.data.surveys);
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
        setOriginalRowIds(new Set(refreshedRows.map(row => row.id)));
        
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
        <Box sx={{ display: 'flex', alignItems: 'center' }}>
          <AddRowButton onClick={handleAddRow} />
          <TableUploadButton
            onUpload={handleUpload}
            templateData={TEMPLATE_DATA}
            tableName="Respondents"
          />
        </Box>
      </Box>

      <EditableTableWrapper 
        onSave={handleSave}
        hasChanges={hasChanges}
        setHasChanges={setHasChanges}
      >
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
      </EditableTableWrapper>
    </Paper>
  );
};

export default RespondentTable;