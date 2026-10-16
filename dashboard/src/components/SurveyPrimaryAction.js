import React, { useEffect, useState } from 'react';
import { Button } from '@mui/material';
import MailIcon from '@mui/icons-material/MailOutlineOutlined';
import BarChartIcon from '@mui/icons-material/BarChartOutlined';
import ArrowForwardIcon from '@mui/icons-material/ArrowForwardIosOutlined';
import StartSurveyDialog from './StartSurveyDialog';
import ReminderCampaignDialog from './ReminderCampaignDialog';
import { capability, lifecycleStatus, surveyId } from './surveyLifecycle';
import { useAuth } from '../context/AuthContext';
import { STUDIO } from '../theme/studioTokens';

// Prominent workspace action. Reuses the same guarded launch/reminder dialogs and
// accepted-callback behavior as the survey action menu, so permissions, unsaved
// draft guards and pending-operation guards are identical.
const SurveyPrimaryAction = ({ survey, unsavedChanges = {}, pendingOperations = {}, onLifecycleChange, onSurveyUpdated, onNotify, onViewResults, launchSignal = 0 }) => {
  const [launchOpen, setLaunchOpen] = useState(false);
  const [reminderOpen, setReminderOpen] = useState(false);

  useEffect(() => {
    if (launchSignal > 0) setLaunchOpen(true);
  }, [launchSignal]);
  const { canEditSurvey, hasSurveyRole } = useAuth();
  const status = lifecycleStatus(survey);
  const id = surveyId(survey);
  const canEdit = canEditSurvey(survey);
  const canLaunch = status === 'draft' && capability(survey, 'canLaunch', canEdit);
  const canRemind = status === 'active' && typeof hasSurveyRole === 'function' && hasSurveyRole(survey, 'admin');

  const refreshSelected = async (payload) => {
    const refreshed = await onLifecycleChange?.(id, payload);
    const selected = Array.isArray(refreshed) ? refreshed.find((item) => surveyId(item) === id) : null;
    if (selected) onSurveyUpdated?.(selected);
  };

  const handleLaunchAccepted = async (payload) => {
    setLaunchOpen(false);
    onNotify?.({ severity: 'success', message: 'Invitation launch queued. Track acceptance and failures in delivery status.' });
    onSurveyUpdated?.({ ...survey, lifecycleStatus: payload?.lifecycleStatus || payload?.launch?.lifecycleStatus || 'active' });
    await refreshSelected(payload);
  };

  const handleReminderAccepted = async (payload) => {
    setReminderOpen(false);
    onNotify?.({ severity: 'success', message: payload?.message || 'Reminder campaign queued.' });
    onSurveyUpdated?.({ ...survey, latestLaunch: payload?.launch });
    await refreshSelected(payload);
  };

  const primarySx = {
    bgcolor: STUDIO.teal,
    '&:hover': { bgcolor: STUDIO.tealDark },
    textTransform: 'none',
    fontWeight: 700,
    fontSize: 12,
    px: 2,
    py: 1,
  };

  return (
    <>
      {canLaunch && (
        <Button variant="contained" onClick={() => setLaunchOpen(true)} endIcon={<ArrowForwardIcon sx={{ fontSize: 13 }} />} sx={primarySx} aria-label={`Review and launch ${survey.name}`}>
          Review &amp; launch
        </Button>
      )}
      {canRemind && (
        <Button variant="contained" onClick={() => setReminderOpen(true)} startIcon={<MailIcon sx={{ fontSize: 17 }} />} sx={primarySx} aria-label={`Send reminder for ${survey.name}`}>
          Send reminder
        </Button>
      )}
      {status === 'closed' && (
        <Button variant="contained" onClick={onViewResults} startIcon={<BarChartIcon sx={{ fontSize: 17 }} />} sx={primarySx} aria-label={`View results for ${survey.name}`}>
          View results
        </Button>
      )}

      <StartSurveyDialog
        open={launchOpen}
        survey={survey}
        onClose={() => setLaunchOpen(false)}
        onAccepted={handleLaunchAccepted}
        unsavedChanges={unsavedChanges}
        pendingOperations={pendingOperations}
      />
      <ReminderCampaignDialog
        open={reminderOpen}
        survey={survey}
        onClose={() => setReminderOpen(false)}
        onAccepted={handleReminderAccepted}
        unsavedChanges={unsavedChanges}
        pendingOperations={pendingOperations}
      />
    </>
  );
};

export default SurveyPrimaryAction;
