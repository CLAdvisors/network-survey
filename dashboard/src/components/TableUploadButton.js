import React, { useState } from 'react';
import { 
  Box, 
  Button, 
  Alert, 
  Collapse, 
  IconButton 
} from '@mui/material';
import UploadFileIcon from '@mui/icons-material/UploadFile';
import DownloadIcon from '@mui/icons-material/Download';
import CloseIcon from '@mui/icons-material/Close';

const TableUploadButton = ({ onUpload, templateData, tableName }) => {
  const [alert, setAlert] = useState({ show: false, type: 'info', message: '' });

  const handleCloseAlert = () => {
    setAlert({ ...alert, show: false });
  };

  const handleFileUpload = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const csv = e.target?.result;
        await onUpload(csv);
        setAlert({
          show: true,
          type: 'success',
          message: `${tableName} updated successfully from CSV`
        });
      } catch (error) {
        setAlert({
          show: true,
          type: 'error',
          message: error.message || `Failed to process CSV file`
        });
      }
    };
    reader.readAsText(file);
    event.target.value = '';
  };

  const handleDownloadTemplate = () => {
    const csvContent = templateData.join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${tableName.toLowerCase()}_template.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
  };

  return (
    <Box>
      <Box sx={{ display: 'flex', gap: 2 }}>
        <Button
          variant="outlined"
          startIcon={<DownloadIcon />}
          onClick={handleDownloadTemplate}
          size="small"
        >
          Template
        </Button>
        <Button
          variant="contained"
          component="label"
          startIcon={<UploadFileIcon />}
          size="small"
        >
          Upload
          <input
            type="file"
            hidden
            accept=".csv"
            onChange={handleFileUpload}
          />
        </Button>
      </Box>
      <Collapse in={alert.show}>
        <Alert 
          severity={alert.type}
          action={
            <IconButton
              aria-label="close"
              color="inherit"
              size="small"
              onClick={handleCloseAlert}
            >
              <CloseIcon fontSize="inherit" />
            </IconButton>
          }
          sx={{ mt: 2, position: 'absolute', right: '24px', zIndex: 1000 }}
        >
          {alert.message}
        </Alert>
      </Collapse>
    </Box>
  );
};

export default TableUploadButton;