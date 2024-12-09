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
    
    const hasUnsavedChanges = updatedRows.some((row, index) => {
      const original = originalRows[index];
      return original && (original.name !== row.name || original.email !== row.email);
    });
    
    setHasChanges(hasUnsavedChanges);
    return newRow;
  };

  const handleSave = async () => {
    try {
      const modifiedRows = tableRows.filter((row, index) => {
        const original = originalRows[index];
        return original && (original.name !== row.name || original.email !== row.email);
      });

      await api.post('/update-respondents', { respondents: modifiedRows });
      setOriginalRows(JSON.parse(JSON.stringify(tableRows)));
      setHasChanges(false);
    } catch (error) {
      console.error('Failed to save changes:', error);
    }
  };

  const handleUpload = async (csvContent) => {
    const data = { csvData: csvContent, surveyName: surveyName };

    try {
      const response = await api.post('/updateTargets', data);
      if (response.status === 200) {
        // Original API call to fetch updated respondent data
        const respondentResponse = await api.get(`/targets?surveyName=${surveyName}`);
        setTableRows(respondentResponse.data);
        
        // Additional API call to update survey counts
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
    const newId = tableRows.length > 0 ? Math.max(...tableRows.map(row => row.id)) + 1 : 1;
    const newRow = {
      id: newId,
      name: '',
      email: '',
      status: 'pending'
    };
    
    // Add new row at the beginning of the array
    setTableRows([newRow, ...tableRows]);
    setHasChanges(true);

    // Ensure sorting is set to show newest first
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