import React, { useRef } from 'react';
import { 
  Box, 
  Button,
} from '@mui/material';
import UploadFileIcon from '@mui/icons-material/UploadFile';
import DownloadIcon from '@mui/icons-material/Download';

const TableUploadButton = ({ onUpload, templateData, tableName, disabled = false }) => {
  const disabledRef = useRef(disabled);
  disabledRef.current = disabled;

  const handleFileUpload = async (event) => {
    if (disabledRef.current) return;
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        // A draft may be created while FileReader is still loading. Re-check the
        // latest prop so that delayed upload cannot overwrite those edits.
        if (disabledRef.current) return;
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
          disabled={disabled}
        >
          Upload
          <input
            type="file"
            hidden
            disabled={disabled}
            accept=".csv"
            onChange={handleFileUpload}
          />
        </Button>
      </Box>
    </Box>
  );
};

export default TableUploadButton;