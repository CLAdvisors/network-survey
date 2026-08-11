import React from 'react';
import {
  Alert, Box, Button, Chip, CircularProgress, LinearProgress, Paper, Stack,
  Table, TableBody, TableCell, TableHead, TableRow, Tooltip, Typography,
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
const StatusChip = ({ count, label, title, color = 'default' }) => {
  if (!count) return null;
  const metric = `${count} ${label}`;
  return (
    <Tooltip title={title} arrow describeChild>
      <Box component="span" tabIndex={0} aria-label={`${metric}. ${title}`} sx={{ display: 'inline-flex' }}>
        <Chip size="small" color={color} variant="outlined" label={metric} />
      </Box>
    </Tooltip>
  );
};

const SummaryCard = ({ title, headline, supporting, children, ariaLabel }) => (
  <Paper component="section" aria-label={ariaLabel} variant="outlined" sx={{ p: 2, minWidth: 0 }}>
    <Typography variant="overline" color="text.secondary" sx={{ fontWeight: 700, lineHeight: 1.5 }}>{title}</Typography>
    <Typography variant="h5" sx={{ mt: 0.25, fontWeight: 700 }}>{headline}</Typography>
    <Typography variant="body2" color="text.secondary">{supporting}</Typography>
    {children}
  </Paper>
);

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
  const adverse = outcomes.bounced + outcomes.complained + outcomes.suppressed + outcomes.providerFailed;
  const inProgress = counts.pending + counts.leased + counts.retryWait;
  const manualRefresh = () => setManualRefreshToken((value) => value + 1);

  return (
    <Paper elevation={2} sx={{ p: { xs: 2, md: 3 }, mb: 3 }} aria-label={`Lifecycle for ${survey.name}`}>
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
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'repeat(2, minmax(0, 1fr))' }, gap: 2 }}>
          <SummaryCard
            title="Invitation dispatch"
            headline={`${counts.accepted} of ${counts.target} accepted`}
            supporting={`${terminal} of ${counts.target} processed`}
            ariaLabel="Invitation dispatch summary"
          >
            <LinearProgress variant="determinate" value={progress} sx={{ mt: 1.5, mb: 2, height: 6, borderRadius: 3 }} aria-label="Invitation dispatch progress" />
            {inProgress > 0 && <Box sx={{ mb: 1.5 }}>
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.75, fontWeight: 700 }}>IN PROGRESS</Typography>
              <Stack direction="row" useFlexGap flexWrap="wrap" gap={0.75}>
                <StatusChip count={counts.pending} label="pending" color="info" title="Queued locally; the provider request has not started." />
                <StatusChip count={counts.leased} label="sending" color="info" title="A worker is currently processing the invitation." />
                <StatusChip count={counts.retryWait} label="retrying" color="info" title="A temporary or ambiguous failure occurred and another safe attempt is scheduled." />
              </Stack>
            </Box>}
            {(counts.failed + counts.uncertain + counts.cancelled) > 0 && <Box>
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.75, fontWeight: 700 }}>NOT CONFIRMED ACCEPTED</Typography>
              <Stack direction="row" useFlexGap flexWrap="wrap" gap={0.75}>
                <StatusChip count={counts.failed} label="failed" color="error" title="Sending permanently failed or safe retries were exhausted." />
                <StatusChip count={counts.uncertain} label="uncertain" color="warning" title="The provider may have accepted the request, but the result could not be confirmed safely." />
                <StatusChip count={counts.cancelled} label="cancelled" title="The application intentionally stopped the invitation before completion." />
              </Stack>
            </Box>}
            {inProgress === 0 && counts.failed + counts.uncertain + counts.cancelled === 0 && (
              <Typography variant="body2" color="success.main" sx={{ mt: 2, fontWeight: 600 }}>All invitations were accepted by the provider.</Typography>
            )}
          </SummaryCard>

          <SummaryCard
            title="Provider results"
            headline={`${outcomes.delivered} delivered`}
            supporting="Mailbox and provider signals recorded for these invitations"
            ariaLabel="Provider outcome summary"
          >
            {adverse > 0 && <Box sx={{ mt: 2, mb: 1.5 }}>
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.75, fontWeight: 700 }}>NEEDS ATTENTION</Typography>
              <Stack direction="row" useFlexGap flexWrap="wrap" gap={0.75}>
                <StatusChip count={outcomes.bounced} label="bounced" color="error" title="The recipient's mail server rejected the message." />
                <StatusChip count={outcomes.complained} label="complained" color="error" title="The recipient reported the message as spam." />
                <StatusChip count={outcomes.suppressed} label="suppressed" color="error" title="Sending was blocked for this address by local or provider suppression." />
                <StatusChip count={outcomes.providerFailed} label="provider failed" color="error" title="The provider reported that delivery failed after accepting the request." />
              </Stack>
            </Box>}
            {outcomes.acceptedUnverified > 0 && <Box sx={{ mt: adverse > 0 ? 0 : 2, mb: 1.5 }}>
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.75, fontWeight: 700 }}>AWAITING PROVIDER UPDATE</Typography>
              <Stack direction="row" useFlexGap flexWrap="wrap" gap={0.75}>
                <StatusChip count={outcomes.acceptedUnverified} label="awaiting update" color="warning" title="The request was accepted, but no mailbox or provider signal has been recorded." />
              </Stack>
            </Box>}
            {(outcomes.sent + outcomes.delayed) > 0 && <Box sx={{ mt: adverse + outcomes.acceptedUnverified > 0 ? 0 : 2 }}>
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.75, fontWeight: 700 }}>OTHER RECORDED SIGNALS</Typography>
              <Stack direction="row" useFlexGap flexWrap="wrap" gap={0.75}>
                <StatusChip count={outcomes.sent} label="provider accepted" title="The provider reported accepting the message. This count can overlap with later outcomes." />
                <StatusChip count={outcomes.delayed} label="delayed" color="warning" title="The provider reported a delivery delay. This signal remains recorded if a later result follows." />
              </Stack>
            </Box>}
            {adverse === 0 && outcomes.sent + outcomes.delayed + outcomes.acceptedUnverified === 0 && (
              <Typography variant="body2" color={outcomes.delivered > 0 ? 'success.main' : 'text.secondary'} sx={{ mt: 2, fontWeight: 600 }}>
                {outcomes.delivered > 0 ? 'No delivery problems reported.' : 'No provider signals reported yet.'}
              </Typography>
            )}
          </SummaryCard>
        </Box>
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
          Provider acceptance confirms the request was received; only a delivered event confirms mail-server delivery. Provider signal counts can overlap.
        </Typography>
      </Box>}

      {lifecycleStatus(survey) !== 'draft' && <Box sx={{ mt: 2, p: 1.25, borderRadius: 1, bgcolor: 'action.hover', display: 'flex', alignItems: 'center', gap: 1 }}>
        <LockIcon color="action" fontSize="small" />
        <Typography variant="body2" color="text.secondary">
          Questions, respondents, notification templates, and survey design are read-only while this survey is {lifecycleStatus(survey)}.
        </Typography>
      </Box>}

      {visibleLaunches.length > 0 && <Box sx={{ mt: 3, overflowX: 'auto' }}>
        <Typography variant="subtitle2" sx={{ mb: 1 }}>Launch history</Typography>
        <Table size="small" aria-label="Invitation launch history">
          <TableHead><TableRow>
            <TableCell>Created</TableCell>
            <TableCell>Status</TableCell>
            <TableCell align="right">Accepted</TableCell>
            <TableCell align="right">In progress</TableCell>
            <TableCell>Failed / uncertain</TableCell>
            <TableCell align="right">Cancelled</TableCell>
            <TableCell>Provider results</TableCell>
          </TableRow></TableHead>
          <TableBody>{visibleLaunches.map((launch, index) => {
            const rowCounts = launchCounts(launch);
            const rowOutcomes = providerCounts(launch);
            const rowInProgress = rowCounts.pending + rowCounts.leased + rowCounts.retryWait;
            const rowAdverse = rowOutcomes.bounced + rowOutcomes.complained + rowOutcomes.suppressed + rowOutcomes.providerFailed;
            const dispatchDetails = `${rowCounts.pending} pending, ${rowCounts.leased} sending, ${rowCounts.retryWait} retrying`;
            const providerDetails = `${rowOutcomes.sent} provider accepted, ${rowOutcomes.delivered} delivered, ${rowOutcomes.delayed} delayed, ${rowOutcomes.bounced} bounced, ${rowOutcomes.complained} complained, ${rowOutcomes.suppressed} suppressed, ${rowOutcomes.providerFailed} provider failed, ${rowOutcomes.acceptedUnverified} awaiting update`;
            return (
              <TableRow key={launch.id || launch.launchId || index}>
                <TableCell sx={{ whiteSpace: 'nowrap' }}>{formatDateTime(launch.createdAt || launch.created_at)}</TableCell>
                <TableCell><Chip size="small" variant="outlined" label={statusText(launchStatus(launch))} /></TableCell>
                <TableCell align="right" sx={{ whiteSpace: 'nowrap', fontWeight: 600 }}>{rowCounts.accepted} / {rowCounts.target}</TableCell>
                <TableCell align="right">
                  <Tooltip title={dispatchDetails} arrow><Box component="span" tabIndex={0}>{rowInProgress}</Box></Tooltip>
                </TableCell>
                <TableCell sx={{ whiteSpace: 'nowrap' }}>{rowCounts.failed} failed · {rowCounts.uncertain} uncertain</TableCell>
                <TableCell align="right">{rowCounts.cancelled}</TableCell>
                <TableCell sx={{ minWidth: 180 }}>
                  <Tooltip title={providerDetails} arrow>
                    <Box tabIndex={0}>
                      <Typography variant="body2" fontWeight={600}>{rowOutcomes.delivered} delivered</Typography>
                      <Typography variant="caption" color="text.secondary">
                        {rowAdverse > 0 ? `${rowAdverse} need attention` : 'No problems'}
                        {rowOutcomes.acceptedUnverified > 0 ? ` · ${rowOutcomes.acceptedUnverified} awaiting` : ''}
                        {rowOutcomes.delayed > 0 ? ` · ${rowOutcomes.delayed} delayed` : ''}
                      </Typography>
                    </Box>
                  </Tooltip>
                </TableCell>
              </TableRow>
            );
          })}</TableBody>
        </Table>
      </Box>}
    </Paper>
  );
};

export default SurveyLifecyclePanel;
