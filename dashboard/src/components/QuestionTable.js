import React, { useState, useEffect, useRef } from 'react';
import { DataGrid, GridToolbar } from '@mui/x-data-grid';
import TableUploadButton from './TableUploadButton';
import AddRowButton from './AddRowButton';
import api from '../api/axios';
import { Box, Paper, Typography, Button, Snackbar, Alert } from '@mui/material';
import { useTheme } from '@mui/material/styles';
import SaveIcon from '@mui/icons-material/Save';
import DeleteIcon from '@mui/icons-material/Delete';
import TableMenuCell from './TableMenuCell';
import { parseQuestionsCsv } from '../utils/questionsCsv';
import { buildQuestionTableSchema } from '../utils/questionTableSchema';
import useSurveyOperationState from './useSurveyOperationState';

const QuestionTable = ({ rows, surveyName, onSurveyDataChanged, readOnly = false, onDirtyChange, onOperationChange }) => {
  const theme = useTheme();
  const [tableRows, setTableRows] = useState([]);
  const [hasChanges, setHasChanges] = useState(false);
  const [originalRows, setOriginalRows] = useState([]);
  const draftsRef = useRef(new Map());
  const { begin, end, isPending, generation, advanceGeneration } = useSurveyOperationState('questions', onOperationChange);
  const operationPending = isPending(surveyName);
  const operationVersion = useRef(0);
  const surveyIdentity = useRef(surveyName);
  if (surveyIdentity.current !== surveyName) {
    surveyIdentity.current = surveyName;
    operationVersion.current += 1;
  }
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
      console.log('rows:', rows);
      const updatedRows = rows.map((row, index) => ({
        ...row,
        id: index + 1,
        questions: row.questions === "null" ? "0" : row.questions
      }));
      const original = JSON.parse(JSON.stringify(updatedRows));
      const draft = draftsRef.current.get(surveyName);
      setTableRows(draft?.rows || updatedRows);
      setOriginalRows(original);
      setHasChanges(Boolean(draft));
    } else {
      setTableRows([]);
      setOriginalRows([]);
      setHasChanges(false);
    }
  }, [rows, surveyName]);

  const handleDeleteQuestion = async (row) => {
    const targetSurveyId = surveyName;
    if (!begin(targetSurveyId)) return;
    const version = operationVersion.current;
    const operationGeneration = generation(targetSurveyId);
    try {
      const response = await api.delete('/question', {
        data: {
          questionName: row.name, // use canonical stable name
          surveyName: targetSurveyId
        }
      });

      if (response.status === 200) {
        advanceGeneration(targetSurveyId);
        await onSurveyDataChanged?.();
        if (
          version !== operationVersion.current ||
          targetSurveyId !== surveyIdentity.current ||
          generation(targetSurveyId) !== operationGeneration + 1
        ) return;
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
    } finally {
      end(targetSurveyId);
    }
  };

  const columns = [
    { field: 'id', headerName: 'ID', width: 90 },
    { field: 'text', headerName: 'Question text', width: 500, editable: !readOnly && !operationPending },
    { field: 'type', headerName: 'Question type', width: 150, editable: false },
    { field: 'required', headerName: 'Required', width: 100, type: 'boolean', editable: !readOnly && !operationPending },
    { field: 'max', headerName: 'Max answers', width: 150, editable: !readOnly && !operationPending },
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
  ].filter(column => (!readOnly && !hasChanges && !operationPending) || column.field !== 'actions');

  const TEMPLATE_DATA = [
    'Title,Question name,Question title,Question type,Max answers,Required',
    ',question_1,Who do you go to when you need help with a problem on your job?,tagbox,,true',
    ',question_2,Who do you collaborate with most frequently on projects or tasks?,tagbox,,true',
    ',question_3,Whats your favorite thing about your job?,tagbox,,true',
  ];


  const handleProcessRowUpdate = (newRow) => {
    if (readOnly || operationPending) return originalRows.find(row => row.id === newRow.id) || newRow;
    const updatedRows = tableRows.map((row) => (row.id === newRow.id ? newRow : row));
    setTableRows(updatedRows);
    
    const hasUnsavedChanges = updatedRows.some((row) => {
      const original = originalRows.find(origRow => origRow.id === row.id);
      return !original || original.text !== row.text || original.type !== row.type || original.max !== row.max || original.required !== row.required;
    });
    
    setHasChanges(hasUnsavedChanges);
    if (hasUnsavedChanges) draftsRef.current.set(surveyName, { rows: updatedRows });
    else draftsRef.current.delete(surveyName);
    advanceGeneration(surveyName);
    onDirtyChange?.(surveyName, 'questions', hasUnsavedChanges);
    return newRow;
  };

  const saveRows = async (rowsToSave, targetSurveyId = surveyName) => {
    // The table is a projection of the SurveyJS schema. Patch the full schema instead
    // of serializing CSV, which would discard type-specific fields and expressions.
    const response = await api.get('/admin/questions', { params: { surveyName: targetSurveyId } });
    const questions = buildQuestionTableSchema(response.data?.questions, rowsToSave);
    return api.post('/updateQuestions', { questions, surveyName: targetSurveyId });
  };

  const handleSave = async () => {
    const targetSurveyId = surveyName;
    if (!begin(targetSurveyId)) return;
    const savedDraft = draftsRef.current.get(targetSurveyId);
    const savedGeneration = generation(targetSurveyId);
    try {
      const response = await saveRows(tableRows, targetSurveyId);

      if (response.status === 200) {
        const draftUnchanged = Boolean(savedDraft) &&
          draftsRef.current.get(targetSurveyId) === savedDraft &&
          generation(targetSurveyId) === savedGeneration;
        if (draftUnchanged) {
          draftsRef.current.delete(targetSurveyId);
          onDirtyChange?.(targetSurveyId, 'questions', false);
        }
        advanceGeneration(targetSurveyId);
        await onSurveyDataChanged?.();
        if (targetSurveyId !== surveyIdentity.current || !draftUnchanged || draftsRef.current.has(targetSurveyId)) return;

        // Refresh questions data without allowing a newer draft to be overwritten.
        const questionResponse = await api.get(`/listQuestions?surveyName=${targetSurveyId}`);
        if (targetSurveyId !== surveyIdentity.current || draftsRef.current.has(targetSurveyId)) return;
        const refreshedRows = questionResponse.data.questions;
        const updatedRows = refreshedRows.map((row, index) => ({
          ...row,
          id: index + 1
        }));
        setTableRows(updatedRows);
        setOriginalRows(JSON.parse(JSON.stringify(updatedRows)));
        setHasChanges(false);

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
    } finally {
      end(targetSurveyId);
    }
  };

  const handleUpload = async (csvContent) => {
    const targetSurveyId = surveyName;
    if (!begin(targetSurveyId)) return;
    const version = operationVersion.current;
    const operationGeneration = generation(targetSurveyId);
    try {
      // Parse the new CSV content
      const newQuestions = parseQuestionsCsv(csvContent);
      console.log('New questions:', newQuestions);
      // Create new rows with sequential IDs after existing questions
      const newRows = newQuestions.map((q, index) => ({
        id: tableRows.length + index + 1,
        ...q
      }));

      // Combine existing questions with new ones, maintaining order
      const combinedQuestions = [...tableRows, ...newRows];
      
      // Persist a patched SurveyJS schema. Imported duplicate names receive fresh
      // identities, while the API remains responsible for final positional names.
      const response = await saveRows(combinedQuestions, targetSurveyId);

      if (response.status === 200) {
        advanceGeneration(targetSurveyId);
        await onSurveyDataChanged?.();
        if (
          version !== operationVersion.current ||
          targetSurveyId !== surveyIdentity.current ||
          generation(targetSurveyId) !== operationGeneration + 1
        ) return;
        const questionResponse = await api.get(`/listQuestions?surveyName=${targetSurveyId}`);
        if (
          version !== operationVersion.current ||
          targetSurveyId !== surveyIdentity.current ||
          generation(targetSurveyId) !== operationGeneration + 1
        ) return;
        const refreshedRows = questionResponse.data.questions.map((row, index) => ({
          ...row,
          id: index + 1
        }));
        

        setTableRows(refreshedRows);
        setOriginalRows(JSON.parse(JSON.stringify(refreshedRows)));
        setHasChanges(false);

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
    } finally {
      end(targetSurveyId);
    }
  };

  const handleAddRow = () => {
    if (operationPending) return;
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
    draftsRef.current.set(surveyName, { rows: updatedRows });
    advanceGeneration(surveyName);
    onDirtyChange?.(surveyName, 'questions', true);
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
        {!readOnly && (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <AddRowButton onClick={handleAddRow} disabled={operationPending} />
            <TableUploadButton
              onUpload={handleUpload}
              templateData={TEMPLATE_DATA}
              tableName="Questions"
              disabled={hasChanges || operationPending}
            />
            {hasChanges && (
              <Button
                variant="contained"
                startIcon={<SaveIcon />}
                onClick={handleSave}
                disabled={operationPending}
                size="small"
              >
                Save
              </Button>
            )}
          </Box>
        )}
      </Box>

      <DataGrid
        rows={tableRows}
        columns={columns}
        initialState={{
          pagination: { paginationModel: { pageSize: 10, page: 0 } },
        }}
        pageSizeOptions={[10, 25, 50, { value: -1, label: 'All' }]}
        disableSelectionOnClick
        processRowUpdate={readOnly || operationPending ? undefined : handleProcessRowUpdate}
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