import React, { useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Paper,
  TextField,
  Typography,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import api from '../api/axios';

const SurveyContentEditor = ({ surveyId, onDirtyChange, onBusyChange }) => {
  const theme = useTheme();
  const [instructions, setInstructions] = useState('');
  const [originalInstructions, setOriginalInstructions] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [saving, setSaving] = useState(false);
  const [alert, setAlert] = useState(null);

  useEffect(() => {
    let active = true;

    setInstructions('');
    setOriginalInstructions('');
    setAlert(null);
    setLoadFailed(false);

    if (!surveyId) {
      setLoading(false);
      return () => { active = false; };
    }

    const loadContent = async () => {
      setLoading(true);
      try {
        const response = await api.get(`/survey-content/${surveyId}`);
        if (!active) return;
        const value = typeof response.data?.instructions === 'string'
          ? response.data.instructions
          : '';
        setInstructions(value);
        setOriginalInstructions(value);
      } catch (error) {
        if (!active) return;
        setLoadFailed(true);
      } finally {
        if (active) setLoading(false);
      }
    };

    loadContent();
    return () => { active = false; };
  }, [surveyId, loadAttempt]);

  const dirty = instructions !== originalInstructions;

  useEffect(() => {
    onDirtyChange?.(dirty);
    return () => onDirtyChange?.(false);
  }, [dirty, onDirtyChange]);

  useEffect(() => {
    onBusyChange?.(saving);
    return () => onBusyChange?.(false);
  }, [saving, onBusyChange]);

  const handleSave = async () => {
    if (!surveyId || loadFailed || !dirty) return;
    setSaving(true);
    setAlert(null);
    try {
      await api.put(`/survey-content/${surveyId}`, { instructions });
      setOriginalInstructions(instructions);
      setAlert({ severity: 'success', message: 'Survey instructions saved.' });
    } catch (error) {
      setAlert({ severity: 'error', message: 'Failed to save survey instructions.' });
    } finally {
      setSaving(false);
    }
  };

  const handleReset = () => {
    setInstructions(originalInstructions);
    setAlert(null);
  };

  return (
    <Paper elevation={2} sx={{ p: 3, bgcolor: theme.palette.background.paper, borderRadius: 2 }}>
      <Typography variant="h6" color="primary" sx={{ fontWeight: 'bold', mb: 2 }}>
        Survey Instructions
      </Typography>

      {loadFailed && (
        <Alert
          severity="error"
          sx={{ mb: 2 }}
          action={<Button color="inherit" size="small" onClick={() => setLoadAttempt((value) => value + 1)}>Retry</Button>}
        >
          Failed to load survey instructions. Editing is disabled until the content is reloaded.
        </Alert>
      )}

      {alert && (
        <Alert severity={alert.severity} onClose={() => setAlert(null)} sx={{ mb: 2 }}>
          {alert.message}
        </Alert>
      )}

      {loading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
          <CircularProgress aria-label="Loading survey instructions" />
        </Box>
      ) : (
        <>
          <TextField
            fullWidth
            multiline
            minRows={5}
            label="Instructions shown to respondents"
            value={instructions}
            onChange={(event) => {
              setInstructions(event.target.value);
              if (alert?.severity === 'success') setAlert(null);
            }}
            disabled={!surveyId || loading || loadFailed || saving}
            helperText="Plain text only. Line breaks will be preserved. Leave empty to hide the instructions block."
          />
          <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 1, mt: 2 }}>
            <Button onClick={handleReset} disabled={loadFailed || !dirty || saving}>
              Reset
            </Button>
            <Button variant="contained" onClick={handleSave} disabled={loadFailed || !dirty || saving}>
              {saving ? 'Saving…' : 'Save'}
            </Button>
          </Box>
        </>
      )}
    </Paper>
  );
};

export default SurveyContentEditor;
