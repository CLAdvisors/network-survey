import React, { useState } from 'react';
import {
  IconButton,
  Menu,
  MenuItem,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogContentText,
  DialogActions,
  Button,
  TextField,
  Typography,
  Snackbar,
  Alert,
  Box
} from '@mui/material';
import MoreHorizIcon from '@mui/icons-material/MoreHoriz';
import DeleteIcon from '@mui/icons-material/Delete';
import PlayCircle from '@mui/icons-material/PlayCircle';
import EmailIcon from '@mui/icons-material/Email';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import api from '../api/axios';
import SendDemoDialog from './SendDemoDialog';
import { useAuth } from '../context/AuthContext';

const buildDefaultCopiedName = (name) => {
  const sourceName = String(name || '').replace(/[^A-Za-z0-9]/g, '');
  const baseName = sourceName.slice(0, 251) || 'Survey';
  const candidate = `${baseName}Copy`;
  return candidate === sourceName ? `${sourceName.slice(0, 250)}Copy2` : candidate;
};

const MenuCell = ({ row, onSurveyDeleted, onSurveyCopied }) => {
  const [anchorEl, setAnchorEl] = useState(null);
  const [startConfirmOpen, setStartConfirmOpen] = useState(false);
  const [copyDialogOpen, setCopyDialogOpen] = useState(false);
  const [copiedName, setCopiedName] = useState(buildDefaultCopiedName(row.name));
  const [copying, setCopying] = useState(false);
  const [copyError, setCopyError] = useState('');
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [demoDialogOpen, setDemoDialogOpen] = useState(false);
  const [demoSending, setDemoSending] = useState(false);
  const [snackbar, setSnackbar] = useState({
    open: false,
    message: '',
    severity: 'success'
  });
  const open = Boolean(anchorEl);
  const { canEditSurvey, canArchiveSurvey } = useAuth();

  // Add handler for closing snackbar
  const handleCloseSnackbar = (event, reason) => {
    if (reason === 'clickaway') {
      return;
    }
    setSnackbar(prev => ({ ...prev, open: false }));
  };

  
  const handleClick = (event) => {
    event.stopPropagation();
    setAnchorEl(event.currentTarget);
  };
  
  const handleClose = (event) => {
    if (event) {
      event.stopPropagation();
    }
    setAnchorEl(null);
  };

  const handleStartClick = (event) => {
    event.stopPropagation();
    setStartConfirmOpen(true);
    handleClose();
  };

  // Modify handleStartConfirm
  const handleStartConfirm = async () => {
    try {
      await api.post('/startSurvey', { surveyName: row.id || row.name });
      setStartConfirmOpen(false);
      setSnackbar({
        open: true,
        message: 'Survey started successfully',
        severity: 'success'
      });
    } catch (error) {
      console.error('Error starting survey:', error);
      setSnackbar({
        open: true,
        message: 'Failed to start survey. Please try again.',
        severity: 'error'
      });
    }
  };

  const handleStartCancel = (event) => {
    if (event) {
      event.stopPropagation();
    }
    setStartConfirmOpen(false);
  };

  const handleCopyClick = (event) => {
    event.stopPropagation();
    setCopiedName(buildDefaultCopiedName(row.name));
    setCopyError('');
    setCopyDialogOpen(true);
    handleClose();
  };

  const handleCopyClose = () => {
    if (copying) return;
    setCopyDialogOpen(false);
    setCopyError('');
  };

  const handleCopyConfirm = async () => {
    const name = copiedName;
    if (!name.trim()) {
      setCopyError('Enter a name for the copied survey.');
      return;
    }
    if (!/^[A-Za-z0-9]+$/.test(name)) {
      setCopyError('Only letters and numbers are allowed.');
      return;
    }

    setCopying(true);
    setCopyError('');
    try {
      const response = await api.post(`/surveys/${row.id || row.name}/copy`, { name });
      setCopyDialogOpen(false);
      setSnackbar({
        open: true,
        message: response.data?.message || `Survey copied successfully as "${name}".`,
        severity: 'success'
      });
      await onSurveyCopied?.(response.data?.survey);
    } catch (error) {
      setCopyError(error.response?.data?.message || 'Failed to copy survey. Please try again.');
    } finally {
      setCopying(false);
    }
  };

  const handleDemoClick = (event) => {
    event.stopPropagation();
    setDemoDialogOpen(true);
    handleClose();
  };

  const handleDemoSubmit = async (email, language) => {
    setDemoSending(true);
    try {
      const response = await api.post(`/surveys/${row.id || row.name}/demo-email`, { email, language });
      setDemoDialogOpen(false);
      setSnackbar({
        open: true,
        message: response.data?.message || 'Demo survey email sent successfully',
        severity: 'success'
      });
    } catch (error) {
      setSnackbar({
        open: true,
        message: error.response?.data?.message || 'Failed to send demo survey email. Please try again.',
        severity: 'error'
      });
    } finally {
      setDemoSending(false);
    }
  };

  const handleDeleteClick = (event) => {
    event.stopPropagation();
    setDeleteConfirmOpen(true);
    handleClose();
  };

  const handleDeleteConfirm = async () => {
    try {
      const response = await api.delete(`/survey/${row.id || row.name}`);
      if (response.status === 200) {
        onSurveyDeleted(row.name);
      }
    } catch (error) {
      console.error('Error deleting survey:', error);
    }
    setDeleteConfirmOpen(false);
  };

  const handleDeleteCancel = (event) => {
    if (event) {
      event.stopPropagation();
    }
    setDeleteConfirmOpen(false);
  };

  return (
    <>
      <IconButton
        onClick={handleClick}
        size="small"
        aria-label={`Survey actions for ${row.name}`}
        sx={{
          '&:hover': {
            backgroundColor: 'rgba(66, 179, 175, 0.1)',
          }
        }}
      >
        <MoreHorizIcon />
      </IconButton>

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
      
      <Menu
        anchorEl={anchorEl}
        open={open}
        onClose={handleClose}
        onClick={handleClose}
        PaperProps={{
          elevation: 3,
          sx: {
            minWidth: 150,
            '& .MuiMenuItem-root': {
              px: 2,
              py: 1,
              gap: 1.5,
            },
          },
        }}
        transformOrigin={{ horizontal: 'right', vertical: 'top' }}
        anchorOrigin={{ horizontal: 'right', vertical: 'bottom' }}
      >
        {canEditSurvey(row) && (
          <MenuItem onClick={handleStartClick}>
            <PlayCircle fontSize="small" />
            Start Survey
          </MenuItem>
        )}
        {canEditSurvey(row) && (
          <MenuItem onClick={handleCopyClick}>
            <ContentCopyIcon fontSize="small" />
            Copy Survey
          </MenuItem>
        )}
        {canEditSurvey(row) && (
          <MenuItem onClick={handleDemoClick}>
            <EmailIcon fontSize="small" />
            Send Email Demo
          </MenuItem>
        )}
        {canArchiveSurvey(row) && (
          <MenuItem onClick={handleDeleteClick} sx={{ color: 'error.main' }}>
            <DeleteIcon fontSize="small" />
            Archive Survey
          </MenuItem>
        )}
      </Menu>

      <Dialog
        open={startConfirmOpen}
        onClose={handleStartCancel}
        onClick={(e) => e.stopPropagation()}
      >
        <DialogTitle>Start Survey</DialogTitle>
        <DialogContent>
          <Typography>
            Are you sure you want to start the survey "{row.name}"? This will initiate the survey process for all respondents.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleStartCancel}>Cancel</Button>
          <Button onClick={handleStartConfirm} variant="contained" color="primary">
            Start Survey
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={copyDialogOpen}
        onClose={handleCopyClose}
        onClick={(event) => event.stopPropagation()}
        fullWidth
        maxWidth="sm"
      >
        <DialogTitle>Copy survey</DialogTitle>
        <Box component="form" onSubmit={(event) => { event.preventDefault(); handleCopyConfirm(); }}>
          <DialogContent>
            <DialogContentText sx={{ mb: 2 }}>
              Copy the complete configuration and respondent roster from “{row.name}”.
              Responses, invitation delivery history, completion state, and access links will be reset.
            </DialogContentText>
            <TextField
              autoFocus
              fullWidth
              required
              label="Copied survey name"
              value={copiedName}
              onChange={(event) => {
                const nextName = event.target.value;
                setCopiedName(nextName);
                setCopyError(nextName && !/^[A-Za-z0-9]*$/.test(nextName)
                  ? 'Only letters and numbers are allowed.'
                  : '');
              }}
              error={Boolean(copyError)}
              helperText={copyError || 'The survey title and invitation templates will be preserved.'}
              inputProps={{ maxLength: 255, pattern: '[A-Za-z0-9]*' }}
            />
          </DialogContent>
          <DialogActions>
            <Button onClick={handleCopyClose} disabled={copying}>Cancel</Button>
            <Button type="submit" variant="contained" disabled={copying}>
              {copying ? 'Copying…' : 'Copy survey'}
            </Button>
          </DialogActions>
        </Box>
      </Dialog>

      <SendDemoDialog
        open={demoDialogOpen}
        onClose={() => setDemoDialogOpen(false)}
        onSubmit={handleDemoSubmit}
        surveyName={row.name}
        loading={demoSending}
      />

      <Dialog
        open={deleteConfirmOpen}
        onClose={handleDeleteCancel}
        onClick={(e) => e.stopPropagation()}
      >
        <DialogTitle>Delete Survey</DialogTitle>
        <DialogContent>
          <Typography>
            Are you sure you want to archive the survey "{row.name}"? Respondents and email templates will be preserved.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleDeleteCancel}>Cancel</Button>
          <Button onClick={handleDeleteConfirm} variant="contained" color="error">
            Archive Survey
          </Button>
        </DialogActions>
      </Dialog>

    </>
  );
};

export default MenuCell;