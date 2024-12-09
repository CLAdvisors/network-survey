import React, { useState, useEffect } from 'react';
import { 
  Box, 
  TextField, 
  Autocomplete,
  Paper,
  Typography,
  Button,
  Alert,
  Collapse,
  IconButton
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import EditableTableWrapper from './EditableTableWrapper';
import UploadFileIcon from '@mui/icons-material/UploadFile';
import CloseIcon from '@mui/icons-material/Close';
import DownloadIcon from '@mui/icons-material/Download';
import api from '../api/axios';

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

const EmailNotificationEditor = ({ surveyId }) => {
  const theme = useTheme();
  const [selectedLanguage, setSelectedLanguage] = useState(LANGUAGES[0]);
  const [notificationText, setNotificationText] = useState('');
  const [originalText, setOriginalText] = useState('');
  const [hasChanges, setHasChanges] = useState(false);
  const [notifications, setNotifications] = useState({});
  const [alert, setAlert] = useState({ show: false, type: 'info', message: '' });
  
  const handleCloseAlert = () => {
    setAlert({ ...alert, show: false });
  };

  // Fetch notifications for the survey
  useEffect(() => {
    const fetchNotifications = async () => {
      try {
        const response = await api.get(`/survey-notifications/${surveyId}`);
        setNotifications(response.data.notifications);
        setNotificationText(response.data.notifications[LANGUAGES[0].code] || '');
        setOriginalText(response.data.notifications[LANGUAGES[0].code] || '');
      } catch (error) {
        console.error('Failed to fetch notifications:', error);
        setAlert({
          show: true,
          type: 'error',
          message: 'Failed to load notifications'
        });
      }
    };

    if (surveyId) {
      fetchNotifications();
    }
  }, [surveyId]);

  const handleLanguageChange = (event, newValue) => {
    if (newValue) {
      setSelectedLanguage(newValue);
      setNotificationText(notifications[newValue.code] || '');
      setOriginalText(notifications[newValue.code] || '');
      setHasChanges(false);
    }
  };

  const handleTextChange = (event) => {
    const newText = event.target.value;
    setNotificationText(newText);
    setHasChanges(newText !== originalText);
  };

  const handleSave = async () => {
    try {
      await api.post(`/update-notification`, {
        surveyId,
        languageCode: selectedLanguage.code,
        text: notificationText
      });

      setNotifications(prev => ({
        ...prev,
        [selectedLanguage.code]: notificationText
      }));
      setOriginalText(notificationText);
      setHasChanges(false);
      setAlert({
        show: true,
        type: 'success',
        message: 'Notification text saved successfully'
      });
    } catch (error) {
      console.error('Failed to save notification:', error);
      setAlert({
        show: true,
        type: 'error',
        message: 'Failed to save notification'
      });
    }
  };

  const handleFileUpload = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const csv = e.target?.result;
        const lines = csv.split('\n');
        const headers = lines[0].split(',');
        
        if (!headers.includes('language_code') || !headers.includes('notification_text')) {
          setAlert({
            show: true,
            type: 'error',
            message: 'CSV must contain columns: language_code, notification_text'
          });
          return;
        }

        const langCodeIndex = headers.indexOf('language_code');
        const textIndex = headers.indexOf('notification_text');
        const newNotifications = { ...notifications };

        for (let i = 1; i < lines.length; i++) {
          const values = lines[i].split(',');
          if (values.length > 1) {
            const langCode = values[langCodeIndex].trim();
            const text = values[textIndex].trim();
            if (LANGUAGES.some(lang => lang.code === langCode)) {
              newNotifications[langCode] = text;
            }
          }
        }

        await api.post(`/update-notifications-bulk`, {
          surveyId,
          notifications: newNotifications
        });

        setNotifications(newNotifications);
        setNotificationText(newNotifications[selectedLanguage.code] || '');
        setOriginalText(newNotifications[selectedLanguage.code] || '');
        setHasChanges(false);

        setAlert({
          show: true,
          type: 'success',
          message: 'Notifications updated successfully from CSV'
        });
      } catch (error) {
        console.error('Failed to process CSV:', error);
        setAlert({
          show: true,
          type: 'error',
          message: 'Failed to process CSV file'
        });
      }
    };
    reader.readAsText(file);
    // Reset file input
    event.target.value = '';
  };

  const handleDownloadTemplate = () => {
    const csvContent = [
      'language_code,notification_text',
      ...LANGUAGES.map(lang => `${lang.code},""`)
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'notification_template.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
  };

  return (
    <Paper
      elevation={2}
      sx={{
        p: 3,
        bgcolor: theme.palette.background.paper,
        borderRadius: 2,
      }}
    >
      <Box sx={{ mb: 2 }}>
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
            sx={{ mb: 2 }}
          >
            {alert.message}
          </Alert>
        </Collapse>
      </Box>

      <Box sx={{ 
        display: 'flex', 
        justifyContent: 'space-between', 
        alignItems: 'center',
        mb: 3,
        borderBottom: `2px solid ${theme.palette.primary.main}`,
        pb: 1
      }}>
        <Typography
          variant="h6"
          color="primary"
          sx={{ fontWeight: 'bold' }}
        >
          Survey Notification Text
        </Typography>
        
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
      
      <EditableTableWrapper
        onSave={handleSave}
        hasChanges={hasChanges}
        setHasChanges={setHasChanges}
      >
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          <Autocomplete
            value={selectedLanguage}
            onChange={handleLanguageChange}
            options={LANGUAGES}
            getOptionLabel={(option) => option.label}
            renderInput={(params) => (
              <TextField
                {...params}
                label="Select Language"
                variant="outlined"
              />
            )}
            sx={{ width: '100%', maxWidth: 300 }}
          />

          <TextField
            fullWidth
            multiline
            rows={8}
            label="Notification Text"
            value={notificationText}
            onChange={handleTextChange}
            variant="outlined"
            placeholder={`Enter notification text for ${selectedLanguage.label}...`}
            sx={{
              '& .MuiOutlinedInput-root': {
                backgroundColor: theme.palette.background.default,
              }
            }}
          />
        </Box>
      </EditableTableWrapper>
    </Paper>
  );
};

export default EmailNotificationEditor;