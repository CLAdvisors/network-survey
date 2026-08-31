import React, { useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  IconButton,
  Menu,
  MenuItem,
  Snackbar,
  TextField,
} from '@mui/material';
import MoreHorizIcon from '@mui/icons-material/MoreHoriz';
import DeleteIcon from '@mui/icons-material/Delete';
import PlayCircle from '@mui/icons-material/PlayCircle';
import EmailIcon from '@mui/icons-material/Email';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import HistoryIcon from '@mui/icons-material/History';
import StopCircleIcon from '@mui/icons-material/StopCircle';
import ReplayIcon from '@mui/icons-material/Replay';
import api from '../api/axios';
import SendDemoDialog from './SendDemoDialog';
import StartSurveyDialog from './StartSurveyDialog';
import { capability, errorMessage, lifecycleStatus, surveyId } from './surveyLifecycle';
import { useAuth } from '../context/AuthContext';

const buildDefaultCopiedName = (name) => {
  const sourceName = String(name || '').replace(/[^A-Za-z0-9]/g, '');
  const baseName = sourceName.slice(0, 251) || 'Survey';
  const candidate = `${baseName}Copy`;
  return candidate === sourceName ? `${sourceName.slice(0, 250)}Copy2` : candidate;
};

const MenuCell = ({ row, onSurveyDeleted, onSurveyCopied, onLifecycleChange, onViewLifecycle, unsavedChanges = {}, pendingOperations = {} }) => {
  const [anchorEl, setAnchorEl] = useState(null);
  const [startOpen, setStartOpen] = useState(false);
  const [copyDialogOpen, setCopyDialogOpen] = useState(false);
  const [copiedName, setCopiedName] = useState(buildDefaultCopiedName(row.name));
  const [copying, setCopying] = useState(false);
  const [copyError, setCopyError] = useState('');
  const [transition, setTransition] = useState(null);
  const [transitioning, setTransitioning] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [demoDialogOpen, setDemoDialogOpen] = useState(false);
  const [demoSending, setDemoSending] = useState(false);
  const [snackbar, setSnackbar] = useState({ open: false, message: '', severity: 'success' });
  const { canEditSurvey, canArchiveSurvey, hasSurveyRole } = useAuth();
  const status = lifecycleStatus(row);
  const id = surveyId(row);
  const canEdit = canEditSurvey(row);
  const canLaunch = status === 'draft' && capability(row, 'canLaunch', canEdit);
  const canClose = status === 'active' && capability(row, 'canClose', canEdit);
  const canReopen = status === 'closed' && capability(row, 'canReopen', hasSurveyRole(row, 'admin'));
  const hasUnsavedChanges = Object.values(unsavedChanges).some(Boolean);
  const hasPendingOperations = Object.values(pendingOperations).some(Boolean);
  const actionBlocked = hasUnsavedChanges || hasPendingOperations;
  const blockedActionMessage = hasPendingOperations
    ? `Wait for the current update to “${row.name}” to finish.`
    : `Save or undo changes to “${row.name}” before continuing.`;

  const notify = (message, severity = 'success') => setSnackbar({ open: true, message, severity });
  const handleCloseSnackbar = (_, reason) => reason !== 'clickaway' && setSnackbar((value) => ({ ...value, open: false }));
  const stop = (event) => event?.stopPropagation();
  const closeMenu = (event) => { stop(event); setAnchorEl(null); };
  const openAction = (setter) => (event) => { stop(event); setter(true); setAnchorEl(null); };

  const handleCopyClick = (event) => {
    stop(event);
    if (actionBlocked) {
      setAnchorEl(null);
      notify(`${blockedActionMessage} Copy uses only persisted survey content.`, 'warning');
      return;
    }
    setCopiedName(buildDefaultCopiedName(row.name));
    setCopyError('');
    setCopyDialogOpen(true);
    setAnchorEl(null);
  };

  const handleCopyClose = () => {
    if (copying) return;
    setCopyDialogOpen(false);
    setCopyError('');
  };

  const handleCopyConfirm = async () => {
    if (actionBlocked) {
      setCopyError(`${blockedActionMessage} Copy uses only persisted survey content.`);
      return;
    }
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
      const response = await api.post(`/surveys/${id}/copy`, { name });
      setCopyDialogOpen(false);
      notify(response.data?.message || `Survey copied successfully as "${name}".`);
      await onSurveyCopied?.(response.data?.survey);
    } catch (error) {
      setCopyError(error.response?.data?.message || 'Failed to copy survey. Please try again.');
    } finally {
      setCopying(false);
    }
  };

  const handleDemoClick = (event) => {
    stop(event);
    setAnchorEl(null);
    if (actionBlocked) {
      notify(`${blockedActionMessage} Email demos use only persisted survey content.`, 'warning');
      return;
    }
    setDemoDialogOpen(true);
  };

  const handleDemoSubmit = async (email, language) => {
    if (actionBlocked) {
      setDemoDialogOpen(false);
      notify(`${blockedActionMessage} Email demos use only persisted survey content.`, 'warning');
      return;
    }
    setDemoSending(true);
    try {
      const response = await api.post(`/surveys/${id}/demo-email`, { email, language });
      setDemoDialogOpen(false);
      notify(response.data?.message || 'Demo survey email sent successfully');
    } catch (error) {
      notify(error.response?.data?.message || 'Failed to send demo survey email. Please try again.', 'error');
    } finally {
      setDemoSending(false);
    }
  };

  const handleLaunchAccepted = async (payload) => {
    setStartOpen(false);
    notify('Invitation launch queued. Track acceptance and failures in delivery status.');
    onViewLifecycle?.({
      ...row,
      lifecycleStatus: payload?.lifecycleStatus || payload?.launch?.lifecycleStatus || 'active',
    });
    const refreshedSurveys = await onLifecycleChange?.(id, payload);
    const refreshed = Array.isArray(refreshedSurveys)
      ? refreshedSurveys.find((survey) => surveyId(survey) === id)
      : null;
    if (refreshed) onViewLifecycle?.(refreshed);
  };

  const handleTransition = async () => {
    if (!transition || transitioning) return;
    setTransitioning(true);
    try {
      await api.post(`/surveys/${id}/${transition}`);
      notify(transition === 'close'
        ? 'Survey closed. Unsent invitations are being cancelled.'
        : 'Survey reopened. Cancelled invitations were not resumed.');
      setTransition(null);
      onLifecycleChange?.(id);
    } catch (error) {
      notify(errorMessage(error, `Unable to ${transition} this survey.`), 'error');
    } finally {
      setTransitioning(false);
    }
  };

  const handleArchiveClick = (event) => {
    stop(event);
    setAnchorEl(null);
    if (actionBlocked) {
      notify(`${blockedActionMessage} Archive is unavailable until then.`, 'warning');
      return;
    }
    setDeleteConfirmOpen(true);
  };

  const handleDeleteConfirm = async () => {
    if (archiving) return;
    if (actionBlocked) {
      setDeleteConfirmOpen(false);
      notify(`${blockedActionMessage} Archive is unavailable until then.`, 'warning');
      return;
    }
    setArchiving(true);
    try {
      const response = await api.delete(`/survey/${id}`);
      if (response.status === 200) onSurveyDeleted?.(row.name);
      setDeleteConfirmOpen(false);
    } catch (error) {
      notify(errorMessage(error, 'Unable to archive this survey.'), 'error');
    } finally {
      setArchiving(false);
    }
  };

  return (
    <>
      <IconButton
        onClick={(event) => { stop(event); setAnchorEl(event.currentTarget); }}
        size="small"
        aria-label={`${status === 'draft' ? 'Survey actions' : 'Actions'} for ${row.name}`}
      >
        <MoreHorizIcon />
      </IconButton>
      <Snackbar open={snackbar.open} autoHideDuration={6000} onClose={handleCloseSnackbar} anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}>
        <Alert onClose={handleCloseSnackbar} severity={snackbar.severity} variant="filled" sx={{ width: '100%' }}>{snackbar.message}</Alert>
      </Snackbar>
      <Menu anchorEl={anchorEl} open={Boolean(anchorEl)} onClose={closeMenu} PaperProps={{ sx: { minWidth: 190 } }}>
        {canLaunch && <MenuItem onClick={openAction(setStartOpen)}><PlayCircle fontSize="small" sx={{ mr: 1 }} />Launch Survey</MenuItem>}
        {status !== 'draft' && <MenuItem onClick={(event) => { closeMenu(event); onViewLifecycle?.(row); }}><HistoryIcon fontSize="small" sx={{ mr: 1 }} />{status === 'closed' ? 'View History' : 'View Delivery Status'}</MenuItem>}
        {canClose && <MenuItem onClick={(event) => { closeMenu(event); setTransition('close'); }}><StopCircleIcon fontSize="small" sx={{ mr: 1 }} />Close Survey</MenuItem>}
        {canReopen && <MenuItem onClick={(event) => { closeMenu(event); setTransition('reopen'); }}><ReplayIcon fontSize="small" sx={{ mr: 1 }} />Reopen Survey</MenuItem>}
        {canEdit && <MenuItem onClick={handleCopyClick}><ContentCopyIcon fontSize="small" sx={{ mr: 1 }} />Copy Survey</MenuItem>}
        {canEdit && <MenuItem onClick={handleDemoClick}><EmailIcon fontSize="small" sx={{ mr: 1 }} />Send Email Demo</MenuItem>}
        {canArchiveSurvey(row) && <MenuItem onClick={handleArchiveClick} sx={{ color: 'error.main' }}><DeleteIcon fontSize="small" sx={{ mr: 1 }} />Archive Survey</MenuItem>}
      </Menu>

      <StartSurveyDialog open={startOpen} survey={row} onClose={() => setStartOpen(false)} onAccepted={handleLaunchAccepted} unsavedChanges={unsavedChanges} pendingOperations={pendingOperations} />

      <Dialog open={copyDialogOpen} onClose={handleCopyClose} onClick={stop} fullWidth maxWidth="sm">
        <DialogTitle>Copy survey</DialogTitle>
        <Box component="form" noValidate onSubmit={(event) => { event.preventDefault(); handleCopyConfirm(); }}>
          <DialogContent>
            <DialogContentText sx={{ mb: 2 }}>
              Copy the survey title, question schema, and invitation email subject/body templates from “{row.name}”. No participants, contact details, response state, invitation links, or delivery history will be copied.
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
                setCopyError(nextName && !/^[A-Za-z0-9]*$/.test(nextName) ? 'Only letters and numbers are allowed.' : '');
              }}
              error={Boolean(copyError)}
              helperText={copyError || 'The copied survey will start with an empty participant roster.'}
              inputProps={{ maxLength: 255, pattern: '[A-Za-z0-9]*' }}
            />
          </DialogContent>
          <DialogActions>
            <Button onClick={handleCopyClose} disabled={copying}>Cancel</Button>
            <Button type="submit" variant="contained" disabled={copying}>{copying ? 'Copying…' : 'Copy survey'}</Button>
          </DialogActions>
        </Box>
      </Dialog>

      <SendDemoDialog open={demoDialogOpen} onClose={() => setDemoDialogOpen(false)} onSubmit={handleDemoSubmit} surveyName={row.name} loading={demoSending} />

      <Dialog open={Boolean(transition)} onClose={() => !transitioning && setTransition(null)} aria-describedby="transition-description">
        <DialogTitle>{transition === 'close' ? 'Close survey' : 'Reopen survey'}</DialogTitle>
        <DialogContent>
          <DialogContentText id="transition-description">
            {transition === 'close'
              ? `Close “${row.name}”? Respondents will no longer be able to load or submit it, and unsent invitations will be cancelled.`
              : `Reopen “${row.name}”? Respondents can use existing links again. Cancelled invitations will not resume.`}
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setTransition(null)} disabled={transitioning}>Cancel</Button>
          <Button variant="contained" color={transition === 'close' ? 'error' : 'primary'} onClick={handleTransition} disabled={transitioning}>
            {transitioning ? 'Updating…' : transition === 'close' ? 'Close survey' : 'Reopen survey'}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={deleteConfirmOpen} onClose={() => !archiving && setDeleteConfirmOpen(false)} aria-describedby="archive-description" aria-busy={archiving}>
        <DialogTitle>Archive Survey</DialogTitle>
        <DialogContent><DialogContentText id="archive-description">Archive “{row.name}”? Respondents and delivery history will be preserved.</DialogContentText></DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteConfirmOpen(false)} disabled={archiving}>Cancel</Button>
          <Button onClick={handleDeleteConfirm} variant="contained" color="error" disabled={archiving}>{archiving ? 'Archiving…' : 'Archive Survey'}</Button>
        </DialogActions>
      </Dialog>
    </>
  );
};

export default MenuCell;
