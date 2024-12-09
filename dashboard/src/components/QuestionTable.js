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
  { field: 'text', headerName: 'Question Text', width: 150, editable: true },
  { field: 'type', headerName: 'Question Type', width: 200, editable: true },
  { field: 'required', headerName: 'Required', width: 200 },
];

const TEMPLATE_DATA = [
  'text,type,required',
  'Who do you work with most closely?,tagbox,true',
  'Who do you go to for technical advice?,tagbox,true'
];

const QuestionTable = ({ rows, surveyName, onQuestionsUpdate }) => {
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
      setOriginalRows(updatedRows);
    }
  }, [rows]);

  const handleProcessRowUpdate = (newRow) => {
    const updatedRows = tableRows.map((row) => (row.id === newRow.id ? newRow : row));
    setTableRows(updatedRows);
    
    const hasUnsavedChanges = updatedRows.some((row, index) => {
      const original = originalRows[index];
      return original && (original.text !== row.text || original.type !== row.type);
    });
    
    setHasChanges(hasUnsavedChanges);
    return newRow;
  };

  const handleSave = async () => {
    try {
      const modifiedRows = tableRows.filter((row, index) => {
        const original = originalRows[index];
        return original && (original.text !== row.text || original.type !== row.type);
      });

      await api.post('/update-questions', { questions: modifiedRows });
      setOriginalRows(tableRows);
      setHasChanges(false);
    } catch (error) {
      console.error('Failed to save changes:', error);
    }
  };

  const handleUpload = async (csvContent) => {
    const data = { questions: csvContent, surveyName: surveyName };

    try {
      const response = await api.post('/updateQuestions', data);
      if (response.status === 200) {
        // Fetch updated question data
        const questionResponse = await api.get(`/listQuestions?surveyName=${surveyName}`);
        setTableRows(questionResponse.data.questions);
        
        // Additional API call to update survey counts
        const surveysResponse = await api.get('/surveys');
        if (onQuestionsUpdate) {
          onQuestionsUpdate(surveysResponse.data.surveys);
        }
      }
    } catch (err) {
      console.error('Error updating questions:', err);
      throw err;
    }
  };
  
 const handleAddRow = () => {
    const newId = tableRows.length > 0 ? Math.max(...tableRows.map(row => row.id)) + 1 : 1;
    const newRow = {
      id: newId,
      text: '',
      type: 'tagbox',
      required: true
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
          Survey Questions
        </Typography>
        <Box sx={{ display: 'flex', alignItems: 'center' }}>
          <AddRowButton onClick={handleAddRow} />
          <TableUploadButton
            onUpload={handleUpload}
            templateData={TEMPLATE_DATA}
            tableName="Questions"
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

export default QuestionTable;