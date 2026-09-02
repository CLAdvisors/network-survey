import React from 'react';
import {
  Alert, Box, Button, Chip, CircularProgress, Paper, Stack, Table, TableBody,
  TableCell, TableContainer, TableHead, TableRow, Typography,
} from '@mui/material';
import RefreshIcon from '@mui/icons-material/Refresh';
import api from '../api/axios';
import { useAuth } from '../context/AuthContext';
import { formatDateTime, surveyId } from './surveyLifecycle';

const PAGE_SIZE = 25;

const typeLabel = (value) => value === 'reminder' ? 'Reminder' : 'Invitation';
const valueOrDash = (value) => value ? formatDateTime(value) : '—';

const Recipient = ({ recipient }) => (
  <Box sx={{ minWidth: 0, overflowWrap: 'anywhere', wordBreak: 'break-word' }}>
    <Typography variant="body2" fontWeight={600}>{recipient?.displayName || 'Name unavailable'}</Typography>
    <Typography variant="body2" color="text.secondary">{recipient?.address || 'Address unavailable'}</Typography>
  </Box>
);

const Outcome = ({ status }) => (
  <Box sx={{ minWidth: 0 }}>
    <Chip size="small" variant="outlined" label={status?.label || 'Status unknown'} />
    <Typography variant="caption" component="p" color="text.secondary" sx={{ mt: 0.75, maxWidth: 360 }}>
      {status?.explanation || 'This historical record does not contain enough information to determine the current outcome.'}
    </Typography>
  </Box>
);

const TimeList = ({ timestamps }) => (
  <Box component="dl" sx={{ display: 'grid', gridTemplateColumns: 'max-content minmax(0, 1fr)', gap: '2px 8px', m: 0, '& dt': { color: 'text.secondary' }, '& dd': { m: 0, overflowWrap: 'anywhere' } }}>
    <Typography component="dt" variant="caption">Queued</Typography><Typography component="dd" variant="caption">{valueOrDash(timestamps?.queuedAt)}</Typography>
    <Typography component="dt" variant="caption">Last attempt</Typography><Typography component="dd" variant="caption">{valueOrDash(timestamps?.lastAttemptedAt)}</Typography>
    <Typography component="dt" variant="caption">Provider accepted</Typography><Typography component="dd" variant="caption">{valueOrDash(timestamps?.providerAcceptedAt)}</Typography>
    <Typography component="dt" variant="caption">Delivered</Typography><Typography component="dd" variant="caption">{valueOrDash(timestamps?.deliveredAt)}</Typography>
    <Typography component="dt" variant="caption">Updated</Typography><Typography component="dd" variant="caption">{valueOrDash(timestamps?.lastUpdatedAt)}</Typography>
  </Box>
);

const DesktopHistory = ({ messages }) => (
  <TableContainer sx={{ display: { xs: 'none', md: 'block' } }} data-testid="email-history-table-view">
    <Table aria-label="Email message history" sx={{ tableLayout: 'fixed' }}>
      <TableHead><TableRow>
        <TableCell sx={{ width: '9%' }}>Type</TableCell>
        <TableCell sx={{ width: '20%' }}>Recipient</TableCell>
        <TableCell sx={{ width: '22%' }}>Status</TableCell>
        <TableCell align="right" sx={{ width: '8%' }}>Attempts</TableCell>
        <TableCell sx={{ width: '41%' }}>Timing</TableCell>
      </TableRow></TableHead>
      <TableBody>{messages.map((message, index) => (
        <TableRow key={`${message.campaign?.launchId || 'legacy'}-${message.recipient?.address || 'unknown'}-${message.timestamps?.queuedAt || 'unknown'}-${index}`}>
          <TableCell>{typeLabel(message.messageType)}</TableCell>
          <TableCell><Recipient recipient={message.recipient} /></TableCell>
          <TableCell><Outcome status={message.status} /></TableCell>
          <TableCell align="right">{Number(message.attempts || 0)}</TableCell>
          <TableCell><TimeList timestamps={message.timestamps} /></TableCell>
        </TableRow>
      ))}</TableBody>
    </Table>
  </TableContainer>
);

const MobileHistory = ({ messages }) => (
  <Stack spacing={1.5} sx={{ display: { xs: 'flex', md: 'none' } }} aria-label="Email message history cards" data-testid="email-history-card-view">
    {messages.map((message, index) => (
      <Paper component="article" variant="outlined" key={`${message.campaign?.launchId || 'legacy'}-${message.recipient?.address || 'unknown'}-${message.timestamps?.queuedAt || 'unknown'}-${index}`} sx={{ p: 1.5, minWidth: 0 }}>
        <Stack direction="row" justifyContent="space-between" alignItems="flex-start" spacing={1}>
          <Typography component="h3" variant="subtitle2">{typeLabel(message.messageType)}</Typography>
          <Typography variant="body2" aria-label={`${Number(message.attempts || 0)} attempt${Number(message.attempts || 0) === 1 ? '' : 's'}`}>{Number(message.attempts || 0)} attempt{Number(message.attempts || 0) === 1 ? '' : 's'}</Typography>
        </Stack>
        <Box sx={{ mt: 1 }}><Recipient recipient={message.recipient} /></Box>
        <Box sx={{ mt: 1.25 }}><Outcome status={message.status} /></Box>
        <Box sx={{ mt: 1.25 }}><TimeList timestamps={message.timestamps} /></Box>
      </Paper>
    ))}
  </Stack>
);

const EmailHistoryView = ({ survey, sessionKey }) => {
  const id = surveyId(survey);
  const [cursorStack, setCursorStack] = React.useState([null]);
  const [pageIndex, setPageIndex] = React.useState(0);
  const [messages, setMessages] = React.useState([]);
  const [pageInfo, setPageInfo] = React.useState({ hasMore: false, nextCursor: null });
  const [loadedKey, setLoadedKey] = React.useState('');
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState('');
  const [refreshToken, setRefreshToken] = React.useState(0);
  const [announcement, setAnnouncement] = React.useState('');
  const generation = React.useRef(0);
  const headingRef = React.useRef(null);
  const focusAfterLoad = React.useRef(false);
  const cursor = cursorStack[pageIndex] || null;
  const requestKey = `${sessionKey}:${id || ''}:${pageIndex}:${cursor || 'first'}`;

  React.useEffect(() => {
    if (!id) return undefined;
    const expectedGeneration = ++generation.current;
    const controller = new AbortController();
    setLoading(true);
    setError('');
    setAnnouncement(pageIndex === 0 ? 'Loading newest email history.' : `Loading email history page ${pageIndex + 1}.`);
    const params = new URLSearchParams({ limit: String(PAGE_SIZE) });
    if (cursor) params.set('cursor', cursor);
    api.get(`/surveys/${id}/email-history?${params.toString()}`, { signal: controller.signal })
      .then((response) => {
        if (controller.signal.aborted || generation.current !== expectedGeneration) return;
        if (String(response.data?.surveyId) !== String(id)) throw new Error('History response did not match the selected survey.');
        setMessages(Array.isArray(response.data?.messages) ? response.data.messages : []);
        setPageInfo(response.data?.pageInfo || { hasMore: false, nextCursor: null });
        setLoadedKey(requestKey);
        setAnnouncement(`Page ${pageIndex + 1} loaded, ${Array.isArray(response.data?.messages) ? response.data.messages.length : 0} email history messages.`);
        if (focusAfterLoad.current) {
          focusAfterLoad.current = false;
          requestAnimationFrame(() => headingRef.current?.focus());
        }
      })
      .catch((requestError) => {
        if (controller.signal.aborted || generation.current !== expectedGeneration) return;
        setMessages([]);
        setPageInfo({ hasMore: false, nextCursor: null });
        setLoadedKey(requestKey);
        setError(requestError.response?.data?.message || requestError.message || 'Unable to load email history.');
        setAnnouncement(`Email history page ${pageIndex + 1} could not be loaded.`);
      })
      .finally(() => {
        if (!controller.signal.aborted && generation.current === expectedGeneration) setLoading(false);
      });
    return () => controller.abort();
  }, [id, sessionKey, pageIndex, cursor, refreshToken, requestKey]);

  if (!survey) return null;
  const visibleMessages = loadedKey === requestKey ? messages : [];
  const nextPage = () => {
    if (loading || !pageInfo?.nextCursor) return;
    setLoading(true);
    focusAfterLoad.current = true;
    setCursorStack((current) => [...current.slice(0, pageIndex + 1), pageInfo.nextCursor]);
    setPageIndex((current) => current + 1);
  };
  const previousPage = () => {
    if (loading || pageIndex === 0) return;
    setLoading(true);
    focusAfterLoad.current = true;
    setPageIndex((current) => current - 1);
  };
  const refresh = () => {
    focusAfterLoad.current = false;
    setAnnouncement('Refreshing newest email history.');
    if (pageIndex !== 0 || cursorStack.length !== 1) {
      setCursorStack([null]);
      setPageIndex(0);
    }
    setRefreshToken((value) => value + 1);
  };

  return (
    <Paper component="section" elevation={2} sx={{ p: { xs: 2, md: 3 }, mb: 3, minWidth: 0 }} aria-labelledby="email-history-heading" aria-busy={loading}>
      <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" alignItems={{ sm: 'flex-start' }} spacing={1.5}>
        <Box>
          <Typography id="email-history-heading" ref={headingRef} tabIndex={-1} component="h2" variant="h6" sx={{ '&:focus-visible': { outline: '3px solid', outlineColor: 'primary.main', outlineOffset: 3 } }}>Email history</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 800 }}>
            Invitations and reminders targeted for this survey. “Provider accepted” means the email service accepted a message; only “Delivered” confirms receipt by the recipient's mail server.
          </Typography>
        </Box>
        <Button onClick={refresh} startIcon={loading ? <CircularProgress size={16} /> : <RefreshIcon />} disabled={loading} aria-label={`Refresh email history for ${survey.name || 'selected survey'}`}>Refresh</Button>
      </Stack>

      {loading && visibleMessages.length === 0 && <Box role="status" sx={{ py: 4, textAlign: 'center' }}><CircularProgress size={28} /><Typography variant="body2" sx={{ mt: 1 }}>Loading email history…</Typography></Box>}
      {error && <Alert severity="error" sx={{ mt: 2 }} action={<Button color="inherit" onClick={refresh} aria-label="Retry loading email history">Retry</Button>}>{error}</Alert>}
      {!loading && !error && visibleMessages.length === 0 && <Typography sx={{ py: 4 }} color="text.secondary">No invitation or reminder messages have been queued for this survey.</Typography>}
      {visibleMessages.length > 0 && <Box sx={{ mt: 2 }}><DesktopHistory messages={visibleMessages} /><MobileHistory messages={visibleMessages} /></Box>}

      {!error && (visibleMessages.length > 0 || pageIndex > 0) && <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mt: 2 }}>
        <Button onClick={previousPage} disabled={loading || pageIndex === 0} aria-label="Previous email history page">Previous</Button>
        <Typography variant="body2" color="text.secondary" aria-live="polite">Page {pageIndex + 1}</Typography>
        <Button onClick={nextPage} disabled={loading || !pageInfo?.hasMore || !pageInfo?.nextCursor} aria-label="Next email history page">Next</Button>
      </Stack>}
      <Box role="status" aria-live="polite" aria-atomic="true" sx={{ position: 'absolute', width: 1, height: 1, p: 0, m: -1, overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap', border: 0 }}>
        {announcement}
      </Box>
    </Paper>
  );
};

const EmailHistory = ({ survey }) => {
  const { user, authSessionRevision } = useAuth() || {};
  const sessionKey = `${authSessionRevision ?? 0}:${user?.id ?? 'anonymous'}`;
  return <EmailHistoryView key={`${sessionKey}:${surveyId(survey) || ''}`} survey={survey} sessionKey={sessionKey} />;
};

export default EmailHistory;
