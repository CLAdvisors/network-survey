import React from 'react';
import {
  Alert, Box, Button, Chip, CircularProgress, LinearProgress, Paper, Stack,
  Table, TableBody, TableCell, TableHead, TableRow, Typography,
} from '@mui/material';
import RefreshIcon from '@mui/icons-material/Refresh';
import LockIcon from '@mui/icons-material/Lock';
import api from '../api/axios';
import {
  formatDateTime, isLaunchRunning, launchCounts, launchStatus, providerCounts,
  lifecycleLabel, lifecycleStatus, shouldPollLaunch, surveyId,
} from './surveyLifecycle';

export const LifecycleChip = ({ status, size = 'small' }) => {
  const normalized = String(status || 'draft').toLowerCase();
  const color = normalized === 'active' ? 'success' : normalized === 'closed' ? 'default' : 'warning';
  return <Chip size={size} color={color} variant={normalized === 'closed' ? 'outlined' : 'filled'} label={lifecycleLabel(normalized)} />;
};

const statusText = (status) => String(status || 'queued').replaceAll('_', ' ').replace(/^./, (letter) => letter.toUpperCase());

const SurveyLifecyclePanel = ({ survey, onSurveyRefresh, refreshToken = 0 }) => {
  const [launches, setLaunches] = React.useState([]);
  const [launchSurveyId, setLaunchSurveyId] = React.useState(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState('');
  const [manualRefreshToken, setManualRefreshToken] = React.useState(0);
  const generation = React.useRef(0);
  const id = surveyId(survey);

  const load = React.useCallback(async (signal, expectedGeneration) => {
    if (!id) return [];
    setLoading(true);
    try {
      const response = await api.get(`/surveys/${id}/launches`, { signal });
      const next = Array.isArray(response.data) ? response.data : response.data?.launches || [];
      if (!signal.aborted && generation.current === expectedGeneration) {
        setLaunches(next);
        setLaunchSurveyId(id);
        setError('');
        await onSurveyRefresh?.(id, expectedGeneration);
      }
      return next;
    } catch (err) {
      if (!signal.aborted && generation.current === expectedGeneration) {
        setError(err.response?.data?.message || 'Unable to load invitation delivery history.');
        if ([401, 403, 404].includes(err.response?.status)) await onSurveyRefresh?.(id, expectedGeneration);
      }
      return null;
    } finally {
      if (!signal.aborted && generation.current === expectedGeneration) setLoading(false);
    }
  }, [id, onSurveyRefresh]);

  React.useEffect(() => {
    if (!id) return undefined;
    const expectedGeneration = ++generation.current;
    const controller = new AbortController();
    let timer;
    let stopped = false;
    let failures = 0;
    const poll = async () => {
      const next = await load(controller.signal, expectedGeneration);
      if (stopped || generation.current !== expectedGeneration) return;
      if (next === null) {
        failures += 1;
        timer = setTimeout(poll, Math.min(30000, 3000 * (2 ** Math.min(failures - 1, 4))));
      } else {
        failures = 0;
        if (next.some((launch) => shouldPollLaunch(launch))) {
          timer = setTimeout(poll, next.some(isLaunchRunning) ? 3000 : 30000);
        }
      }
    };
    poll();
    return () => {
      stopped = true;
      clearTimeout(timer);
      controller.abort();
    };
  }, [id, load, refreshToken, manualRefreshToken]);

  if (!survey) return null;
  const visibleLaunches = launchSurveyId === id ? launches : [];
  const latest = visibleLaunches[0] || survey.latestLaunch || survey.latest_launch;
  const counts = launchCounts(latest);
  const outcomes = providerCounts(latest);
  const terminal = counts.accepted + counts.failed + counts.uncertain + counts.cancelled;
  const progress = counts.target ? Math.min(100, (terminal / counts.target) * 100) : 0;
  const hasIssue = counts.failed + counts.uncertain + counts.cancelled > 0;
  const hasProviderIssue = outcomes.bounced + outcomes.complained + outcomes.suppressed + outcomes.providerFailed > 0;
  const summary = latest
    ? `${statusText(launchStatus(latest))}: ${terminal} of ${counts.target} finished; ${counts.pending} pending, ${counts.leased} sending, ${counts.retryWait} waiting to retry, ${counts.accepted} accepted, ${counts.failed} failed, ${counts.uncertain} uncertain, ${counts.cancelled} cancelled.`
    : 'No invitation launch history.';
  const providerSummary = `${outcomes.delivered} delivered, ${outcomes.delayed} delayed, ${outcomes.bounced} bounced, ${outcomes.complained} complained, ${outcomes.suppressed} suppressed, ${outcomes.providerFailed} provider failed, ${outcomes.acceptedUnverified} accepted / unverified.`;

  const manualRefresh = () => setManualRefreshToken((value) => value + 1);

  return (
    <Paper elevation={2} sx={{ p: 3, mb: 3 }} aria-label={`Lifecycle for ${survey.name}`}>
      <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" spacing={2}>
        <Box>
          <Stack direction="row" alignItems="center" spacing={1}>
            <Typography variant="h6">Survey lifecycle</Typography>
            <LifecycleChip status={lifecycleStatus(survey)} />
          </Stack>
          <Typography variant="body2" color="text.secondary">
            Started {formatDateTime(survey.startedAt || survey.started_at)}{survey.startedByName ? ` by ${survey.startedByName}` : ''}
          </Typography>
        </Box>
        <Button onClick={manualRefresh} startIcon={loading ? <CircularProgress size={16} /> : <RefreshIcon />} disabled={loading} aria-label={`Refresh lifecycle for ${survey.name}`}>
          Refresh
        </Button>
      </Stack>

      {error && <Alert severity="error" sx={{ mt: 2 }}>{error}</Alert>}
      {latest && <Box sx={{ mt: 2 }}>
        <Typography variant="subtitle2">Latest invitation dispatch</Typography>
        <LinearProgress variant="determinate" value={progress} sx={{ my: 1 }} aria-label="Invitation dispatch progress" />
        <Typography aria-live="polite" role="status" variant="body2">{summary}</Typography>
        <Box component="section" aria-label="Provider outcome summary" sx={{ mt: 1 }}>
          <Typography variant="subtitle2">Provider outcomes</Typography>
          <Typography aria-live="polite" variant="body2">{providerSummary}</Typography>
        </Box>
        <Typography variant="caption" color="text.secondary">Dispatch acceptance is separate from mailbox delivery. Accepted / unverified means no mailbox outcome has been recorded yet. Terminal launches refresh automatically for seven days; older history uses manual refresh.</Typography>
      </Box>}
      {hasIssue && <Alert severity={counts.uncertain ? 'warning' : 'error'} sx={{ mt: 2 }}>
        Some invitations were not accepted. Failed, uncertain, and cancelled messages remain visible in history.
      </Alert>}
      {hasProviderIssue && <Alert severity="warning" sx={{ mt: 2 }}>
        Some accepted invitations have an adverse provider outcome. Provider outcomes do not change dispatch progress.
      </Alert>}
      {lifecycleStatus(survey) !== 'draft' && <Alert severity="info" icon={<LockIcon />} sx={{ mt: 2 }}>
        Questions, respondents, notification templates, and survey design are read-only while this survey is {lifecycleStatus(survey)}.
      </Alert>}

      {visibleLaunches.length > 0 && <Box sx={{ mt: 2, overflowX: 'auto' }}>
        <Typography variant="subtitle2" sx={{ mb: 1 }}>Launch history</Typography>
        <Table size="small" aria-label="Invitation launch history">
          <TableHead><TableRow><TableCell>Created</TableCell><TableCell>Dispatch status</TableCell><TableCell>In progress</TableCell><TableCell align="right">Accepted / target</TableCell><TableCell align="right">Failed</TableCell><TableCell align="right">Uncertain</TableCell><TableCell align="right">Cancelled</TableCell><TableCell>Provider outcomes</TableCell></TableRow></TableHead>
          <TableBody>{visibleLaunches.map((launch, index) => { const rowCounts = launchCounts(launch); const rowOutcomes = providerCounts(launch); return (
            <TableRow key={launch.id || launch.launchId || index}><TableCell>{formatDateTime(launch.createdAt || launch.created_at)}</TableCell><TableCell>{statusText(launchStatus(launch))}</TableCell><TableCell>{rowCounts.pending} pending · {rowCounts.leased} sending · {rowCounts.retryWait} retrying</TableCell><TableCell align="right">{rowCounts.accepted} / {rowCounts.target}</TableCell><TableCell align="right">{rowCounts.failed}</TableCell><TableCell align="right">{rowCounts.uncertain}</TableCell><TableCell align="right">{rowCounts.cancelled}</TableCell><TableCell>{rowOutcomes.delivered} delivered · {rowOutcomes.delayed} delayed · {rowOutcomes.bounced} bounced · {rowOutcomes.complained} complained · {rowOutcomes.suppressed} suppressed · {rowOutcomes.providerFailed} provider failed · {rowOutcomes.acceptedUnverified} accepted / unverified</TableCell></TableRow>
          ); })}</TableBody>
        </Table>
      </Box>}
    </Paper>
  );
};

export default SurveyLifecyclePanel;
