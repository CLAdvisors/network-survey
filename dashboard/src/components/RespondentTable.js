import React, { useCallback, useEffect, useRef, useState } from 'react';
import { DataGrid, GridToolbar } from '@mui/x-data-grid';
import TableUploadButton from './TableUploadButton';
import AddRowButton from './AddRowButton';
import api from '../api/axios';
import { Box, Paper, Typography, Button, Switch } from '@mui/material';
import { useTheme } from '@mui/material/styles';
import SaveIcon from '@mui/icons-material/Save';
import EmailIcon from '@mui/icons-material/Email';
import DeleteIcon from '@mui/icons-material/Delete';
import TableMenuCell from './TableMenuCell';
import { LANGUAGES } from '@network-survey/frontend-shared';

const TEMPLATE_DATA = [
  'First,Last,Email,Respondent,Location,Level,Gender,Race,Manager,VP,Business Group,Business Group - 1,Business Group - 2,Language',
  'Alicia,Smith,AliciaSmith@test.com,FALSE,Medical Towers,5,Female,Black,Sarah Currier,Sarah Currier,HR,System,Talent Management,English',
  'Andrea,Terrell,AndreaTerrell@test.com,TRUE,Medical Towers,6,Female,White,Alicia Smith,Brian Reed,HR,System,Talent Acquisition,English',
];

const CSV_HEADER = 'First,Last,Email,Language,Can Respond';

const formatRowsToCSV = (rows) => {
  const dataRows = rows.map(row => {
    const nameParts = row.name.trim().split(/\s+/);
    const firstName = nameParts[0] || '';
    const lastName = nameParts.slice(1).join(' ') || '';
    
    return [
      firstName,
      lastName,
      row.email,
      row.language || 'English',
      row.canRespond === undefined ? true : row.canRespond
    ].join(',');
  });

  return `${CSV_HEADER}\n${dataRows.join('\n')}`;
};

const RespondentTable = ({
  rows,
  surveyName,
  onRespondentsUpdate,
  readOnly = false,
  onDirtyChange,
  onBusyChange,
}) => {
  const theme = useTheme();
  const [tableRows, setTableRows] = useState([]);
  const [hasChanges, setHasChanges] = useState(false);
  const [originalRows, setOriginalRows] = useState([]);
  const busyCountRef = useRef(0);
  const loaded = rows !== null && rows !== undefined && Boolean(surveyName);
  const [busy, setBusy] = useState(false);

  const beginBusy = useCallback(() => {
    busyCountRef.current += 1;
    setBusy(true);
    let finished = false;
    return () => {
      if (finished) return;
      finished = true;
      busyCountRef.current = Math.max(0, busyCountRef.current - 1);
      if (busyCountRef.current === 0) setBusy(false);
    };
  }, []);

  useEffect(() => {
    onDirtyChange?.(hasChanges);
    return () => onDirtyChange?.(false);
  }, [hasChanges, onDirtyChange]);

  useEffect(() => {
    onBusyChange?.(busy);
    return () => onBusyChange?.(false);
  }, [busy, onBusyChange]);
  const [sortModel, setSortModel] = useState([
    {
      field: 'id',
      sort: 'asc',
    },
  ]);

  const columns = [
    { field: 'name', headerName: 'User Name', width: 150, editable: !readOnly && loaded && !busy },
    { field: 'email', headerName: 'Email', width: 200, editable: !readOnly && loaded && !busy },
    { 
      field: 'language', 
      headerName: 'Language', 
      width: 130,
      editable: !readOnly && loaded && !busy,
      type: 'singleSelect',
      valueOptions: LANGUAGES.map(lang => lang.label),
      renderCell: (params) => {
        const language = LANGUAGES.find(lang => lang.label === params.value);
        return language ? language.label : 'English';
      }
    },
    {
      field: 'canRespond',
      headerName: 'Can Respond',
      width: 120,
      editable: false, // Changed from true to false
      type: 'boolean',
      renderCell: (params) => (
        <Switch
          checked={params.value}
          disabled={readOnly || !loaded || busy}
          onChange={(e) => {
            e.stopPropagation();
            const newValue = e.target.checked;
            // Update the row directly
            const updatedRow = { ...params.row, canRespond: newValue };
            params.api.updateRows([{ id: params.id, canRespond: newValue }]);
            handleProcessRowUpdate(updatedRow);
          }}
        />
      )
    },
    { field: 'status', headerName: 'Status', width: 120 },
    {
      field: 'actions',
      headerName: 'Actions',
      width: 100,
      sortable: false,
      filterable: false,
      renderCell: (params) => (
        <TableMenuCell
          row={params.row}
          disabled={!loaded || busy || hasChanges}
          actions={[
            {
              label: 'Send Reminder',
              icon: <EmailIcon fontSize="small" />,
              handler: async (row) => {
                if (!loaded) return;
                const finishBusy = beginBusy();
                try {
                  const response = await api.post('/testEmail', {
                    email: row.email,
                    surveyName,
                    language: row.language
                  });
                  alert(response.data?.message || 'Email sent successfully via test route!');
                } catch (error) {
                  const errorMsg = error.response?.data?.message || error.message || 'An unknown error occurred';
                  console.error('Error sending reminder:', error);
                  alert('Failed to send reminder: ' + errorMsg);
                } finally {
                  finishBusy();
                }
              }
            },
            {
              label: 'Delete Respondent',
              icon: <DeleteIcon fontSize="small" />,
              color: 'error.main',
              handler: async (row) => {
                if (!loaded) return;
                const finishBusy = beginBusy();
                try {
                  await api.delete('/user', {
                    data: {
                      userName: row.name,
                      surveyName: surveyName
                    }
                  });
                  await params.row.onRespondentDeleted();
                } catch (error) {
                  console.error('Error deleting respondent:', error);
                } finally {
                  finishBusy();
                }
              }
            }
          ]}
        />
      ),
    }
  ].filter(column => !readOnly || column.field !== 'actions');



  useEffect(() => {
    if (!rows) {
      // Never retain one survey's local rows while the next survey is loading or
      // has failed to load. `loaded` disables controls before this effect runs.
      setTableRows([]);
      setOriginalRows([]);
      setHasChanges(false);
      return;
    }
    const updatedRows = rows.map(row => ({
      ...row,
      language: row.language || 'English',
      canRespond: row.canRespond === undefined ? true : row.canRespond,
      onRespondentDeleted: fetchRespondentData
    }));
    setTableRows(updatedRows);
    setOriginalRows(JSON.parse(JSON.stringify(updatedRows)));
    setHasChanges(false);
  }, [rows, surveyName]);

  const fetchRespondentData = async () => {
    if (!loaded) return;
    try {
      const response = await api.get(`/targets?surveyName=${surveyName}`);
      const refreshedRows = response.data.map(row => ({
        ...row,
        language: row.language || 'English',
        canRespond: row.canRespond === undefined ? true : row.canRespond,
        onRespondentDeleted: fetchRespondentData
      }));
      setTableRows(refreshedRows);
      setOriginalRows(JSON.parse(JSON.stringify(refreshedRows)));
      setHasChanges(false);

      const surveysResponse = await api.get('/surveys');
      if (onRespondentsUpdate) {
        onRespondentsUpdate(surveysResponse.data.surveys);
      }
    } catch (error) {
      console.error('Error fetching respondents:', error);
    }
  };

  const handleProcessRowUpdate = (newRow) => {
    if (readOnly || !loaded || busy) return tableRows.find(row => row.id === newRow.id) || newRow;
    const updatedRows = tableRows.map((row) => (row.id === newRow.id ? newRow : row));
    setTableRows(updatedRows);
    
    const hasUnsavedChanges = updatedRows.some((row) => {
      const original = originalRows.find(origRow => origRow.id === row.id);
      return !original || 
             original.name !== row.name || 
             original.email !== row.email ||
             original.language !== row.language ||
             original.canRespond !== row.canRespond;
    });
    
    setHasChanges(hasUnsavedChanges);
    return newRow;
  };

  const handleSave = async () => {
    if (!loaded) return;
    const finishBusy = beginBusy();
    try {
      const changedRows = tableRows.filter(row => {
        const original = originalRows.find(origRow => origRow.id === row.id);
        return (!original || 
                original.name !== row.name || 
                original.email !== row.email ||
                original.language !== row.language ||
                original.canRespond !== row.canRespond) && 
                row.name && row.email;
      });
  
      if (changedRows.length > 0) {
        for (const changedRow of changedRows) {
          const original = originalRows.find(origRow => origRow.id === changedRow.id);
          const csvData = formatRowsToCSV([changedRow]);
  
          const deleteRow = original && original.name !== changedRow.name ? 
            { name: original.name, surveyName } : null;
  
          await api.post('/updateTarget', {
            csvData,
            surveyName,
            deleteRow
          });
        }
  
        await fetchRespondentData();
        setHasChanges(false);
      }
    } catch (error) {
      console.error('Failed to save changes:', error);
    } finally {
      finishBusy();
    }
  };

  const handleUpload = async (csvContent) => {
    if (!loaded) return;
    const finishBusy = beginBusy();
    try {
      const response = await api.post('/updateTargets', {
        csvData: csvContent,
        surveyName
      });

      if (response.status === 200) {
        await fetchRespondentData();
      }
    } catch (err) {
      console.error('Error updating respondents:', err);
      throw err;
    } finally {
      finishBusy();
    }
  };

  const handleAddRow = () => {
    if (!loaded) return;
    const newId = Math.max(0, ...tableRows.map(row => row.id)) + 1;
    const newRow = {
      id: newId,
      name: '',
      email: '',
      language: 'English',
      canRespond: true,
      status: 'pending',
      onRespondentDeleted: fetchRespondentData
    };
    
    setTableRows([newRow, ...tableRows]);
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
        <Typography variant="h6" color="primary" sx={{ fontWeight: 'bold' }}>
          Respondent Table
        </Typography>
        {!readOnly && (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <AddRowButton onClick={handleAddRow} disabled={!loaded || busy} />
            <TableUploadButton
              onUpload={handleUpload}
              templateData={TEMPLATE_DATA}
              tableName="Respondents"
              disabled={!loaded || busy || hasChanges}
            />
            {hasChanges && (
              <Button
                variant="contained"
                startIcon={<SaveIcon />}
                onClick={handleSave}
                size="small"
                disabled={!loaded || busy}
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
        processRowUpdate={readOnly || !loaded || busy ? undefined : handleProcessRowUpdate}
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