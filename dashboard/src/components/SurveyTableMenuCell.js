import React, { useState } from 'react';
import {
  IconButton,
  Menu,
  MenuItem,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Typography,
  Snackbar,
  Alert
} from '@mui/material';
import MoreHorizIcon from '@mui/icons-material/MoreHoriz';
import DeleteIcon from '@mui/icons-material/Delete';
import PlayCircle from '@mui/icons-material/PlayCircle';
import VisibilityIcon from '@mui/icons-material/Visibility';
import EmailIcon from '@mui/icons-material/Email';
import SendDemoDialog from './SendDemoDialog';
import api from '../api/axios';

const MenuCell = ({ row, onSurveyDeleted }) => {
  const [anchorEl, setAnchorEl] = useState(null);
  const [sendDemoOpen, setSendDemoOpen] = useState(false);
  const [startConfirmOpen, setStartConfirmOpen] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [snackbar, setSnackbar] = useState({
    open: false,
    message: '',
    severity: 'success'
  });
  const open = Boolean(anchorEl);

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
      await api.post('/startSurvey', { surveyName: row.name });
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

  const handleDeleteClick = (event) => {
    event.stopPropagation();
    setDeleteConfirmOpen(true);
    handleClose();
  };

  const handleDeleteConfirm = async () => {
    try {
      const response = await api.delete(`/survey/${row.name}`);
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

  const handleView = (event) => {
    event.stopPropagation();
    window.open(`${process.env.REACT_APP_SURVEY_PROTOCOL}://${process.env.REACT_APP_SURVEY_ENDPOINT}/?surveyName=${row.name}&userId=demo`);
    handleClose();
  };

  const handleSendDemo = (event) => {
    event.stopPropagation();
    setSendDemoOpen(true);
    handleClose();
  };

  const handleSendDemoSubmit = async (email, language) => {
    try {
      await api.post('/testEmail', {
        surveyName: row.name,
        email: email,
        language: language
      });
      setSendDemoOpen(false);
      setSnackbar({
        open: true,
        message: 'Demo email sent successfully',
        severity: 'success'
      });
    } catch (error) {
      console.error('Error sending demo email:', error);
      setSnackbar({
        open: true,
        message: 'Failed to send demo email. Please try again.',
        severity: 'error'
      });
    }
  };

  return (
    <>
      <IconButton
        onClick={handleClick}
        size="small"
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
        <MenuItem onClick={handleView}>
          <VisibilityIcon fontSize="small" />
          Demo Survey
        </MenuItem>
        <MenuItem onClick={handleSendDemo}>
          <EmailIcon fontSize="small" />
          Send Demo Email
        </MenuItem>
        <MenuItem onClick={handleStartClick}>
          <PlayCircle fontSize="small" />
          Start Survey
        </MenuItem>
        <MenuItem onClick={handleDeleteClick} sx={{ color: 'error.main' }}>
          <DeleteIcon fontSize="small" />
          Delete Survey
        </MenuItem>
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
        open={deleteConfirmOpen}
        onClose={handleDeleteCancel}
        onClick={(e) => e.stopPropagation()}
      >
        <DialogTitle>Delete Survey</DialogTitle>
        <DialogContent>
          <Typography>
            Are you sure you want to delete the survey "{row.name}"? This action cannot be undone.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleDeleteCancel}>Cancel</Button>
          <Button onClick={handleDeleteConfirm} variant="contained" color="error">
            Delete Survey
          </Button>
        </DialogActions>
      </Dialog>

      <SendDemoDialog
        open={sendDemoOpen}
        onClose={() => setSendDemoOpen(false)}
        onSubmit={handleSendDemoSubmit}
        surveyName={row.name}
      />
      
    </>
  );
};

export default MenuCell;