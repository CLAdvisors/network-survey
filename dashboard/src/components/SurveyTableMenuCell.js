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
import api from '../api/axios';
import { useAuth } from '../context/AuthContext';

const MenuCell = ({ row, onSurveyDeleted }) => {
  const [anchorEl, setAnchorEl] = useState(null);
  const [startConfirmOpen, setStartConfirmOpen] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
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