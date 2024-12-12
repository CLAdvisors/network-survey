import React, { useState, useEffect } from 'react';
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

const LANGUAGES = [
  { code: 'en', label: 'English' },
  { code: 'es', label: 'Spanish' },
  { code: 'fr', label: 'French' },
  { code: 'de', label: 'German' },
  { code: 'it', label: 'Italian' },
  { code: 'pt', label: 'Portuguese' },
  { code: 'nl', label: 'Dutch' },
  { code: 'pl', label: 'Polish' },
  { code: 'ru', label: 'Russian' },
  { code: 'ja', label: 'Japanese' },
  { code: 'zh', label: 'Chinese' },
  { code: 'ko', label: 'Korean' }
];

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

  const columns = [
    { field: 'name', headerName: 'User Name', width: 150, editable: true },
    { field: 'email', headerName: 'Email', width: 200, editable: true },
    { 
      field: 'language', 
      headerName: 'Language', 
      width: 130,
      editable: true,
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
      editable: true,
      type: 'boolean',
      renderCell: (params) => (
        <Switch
          checked={params.value}
          onChange={(e) => {
            e.stopPropagation();
            params.api.setEditCellValue({
              id: params.id,
              field: 'canRespond',
              value: e.target.checked
            }, e);
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
          actions={[
            {
              label: 'Send Reminder',
              icon: <EmailIcon fontSize="small" />,
              handler: async (row) => {
                try {
                  await api.post('/testEmail', {
                    email: row.email,
                    surveyName: params.row.surveyName,
                    language: row.language
                  });
                } catch (error) {
                  console.error('Error sending reminder:', error);
                }
              }
            },
            {
              label: 'Delete Respondent',
              icon: <DeleteIcon fontSize="small" />,
              color: 'error.main',
              handler: async (row) => {
                try {
                  await api.delete('/user', {
                    data: {
                      userName: row.name,
                      surveyName: surveyName
                    }
                  });
                  params.row.onRespondentDeleted();
                } catch (error) {
                  console.error('Error deleting respondent:', error);
                }
              }
            }
          ]}
        />
      ),
    }
  ];



  useEffect(() => {
    if (rows) {
      const updatedRows = rows.map(row => ({
        ...row,
        language: row.language || 'English',
        canRespond: row.canRespond === undefined ? true : row.canRespond,
        onRespondentDeleted: fetchRespondentData
      }));
      setTableRows(updatedRows);
      setOriginalRows(JSON.parse(JSON.stringify(updatedRows)));
    }
  }, [rows]);

  const fetchRespondentData = async () => {
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
      
      const surveysResponse = await api.get('/surveys');
      if (onRespondentsUpdate) {
        onRespondentsUpdate(surveysResponse.data.surveys);
      }
    } catch (error) {
      console.error('Error fetching respondents:', error);
    }
  };

  const handleProcessRowUpdate = (newRow) => {
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
    }
  };

  const handleUpload = async (csvContent) => {
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
    }
  };

  const handleAddRow = () => {
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