import React from 'react';
import {
  Alert, Box, Button, Chip, CircularProgress, Dialog, DialogActions,
  DialogContent, DialogContentText, DialogTitle, Divider, List, ListItem,
  ListItemText, Stack, Typography,
} from '@mui/material';
import api from '../api/axios';
import { errorMessage, lifecycleLabel, surveyId } from './surveyLifecycle';

const newIntentKey = () => {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  const bytes = new Uint8Array(16);
  if (globalThis.crypto?.getRandomValues) globalThis.crypto.getRandomValues(bytes);
  else for (let index = 0; index < bytes.length; index += 1) bytes[index] = Math.floor(Math.random() * 256);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};

const items = (value) => Array.isArray(value) ? value : [];

const StartSurveyDialog = ({ open, survey, onClose, onAccepted }) => {
  const [readiness, setReadiness] = React.useState(null);
  const [loading, setLoading] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState('');
  const [intentKey, setIntentKey] = React.useState(null);
  const requestInFlight = React.useRef(false);
  const id = surveyId(survey);

  React.useEffect(() => {
    if (!open || !id) return undefined;
    const controller = new AbortController();
    setIntentKey(newIntentKey());
    setReadiness(null);
    setError('');
    setLoading(true);
    api.get(`/surveys/${id}/launch-readiness`, { signal: controller.signal })
      .then((response) => setReadiness(response.data))
      .catch((err) => {
        if (!controller.signal.aborted) setError(errorMessage(err, 'Unable to check launch readiness.'));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [open, id]);

  const blockers = items(readiness?.blockers);
  const warnings = items(readiness?.warnings);
  const rawCoverage = readiness?.templateCoverage || readiness?.template_coverage || readiness?.templates || [];
  const coverage = Array.isArray(rawCoverage) ? rawCoverage : Object.entries(rawCoverage).map(([language, value]) => ({ language, ...(typeof value === 'object' ? value : { covered: Boolean(value) }) }));
  const canLaunch = Boolean(readiness?.canLaunch) && blockers.length === 0;

  const submit = async () => {
    if (!canLaunch || submitting || requestInFlight.current || !intentKey) return;
    requestInFlight.current = true;
    setSubmitting(true);
    setError('');
    try {
      const response = await api.post(
        `/surveys/${id}/launches`,
        { kind: 'initial' },
        { headers: { 'Idempotency-Key': intentKey } },
      );
      if (response.status === 202 || response.data?.launchId || response.data?.id || response.data?.launch?.id) {
        onAccepted?.(response.data);
      } else {
        setError('The server did not confirm that the invitation launch was queued.');
      }
    } catch (err) {
      if (err.response?.status === 422 && err.response?.data?.details) {
        setReadiness(err.response.data.details);
      }
      setError(errorMessage(err, 'Unable to queue the invitation launch. The same launch key will be reused.'));
    } finally {
      requestInFlight.current = false;
      setSubmitting(false);
    }
  };

  const count = (camel, snake) => readiness?.[camel] ?? readiness?.[snake] ?? readiness?.recipientCounts?.[camel.replace('Count', '')] ?? 0;
  const messageText = (entry) => typeof entry === 'string' ? entry : entry.message || entry.code;

  return (
    <Dialog open={open} onClose={submitting ? undefined : onClose} fullWidth maxWidth="sm" aria-describedby="launch-dialog-description">
      <DialogTitle>Launch {survey?.name || 'survey'}</DialogTitle>
      <DialogContent aria-busy={loading || submitting}>
        <DialogContentText id="launch-dialog-description" sx={{ mb: 2 }}>
          This queues real invitation emails containing respondent links. Queued or accepted email is not proof of delivery.
        </DialogContentText>
        {loading && <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}><CircularProgress size={20} /> Checking readiness…</Box>}
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
        {readiness && (
          <Stack spacing={2}>
            <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
              <Chip label={`Lifecycle: ${lifecycleLabel(readiness.lifecycleStatus || readiness.lifecycle_status)}`} />
              <Chip label={`${count('eligibleCount', 'eligible_count')} eligible`} />
              <Chip label={`${count('excludedCount', 'excluded_count')} excluded`} />
            </Stack>
            {coverage.length > 0 && (
              <Box><Typography variant="subtitle2">Language and template coverage</Typography>
                <List dense disablePadding>{coverage.map((entry, index) => (
                  <ListItem key={entry.language || index} disableGutters>
                    <ListItemText primary={typeof entry === 'string' ? entry : entry.language} secondary={typeof entry === 'object' ? (entry.covered === false ? 'Template missing' : entry.status || 'Template ready') : undefined} />
                  </ListItem>
                ))}</List>
              </Box>
            )}
            {blockers.length > 0 && <Alert severity="error"><Typography variant="subtitle2">Launch blockers</Typography>{blockers.map((entry, index) => <div key={entry.code || index}>{messageText(entry)}</div>)}</Alert>}
            {warnings.length > 0 && <Alert severity="warning"><Typography variant="subtitle2">Warnings</Typography>{warnings.map((entry, index) => <div key={entry.code || index}>{messageText(entry)}</div>)}</Alert>}
            <Divider />
            <Typography variant="body2">Confirming will activate this survey when the durable launch is accepted. Delivery progress will appear on the dashboard.</Typography>
          </Stack>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={submitting}>Cancel</Button>
        <Button onClick={submit} disabled={!canLaunch || loading || submitting} variant="contained">
          {submitting ? 'Queueing…' : 'Queue invitations'}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default StartSurveyDialog;
