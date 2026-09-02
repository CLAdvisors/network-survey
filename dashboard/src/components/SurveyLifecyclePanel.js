import React from 'react';
import {
  Alert, Box, Button, Chip, CircularProgress, Paper, Stack, Typography,
} from '@mui/material';
import RefreshIcon from '@mui/icons-material/Refresh';
import LockIcon from '@mui/icons-material/Lock';
import api from '../api/axios';
import {
  formatDateTime, isLaunchRunning, launchCounts, providerCounts,
  lifecycleLabel, lifecycleStatus, shouldPollLaunch, surveyId,
} from './surveyLifecycle';

export const LifecycleChip = ({ status, size = 'small' }) => {
  const normalized = String(status || 'draft').toLowerCase();
  const color = normalized === 'active' ? 'success' : normalized === 'closed' ? 'default' : 'warning';
  return <Chip size={size} color={color} variant={normalized === 'closed' ? 'outlined' : 'filled'} label={lifecycleLabel(normalized)} />;
};

const Metric = ({ value, label, singularLabel, emphasis = false, color = 'text.primary' }) => {
  const displayedLabel = value === 1 && singularLabel ? singularLabel : label;
  return (
    <Box aria-label={`${value} ${displayedLabel}`} sx={{ minWidth: 0 }}>
      <Typography component="p" variant={emphasis ? 'h4' : 'h5'} color={color} sx={{ fontWeight: 700, lineHeight: 1.1 }}>{value}</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>{displayedLabel}</Typography>
    </Box>
  );
};

const SummaryCard = ({ title, supporting, children, ariaLabel }) => (
  <Paper component="section" aria-label={ariaLabel} variant="outlined" sx={{ p: 2, minWidth: 0 }}>
    <Typography component="h3" variant="overline" color="text.secondary" sx={{ display: 'block', fontWeight: 700, lineHeight: 1.5 }}>{title}</Typography>
    <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>{supporting}</Typography>
    {children}
  </Paper>
);

const countLabel = (count, singular, plural = `${singular}s`) => `${count} ${count === 1 ? singular : plural}`;
const joinDescriptions = (parts) => parts.length < 2 ? parts[0] || '' : `${parts.slice(0, -1).join(', ')}, and ${parts.at(-1)}`;

const PlainLanguageBreakdown = ({ counts, outcomes, kind = 'initial' }) => {
  const reminder = kind === 'reminder';
  const email = reminder ? 'reminder' : 'invitation';
  const emails = reminder ? 'reminders' : 'invitations';
  const processing = [
    counts.pending && countLabel(counts.pending, `${email} waiting to start`, `${emails} waiting to start`),
    counts.leased && countLabel(counts.leased, `${email} being sent now`, `${emails} being sent now`),
    counts.retryWait && countLabel(counts.retryWait, `${email} scheduled for another attempt`, `${emails} scheduled for another attempt`),
  ].filter(Boolean);
  const notConfirmed = [
    counts.failed && countLabel(counts.failed, 'permanent failure'),
    counts.uncertain && countLabel(counts.uncertain, 'result that could not be safely confirmed', 'results that could not be safely confirmed'),
    counts.cancelled && countLabel(counts.cancelled, `intentionally stopped ${email}`),
  ].filter(Boolean);
  const problems = [
    outcomes.bounced && countLabel(outcomes.bounced, 'mail-server rejection'),
    outcomes.complained && countLabel(outcomes.complained, 'spam complaint'),
    outcomes.suppressed && countLabel(outcomes.suppressed, 'blocked address'),
    outcomes.providerFailed && countLabel(outcomes.providerFailed, 'provider delivery failure'),
  ].filter(Boolean);

  return (
    <Box sx={{ mt: 1, pl: 2, maxWidth: 950 }}>
      <Typography variant="body2"><strong>Submitted for sending</strong> means the email service received the {email} request. It does not confirm delivery.</Typography>
      <Typography variant="body2" sx={{ mt: 0.75 }}><strong>Still processing:</strong> {processing.length ? joinDescriptions(processing) : 'none'}.</Typography>
      <Typography variant="body2" sx={{ mt: 0.75 }}><strong>Not confirmed sent:</strong> {notConfirmed.length ? joinDescriptions(notConfirmed) : 'none'}.</Typography>
      <Typography variant="body2" sx={{ mt: 0.75 }}><strong>Delivery problem details:</strong> {problems.length ? joinDescriptions(problems) : 'none'}. One email can have more than one problem report.</Typography>
      <Typography variant="body2" sx={{ mt: 0.75 }}><strong>Awaiting a final delivery result</strong> means no delivery confirmation or delivery problem has been reported yet; a delay may already have been reported.</Typography>
      <Typography variant="body2" sx={{ mt: 0.75 }}>A <strong>delivery confirmation</strong> comes from a recipient's mail server. Delay and problem reports are retained and can overlap with later updates.</Typography>
    </Box>
  );
};

const SurveyLifecyclePanel = ({ survey, onSurveyRefresh, refreshToken = 0 }) => {
  const [launches, setLaunches] = React.useState([]);
  const [launchSurveyId, setLaunchSurveyId] = React.useState(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState('');
  const [manualRefreshToken, setManualRefreshToken] = React.useState(0);
  const generation = React.useRef(0);
  const id = surveyId(survey);
  const externalLaunchId = survey?.latestLaunch?.id || survey?.latest_launch?.id || '';

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
  }, [id, externalLaunchId, load, refreshToken, manualRefreshToken]);

  if (!survey) return null;
  const visibleLaunches = launchSurveyId === id ? launches : [];
  const latest = visibleLaunches[0] || survey.latestLaunch || survey.latest_launch;
  const counts = launchCounts(latest);
  const outcomes = providerCounts(latest);
  const adverse = outcomes.problems;
  const inProgress = counts.pending + counts.leased + counts.retryWait;
  const latestKind = latest?.kind === 'reminder' ? 'Reminder' : 'Initial';
  const latestEmail = latest?.kind === 'reminder' ? 'reminder' : 'invitation';
  const latestEmails = latest?.kind === 'reminder' ? 'reminders' : 'invitations';
  const manualRefresh = () => setManualRefreshToken((value) => value + 1);

  return (
    <Paper elevation={2} sx={{ p: { xs: 2, md: 3 }, mb: 3 }} aria-label={`Lifecycle for ${survey.name}`}>
      <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" spacing={2}>
        <Box>
          <Stack direction="row" alignItems="center" spacing={1}>
            <Typography component="h2" variant="h6">Survey lifecycle</Typography>
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
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'repeat(2, minmax(0, 1fr))' }, gap: 2 }}>
          <SummaryCard
            title={latestKind === 'Initial' ? 'Invitation sending' : 'Reminder campaign sending'}
            supporting={latestKind === 'Initial' ? `${counts.target} invitations in this launch` : `${counts.target} reminders in this campaign`}
            ariaLabel={latestKind === 'Initial' ? 'Invitation sending summary' : 'Reminder campaign sending summary'}
          >
            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(3, minmax(0, 1fr))' }, gap: 2, mt: 2 }}>
              <Metric value={counts.accepted} label="submitted for sending" emphasis />
              <Metric value={inProgress} label="still processing" color={inProgress > 0 ? 'info.dark' : 'text.primary'} />
              <Metric value={counts.failed + counts.uncertain + counts.cancelled} label="not confirmed sent" color={counts.failed + counts.uncertain + counts.cancelled > 0 ? 'warning.dark' : 'text.primary'} />
            </Box>
          </SummaryCard>

          <SummaryCard
            title="Delivery confirmation"
            supporting="Updates reported by the email service and recipients' mail servers"
            ariaLabel="Delivery confirmation summary"
          >
            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))' }, gap: 3, mt: 2 }}>
              <Metric value={outcomes.delivered} label="delivery confirmations" singularLabel="delivery confirmation" emphasis color={outcomes.delivered > 0 ? 'success.dark' : 'text.primary'} />
              <Metric value={outcomes.waiting} label="awaiting a final delivery result" color={outcomes.waiting > 0 ? 'warning.dark' : 'text.primary'} />
            </Box>
            <Box sx={{ mt: 2, p: 1.5, borderRadius: 1, bgcolor: 'action.hover' }}>
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', fontWeight: 700 }}>ADDITIONAL DELIVERY SIGNALS — MAY OVERLAP COUNTS ABOVE</Typography>
              <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))' }, gap: 3, mt: 1.25 }}>
                <Metric value={adverse} label={`${latestEmails} with delivery problems`} singularLabel={`${latestEmail} with a delivery problem`} color={adverse > 0 ? 'error.dark' : 'text.primary'} />
                <Metric value={outcomes.delayed} label="delay reports" singularLabel="delay report" color={outcomes.delayed > 0 ? 'warning.dark' : 'text.primary'} />
              </Box>
            </Box>
          </SummaryCard>
        </Box>
        <Box component="details" aria-label="Current launch explanation" sx={{ mt: 1.5, color: 'text.secondary', '& summary': { cursor: 'pointer', width: 'fit-content' } }}>
          <Typography component="summary" variant="body2">How are these numbers calculated?</Typography>
          <PlainLanguageBreakdown counts={counts} outcomes={outcomes} kind={latest?.kind} />
        </Box>
        <Box role="status" aria-live="polite" aria-atomic="true" sx={{ position: 'absolute', width: '1px', height: '1px', p: 0, m: -1, overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap', border: 0 }}>
          {latestKind} campaign update: {counts.accepted} submitted for sending, {inProgress} still processing, {counts.failed + counts.uncertain + counts.cancelled} not confirmed sent. Delivery update: {countLabel(outcomes.delivered, 'confirmation')}, {countLabel(outcomes.waiting, `${latestEmail} awaiting a final result`, `${latestEmails} awaiting a final result`)}, {countLabel(adverse, `${latestEmail} with a delivery problem`, `${latestEmails} with delivery problems`)}, {countLabel(outcomes.delayed, 'delay report')}.
        </Box>
      </Box>}

      {lifecycleStatus(survey) !== 'draft' && <Box sx={{ mt: 2, p: 1.25, borderRadius: 1, bgcolor: 'action.hover', display: 'flex', alignItems: 'center', gap: 1 }}>
        <LockIcon color="action" fontSize="small" />
        <Typography variant="body2" color="text.secondary">
          Questions, respondents, initial-invitation templates, and survey design are read-only while this survey is {lifecycleStatus(survey)}. Reminder templates remain editable by administrators only while it is active.
        </Typography>
      </Box>}

      {visibleLaunches.length > 0 && <Box component="details" sx={{ mt: 3, '& summary': { cursor: 'pointer', width: 'fit-content' } }}>
        <Typography component="summary" variant="subtitle2">View launch history</Typography>
        <Stack spacing={1} sx={{ mt: 1 }} aria-label="Email campaign history">
          {visibleLaunches.map((launch, index) => {
            const rowCounts = launchCounts(launch);
            const rowOutcomes = providerCounts(launch);
            const rowAdverse = rowOutcomes.problems;
            return (
              <Paper component="details" variant="outlined" key={launch.id || launch.launchId || index} sx={{ p: 1.5, '& summary': { cursor: 'pointer' } }}>
                <Typography component="summary" variant="body2" fontWeight={600}>
                  {launch.kind === 'reminder' ? 'Reminder' : 'Initial'} — {formatDateTime(launch.createdAt || launch.created_at)} — {rowCounts.accepted} of {rowCounts.target} submitted for sending
                </Typography>
                <Box sx={{ mt: 1.5, p: 1.5, borderRadius: 1, bgcolor: 'action.hover' }}>
                  <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 700 }}>DELIVERY UPDATES</Typography>
                  <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))', md: 'repeat(4, minmax(0, 1fr))' }, gap: 2, mt: 1 }}>
                    <Metric value={rowOutcomes.delivered} label="delivery confirmations" singularLabel="delivery confirmation" />
                    <Metric value={rowOutcomes.waiting} label="awaiting a final delivery result" />
                    <Metric value={rowAdverse} label={`${launch.kind === 'reminder' ? 'reminders' : 'invitations'} with delivery problems`} singularLabel={`${launch.kind === 'reminder' ? 'reminder' : 'invitation'} with a delivery problem`} />
                    <Metric value={rowOutcomes.delayed} label="delay reports" singularLabel="delay report" />
                  </Box>
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>One email can have multiple problem or delay reports, and those reports can overlap other delivery update counts.</Typography>
                </Box>
                <PlainLanguageBreakdown counts={rowCounts} outcomes={rowOutcomes} kind={launch.kind} />
              </Paper>
            );
          })}
        </Stack>
      </Box>}
    </Paper>
  );
};

export default SurveyLifecyclePanel;
