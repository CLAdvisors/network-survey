import React, { useState, useEffect } from 'react';
import { DataGrid, GridToolbar } from '@mui/x-data-grid';
import TableUploadButton from './TableUploadButton';
import AddRowButton from './AddRowButton';
import api from '../api/axios';
import { Box, Paper, Typography, Button, Snackbar, Alert } from '@mui/material';
import { useTheme } from '@mui/material/styles';
import SaveIcon from '@mui/icons-material/Save';
import DeleteIcon from '@mui/icons-material/Delete';
import TableMenuCell from './TableMenuCell';

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
  const [snackbar, setSnackbar] = useState({
    open: false,
    message: '',
    severity: 'success'
  });

  useEffect(() => {
    if (rows) {
      const updatedRows = rows.map((row, index) => ({
        ...row,
        id: index + 1,
        questions: row.questions === "null" ? "0" : row.questions
      }));
      setTableRows(updatedRows);
      setOriginalRows(JSON.parse(JSON.stringify(updatedRows)));
    }
  }, [rows]);

  const handleDeleteQuestion = async (row) => {
    try {
      const response = await api.delete('/question', {
        data: {
          questionName: `question_${row.id}`,
          surveyName: surveyName
        }
      });

      if (response.status === 200) {
        // Remove the question from the local state
        const updatedRows = tableRows
          .filter(tableRow => tableRow.id !== row.id)
          .map((tableRow, index) => ({
            ...tableRow,
            id: index + 1 // Reindex remaining rows
          }));
        
        setTableRows(updatedRows);
        setOriginalRows(JSON.parse(JSON.stringify(updatedRows)));
        setHasChanges(false);

        // Update survey counts if callback provided
        if (onQuestionsUpdate) {
          const surveysResponse = await api.get('/surveys');
          onQuestionsUpdate(surveysResponse.data.surveys);
        }

        setSnackbar({
          open: true,
          message: 'Question deleted successfully',
          severity: 'success'
        });
      }
    } catch (error) {
      console.error('Failed to delete question:', error);
      setSnackbar({
        open: true,
        message: 'Failed to delete question. Please try again.',
        severity: 'error'
      });
    }
  };

  const columns = [
    { field: 'id', headerName: 'ID', width: 90 },
    { field: 'text', headerName: 'Question Text', width: 500, editable: true },
    { field: 'type', headerName: 'Question Type', width: 150, editable: false },
    { field: 'required', headerName: 'Required', width: 100 },
    {
      field: 'actions',
      headerName: 'Actions',
      width: 100,
      sortable: false,
      filterable: false,
      renderCell: (params) => (
        <TableMenuCell
          row={params.row}
          actions={[
            {
              label: 'Delete Question',
              icon: <DeleteIcon fontSize="small" />,
              color: 'error.main',
              handler: handleDeleteQuestion
            }
          ]}
        />
      ),
    }
  ];

  const TEMPLATE_DATA = [
    'Title,Question name,Question title,Question type',
    ',question_1,Who do you go to when you need help with a problem on your job?,tagbox',
    ',question_2,Who do you collaborate with most frequently on projects or tasks?,tagbox',
    ',question_3,Whats your favorite thing about your job?,tagbox',
  ];

  const parseCSV = (csvContent) => {
    // Split by newline, handling both \n and \r\n
    const lines = csvContent.split(/\r?\n/).filter(line => line.trim());
    // const headers = lines[0].split(',');
    
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

        setSnackbar({
          open: true,
          message: 'Changes saved successfully',
          severity: 'success'
        });
      }
    } catch (error) {
      console.error('Failed to save changes:', error);
      setSnackbar({
        open: true,
        message: 'Failed to save changes. Please try again.',
        severity: 'error'
      });
    }
  };

  const handleUpload = async (csvContent) => {
    try {
      // Parse the new CSV content
      const newQuestions = parseCSV(csvContent);
      console.log('New questions:', newQuestions);
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

        setSnackbar({
          open: true,
          message: 'Questions uploaded successfully',
          severity: 'success'
        });
      }
    } catch (err) {
      console.error('Error updating questions:', err);
      setSnackbar({
        open: true,
        message: 'Failed to upload questions. Please try again.',
        severity: 'error'
      });
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

  const handleCloseSnackbar = (event, reason) => {
    if (reason === 'clickaway') {
      return;
    }
    setSnackbar(prev => ({ ...prev, open: false }));
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

      <Snackbar 
        open={snackbar.open} 
        autoHideDuration={6000} 
        onClose={handleCloseSnackbar}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
      >
        <Alert 
          onClose={handleCloseSnackbar} 
          severity={snackbar.severity}
          variant="filled"
          sx={{ width: '100%' }}
        >
          {snackbar.message}
        </Alert>
      </Snackbar>
    </Paper>
  );
};

export default QuestionTable;