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
  { field: 'text', headerName: 'Question Text', width: 500, editable: true },
  { field: 'type', headerName: 'Question Type', width: 150, editable: true },
  { field: 'required', headerName: 'Required', width: 100 },
];

const TEMPLATE_DATA = [
  'text,type,required',
  'Who do you work with most closely?,tagbox,true',
  'Who do you go to for technical advice?,tagbox,true'
];

const parseCSV = (csvContent) => {
  // Split by newline, handling both \n and \r\n
  const lines = csvContent.split(/\r?\n/).filter(line => line.trim());
  const headers = lines[0].split(',');
  
  // Skip header row and parse data rows
  const questions = [];
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue; // Skip empty lines
    
    // Split line by comma, but preserve commas within quotes
    const values = lines[i].split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/);
    const text = values[2] ? values[2].replace(/^"|"$/g, '') : ''; // Remove quotes if present
    
    if (text) {
      questions.push({
        text: text,
        type: values[3]?.trim() || 'tagbox',
        required: true
      });
    }
  }
  
  return questions;
};

const formatRowsToCSV = (rows) => {
  // Create CSV header
  const csvRows = ['Title,Question name,Question title,Question type'];
  
  // Sort rows by ID to maintain order
  const sortedRows = [...rows].sort((a, b) => a.id - b.id);
  
  // Add each question row
  sortedRows.forEach((row, index) => {
    const csvRow = [
      index === 0 ? 'Survey Title' : '', // Title only on first row
      `question_${index + 1}`,
      `"${row.text}"`, // Wrap text in quotes to handle commas
      row.type
    ].join(',');
    csvRows.push(csvRow);
  });

  return csvRows.join('\n');
};

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
      const updatedRows = rows.map((row, index) => ({
        ...row,
        id: index + 1, // Ensure IDs are sequential
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
      return !original || original.text !== row.text || original.type !== row.type;
    });
    
    setHasChanges(hasUnsavedChanges);
    return newRow;
  };

  const handleSave = async () => {
    try {
      // Convert current table state to CSV format
      const csvData = formatRowsToCSV(tableRows);
      
      // Send update request
      const response = await api.post('/updateQuestions', {
        questions: csvData,
        surveyName: surveyName
      });

      if (response.status === 200) {
        // Refresh questions data
        const questionResponse = await api.get(`/listQuestions?surveyName=${surveyName}`);
        const refreshedRows = questionResponse.data.questions;
        const updatedRows = refreshedRows.map((row, index) => ({
          ...row,
          id: index + 1
        }));
        setTableRows(updatedRows);
        setOriginalRows(JSON.parse(JSON.stringify(updatedRows)));
        setHasChanges(false);
        
        // Update survey counts
        const surveysResponse = await api.get('/surveys');
        if (onQuestionsUpdate) {
          onQuestionsUpdate(surveysResponse.data.surveys);
        }
      }
    } catch (error) {
      console.error('Failed to save changes:', error);
    }
  };

  const handleUpload = async (csvContent) => {
    try {
      // Parse the new CSV content
      const newQuestions = parseCSV(csvContent);
      
      // Create new rows with sequential IDs after existing questions
      const newRows = newQuestions.map((q, index) => ({
        id: tableRows.length + index + 1,
        ...q
      }));

      // Combine existing questions with new ones, maintaining order
      const combinedQuestions = [...tableRows, ...newRows];
      
      // Convert combined questions back to CSV
      const combinedCsvData = formatRowsToCSV(combinedQuestions);

      // Send update request with combined data
      const response = await api.post('/updateQuestions', {
        questions: combinedCsvData,
        surveyName
      });

      if (response.status === 200) {
        const questionResponse = await api.get(`/listQuestions?surveyName=${surveyName}`);
        const refreshedRows = questionResponse.data.questions.map((row, index) => ({
          ...row,
          id: index + 1
        }));
        setTableRows(refreshedRows);
        setOriginalRows(JSON.parse(JSON.stringify(refreshedRows)));
        
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
    const newId = Math.max(0, ...tableRows.map(row => row.id)) + 1;
    const newRow = {
      id: newId,
      text: '',
      type: 'tagbox',
      required: true
    };
    
    const updatedRows = [newRow, ...tableRows].map((row, index) => ({
      ...row,
      id: index + 1
    }));
    
    setTableRows(updatedRows);
    setHasChanges(true);
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
        <Typography variant="h7" color="primary" sx={{ fontWeight: 'bold' }}>
          Question Table
        </Typography>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <AddRowButton onClick={handleAddRow} />
          <TableUploadButton
            onUpload={handleUpload}
            templateData={TEMPLATE_DATA}
            tableName="Questions"
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

export default QuestionTable;