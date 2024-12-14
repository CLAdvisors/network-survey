import React from 'react';
import { 
  Box, 
  Button,
} from '@mui/material';
import UploadFileIcon from '@mui/icons-material/UploadFile';
import DownloadIcon from '@mui/icons-material/Download';

const TableUploadButton = ({ onUpload, templateData, tableName }) => {

  const handleFileUpload = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const csv = e.target?.result;
        await onUpload(csv);
      } catch (error) {
        console.log('Error uploading file:', error);
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
    </Box>
  );
};

export default TableUploadButton;