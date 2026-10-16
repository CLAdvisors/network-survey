import React from 'react';
import { Box, Button, Stack, Typography } from '@mui/material';
import ArrowForwardIcon from '@mui/icons-material/ArrowForwardIosOutlined';
import RefreshIcon from '@mui/icons-material/RefreshOutlined';
import WarningAmberIcon from '@mui/icons-material/WarningAmberOutlined';
import CheckCircleIcon from '@mui/icons-material/CheckCircleOutlineOutlined';
import ScheduleIcon from '@mui/icons-material/ScheduleOutlined';
import MailIcon from '@mui/icons-material/MailOutlineOutlined';
import EditIcon from '@mui/icons-material/EditOutlined';
import PeopleIcon from '@mui/icons-material/PeopleAltOutlined';
import HubIcon from '@mui/icons-material/Hub';
import LockIcon from '@mui/icons-material/LockOutlined';
import { STUDIO, eyebrowSx, studioPanelSx } from '../theme/studioTokens';
import { launchCounts, providerCounts, formatDateTime, lifecycleStatus } from './surveyLifecycle';
import { responseRateSummary } from './surveyResponseRate';

const Arrow = () => <ArrowForwardIcon sx={{ fontSize: 13 }} />;

const ResponsesVisual = ({ summary }) => {
  const { eligibleCount, completedCount, responseRatePercent } = summary;
  const awaiting = Math.max(eligibleCount - completedCount, 0);
  const rateAvailable = eligibleCount > 0 && responseRatePercent !== null;
  const percent = rateAvailable ? responseRatePercent : 0;
  const graphicLabel = eligibleCount === 0
    ? 'Response rate unavailable: no eligible respondents.'
    : `${completedCount} of ${eligibleCount} eligible respondents responded${rateAvailable ? ` (${responseRatePercent}% response rate)` : ''}.`;

  return (
    <Box sx={{ ...studioPanelSx, bgcolor: '#f0f8f7', border: 0, p: { xs: '21px', md: '24px 28px' }, minWidth: 0 }}>
      <Stack direction="row" alignItems="center" justifyContent="space-between" gap={2}>
        <Typography component="h2" sx={{ fontSize: 15, fontWeight: 600, color: STUDIO.ink }}>Responses</Typography>
        <Button
          size="small"
          aria-label="View respondents"
          onClick={() => summary.onViewRespondents?.()}
          sx={{ minWidth: 27, width: 27, height: 27, p: 0, borderRadius: '50%', border: '1px solid #d3e8e5', color: STUDIO.ink }}
        >
          <Arrow />
        </Button>
      </Stack>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={{ xs: 2, sm: 4 }} alignItems="center" sx={{ pt: 2 }}>
        <Box
          role="img"
          aria-label={graphicLabel}
          sx={{
            position: 'relative', width: 140, height: 140, flexShrink: 0, borderRadius: '50%',
            background: `conic-gradient(${STUDIO.brand} 0 ${percent}%, #dfebea ${percent}% 100%)`,
            display: 'grid', placeItems: 'center', transform: 'rotate(-90deg)',
          }}
        >
          <Box sx={{ position: 'absolute', inset: '11px', borderRadius: '50%', bgcolor: '#f0f8f7' }} />
          <Box sx={{ position: 'relative', transform: 'rotate(90deg)', textAlign: 'center' }}>
            <Typography component="p" sx={{ fontSize: 40, lineHeight: 1.05, fontWeight: 600, letterSpacing: '-2px', color: STUDIO.ink }}>
              {rateAvailable ? responseRatePercent : '—'}<Box component="span" sx={{ fontSize: 20, fontWeight: 500, ml: '1px' }}>{rateAvailable ? '%' : ''}</Box>
            </Typography>
            <Typography sx={{ fontSize: 10, color: STUDIO.muted }}>
              {eligibleCount === 0 ? 'no eligible respondents' : rateAvailable ? 'response rate' : 'rate unavailable'}
            </Typography>
          </Box>
        </Box>
        <Box sx={{ flex: 1, minWidth: 0, maxWidth: 300 }}>
          <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 1.5, gap: 1 }}>
            <Stack direction="row" alignItems="center" spacing={1}>
              <Box sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: STUDIO.brand }} />
              <Typography sx={{ fontSize: 12, color: STUDIO.muted }}>Responded</Typography>
            </Stack>
            <Typography sx={{ fontSize: 20, fontWeight: 600, color: STUDIO.ink }}>{completedCount}</Typography>
          </Stack>
          <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 1.5, gap: 1 }}>
            <Stack direction="row" alignItems="center" spacing={1}>
              <Box sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: '#c2cfcd' }} />
              <Typography sx={{ fontSize: 12, color: STUDIO.muted }}>Awaiting response</Typography>
            </Stack>
            <Typography sx={{ fontSize: 20, fontWeight: 600, color: STUDIO.ink }}>{awaiting}</Typography>
          </Stack>
          <Stack direction="row" alignItems="center" spacing={0.75} sx={{ borderTop: `1px solid #dfeae8`, pt: 1.5 }}>
            <PeopleIcon sx={{ fontSize: 14, color: STUDIO.muted }} />
            <Typography sx={{ fontSize: 11, color: STUDIO.muted }}>{eligibleCount} respondents</Typography>
          </Stack>
        </Box>
      </Stack>
    </Box>
  );
};

const AttentionCard = ({ problems, rawEmails, onReview }) => {
  const hasProblems = problems > 0;
  return (
    <Box
      component="section"
      aria-label="Latest campaign"
      sx={{
        ...studioPanelSx,
        bgcolor: '#fffcf5', borderColor: STUDIO.amberBorder,
        p: { xs: '19px', md: '24px 28px' }, minWidth: 0,
        display: 'grid', gridTemplateColumns: '1fr auto', gridTemplateRows: 'auto 1fr auto', gap: '10px 8px',
      }}
    >
      <Box sx={{ gridColumn: 2, gridRow: '1 / 3', display: 'grid', placeItems: 'center', width: 45, height: 45, borderRadius: '13px', bgcolor: hasProblems ? '#fff0d5' : '#eaf6f3', color: hasProblems ? '#926020' : '#28764d' }}>
        {hasProblems ? <WarningAmberIcon sx={{ fontSize: 24 }} /> : <CheckCircleIcon sx={{ fontSize: 24 }} />}
      </Box>
      <Box sx={{ gridColumn: 1, gridRow: '1 / 3' }}>
        <Typography sx={{ ...eyebrowSx, color: '#8a652d', fontSize: 9 }}>LATEST CAMPAIGN</Typography>
        <Typography component="p" sx={{ fontSize: hasProblems ? 48 : 26, lineHeight: 1.05, fontWeight: 500, letterSpacing: hasProblems ? '-3px' : '-1px', color: STUDIO.ink, my: '6px 0' }}>
          {hasProblems ? problems : 'None'}
        </Typography>
        <Typography sx={{ fontSize: 12, color: STUDIO.amberInk, maxWidth: 200, lineHeight: 1.6 }}>
          {hasProblems ? `${rawEmails} with delivery problems` : 'No delivery problems reported'}
        </Typography>
      </Box>
      <Box
        component="button"
        type="button"
        onClick={onReview}
        sx={{
          gridRow: 3, gridColumn: '1 / -1', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          border: 0, borderTop: `1px solid ${STUDIO.amberBorder}`, pt: '13px', bgcolor: 'transparent', cursor: 'pointer',
          fontSize: 12, fontWeight: 600, color: '#654d27', font: 'inherit',
        }}
      >
        Review emails <Arrow />
      </Box>
    </Box>
  );
};

const NextStepCard = ({ closed, onViewResults, onReviewEmails }) => (
  <Box component="section" aria-label={closed ? 'Survey complete' : 'Keep things moving'} sx={{ ...studioPanelSx, bgcolor: '#fbfdfc', p: { xs: '20px', md: '24px 28px' }, display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'flex-start' }}>
    <Typography sx={{ ...eyebrowSx }}>{closed ? 'SURVEY COMPLETE' : 'KEEP THINGS MOVING'}</Typography>
    <Typography component="h2" sx={{ fontSize: 16, fontWeight: 700, color: STUDIO.ink, mt: '6px' }}>
      {closed ? 'Review what you learned' : 'Follow up with your respondents'}
    </Typography>
    <Typography sx={{ fontSize: 12, color: STUDIO.muted, lineHeight: 1.7, my: '9px 12px' }}>
      {closed
        ? 'Explore the network and responses collected during this survey.'
        : 'Check delivery outcomes before preparing a reminder for eligible respondents.'}
    </Typography>
    <Button
      variant="text"
      onClick={closed ? onViewResults : onReviewEmails}
      endIcon={<Arrow />}
      sx={{ color: STUDIO.teal, fontWeight: 600, px: 0, textTransform: 'none' }}
    >
      {closed ? 'View results' : 'Review email activity'}
    </Button>
  </Box>
);

const Metric = ({ label, value, icon }) => (
  <Box sx={{ minWidth: 0 }}>
    {icon && <Box sx={{ width: 34, height: 34, borderRadius: '50%', display: 'grid', placeItems: 'center', bgcolor: '#f2f2f2', color: '#666', mb: 1.5 }}>{icon}</Box>}
    <Typography component="p" sx={{ fontSize: 34, lineHeight: 1.1, letterSpacing: '-1.6px', fontWeight: 600, color: STUDIO.ink }}>{value}</Typography>
    <Typography sx={{ fontSize: 11, color: STUDIO.muted, lineHeight: 1.6, maxWidth: 150, mt: 0.75 }}>{label}</Typography>
  </Box>
);

const EmailActivity = ({ survey, onRefresh, onViewEmailHistory, onReviewEmails, refreshToken = 0 }) => {
  const latest = survey.latestLaunch || survey.latest_launch;
  const counts = launchCounts(latest);
  const outcomes = providerCounts(latest);
  const processing = counts.pending + counts.leased + counts.retryWait;
  const notConfirmed = counts.failed + counts.uncertain + counts.cancelled;
  const isReminder = latest?.kind === 'reminder';
  const kindLabel = isReminder ? 'Reminder' : 'Initial invitations';
  const created = latest ? formatDateTime(latest.createdAt || latest.created_at) : '';
  const state = !latest ? 'No campaign' : processing > 0 ? 'Processing' : notConfirmed > 0 ? 'Not confirmed' : 'Complete';
  const submittedPercent = counts.target > 0 ? Math.min(100, Math.round((counts.accepted / counts.target) * 100)) : 0;

  return (
    <Box component="section" aria-label="Email activity" sx={{ mt: { xs: 2.5, md: 3 } }}>
      <Stack direction="row" alignItems="flex-start" justifyContent="space-between" gap={2} sx={{ mb: 2 }}>
        <Box>
          <Typography component="h2" sx={{ fontSize: 17, fontWeight: 600, color: STUDIO.ink }}>Email activity</Typography>
          <Typography sx={{ fontSize: 11, color: STUDIO.muted, mt: 0.5 }}>
            {latest ? `Latest campaign · ${kindLabel} · ${created}` : 'No campaign has been sent yet.'}
          </Typography>
        </Box>
        <Button size="small" onClick={onRefresh} startIcon={<RefreshIcon sx={{ fontSize: 16 }} />} sx={{ color: STUDIO.ink, textTransform: 'none', fontSize: 11 }}>
          Refresh
        </Button>
      </Stack>

      {!latest && (
        <Box sx={{ ...studioPanelSx, p: 3, color: STUDIO.muted, fontSize: 13 }}>
          Sending and delivery indicators appear here after an invitation campaign starts.
        </Box>
      )}

      {latest && (
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: { xs: 3, md: 4 } }}>
          <Box sx={{ minWidth: 0 }}>
            <Stack direction="row" alignItems="center" spacing={1}>
              <Box sx={{ width: 29, height: 29, borderRadius: '8px', bgcolor: '#f3f3f3', color: '#555', display: 'grid', placeItems: 'center' }}><MailIcon sx={{ fontSize: 16 }} /></Box>
              <Typography component="h3" sx={{ fontSize: 12, fontWeight: 600, color: '#555' }}>Submitted for sending</Typography>
            </Stack>
            <Stack direction="row" alignItems="baseline" spacing={0.75} sx={{ my: '13px 14px' }}>
              <Typography sx={{ fontSize: 36, lineHeight: 1.1, letterSpacing: '-1.8px', fontWeight: 600, color: STUDIO.ink }}>{counts.accepted}</Typography>
              <Typography sx={{ fontSize: 15, color: '#999' }}>/ {counts.target}</Typography>
              <Box component="span" sx={{ ml: 'auto', fontSize: 10, color: '#555', bgcolor: '#f0f7f5', px: 0.75, py: 0.5, borderRadius: '4px' }}>{state}</Box>
            </Stack>
            <Box role="img" aria-label={`${counts.accepted} of ${counts.target} ${isReminder ? 'reminders' : 'invitations'} submitted for sending`} sx={{ height: 7, bgcolor: '#eceeee', borderRadius: 8, overflow: 'hidden' }}>
              <Box sx={{ width: `${submittedPercent}%`, height: '100%', bgcolor: STUDIO.brand, borderRadius: 8 }} />
            </Box>
            <Stack direction="row" flexWrap="wrap" gap={2} sx={{ mt: 1.5, fontSize: 11, color: STUDIO.muted }}>
              <Stack direction="row" alignItems="center" spacing={0.75}><ScheduleIcon sx={{ fontSize: 12 }} />{processing} processing</Stack>
              <Stack direction="row" alignItems="center" spacing={0.75}><CheckCircleIcon sx={{ fontSize: 12 }} />{notConfirmed} not confirmed sent</Stack>
            </Stack>
            <Typography sx={{ fontSize: 10, color: STUDIO.muted, mt: 1.5 }}>Provider accepted ≠ delivery confirmed</Typography>
          </Box>

          <Box
            aria-label="Independent delivery indicators"
            sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2.5, borderLeft: { md: `1px solid #e7e7e7` }, pl: { md: '34px' } }}
          >
            <Metric icon={<CheckCircleIcon sx={{ fontSize: 18 }} />} value={outcomes.delivered} label="Delivery confirmations" />
            <Metric icon={<ScheduleIcon sx={{ fontSize: 18 }} />} value={outcomes.waiting} label="Awaiting final result" />
          </Box>
        </Box>
      )}

      <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 2, borderTop: `1px solid #ededed`, mt: 3, pt: 2 }}>
        <Typography sx={{ fontSize: 11, color: STUDIO.muted, maxWidth: 620, lineHeight: 1.7 }}>
          Submitted for sending means the email provider accepted the request; it is not a delivery confirmation. Delivery
          problem and delay reports can overlap other outcomes.
        </Typography>
        <Button variant="text" size="small" onClick={onViewEmailHistory || onReviewEmails} endIcon={<Arrow />} sx={{ color: STUDIO.teal, fontWeight: 600, textTransform: 'none', whiteSpace: 'nowrap', fontSize: 11 }}>
          Email history
        </Button>
      </Box>
    </Box>
  );
};

const DraftOverview = ({ survey, onGoToTab, onReviewLaunch, canLaunch = false }) => {
  const questionCount = survey.questions === 'null' || survey.questions == null ? 0 : survey.questions;
  const peopleCount = survey.respondents == null ? 0 : survey.respondents;
  const tiles = [
    { key: 'questions', icon: <EditIcon sx={{ fontSize: 17 }} />, value: questionCount, unit: 'questions', label: 'Questions & design', tab: 'content', numeric: true },
    { key: 'respondents', icon: <PeopleIcon sx={{ fontSize: 17 }} />, value: peopleCount, unit: 'people', label: 'Respondents', tab: 'respondents', numeric: true, tinted: true },
    { key: 'instructions', icon: <EditIcon sx={{ fontSize: 17 }} />, value: 'Introduction', unit: 'Survey guidance', label: 'Instructions', tab: 'content', numeric: false },
    { key: 'invitation', icon: <MailIcon sx={{ fontSize: 17 }} />, value: 'Your invitation', unit: 'Subject and message', label: 'Invitation email', tab: 'email', numeric: false },
  ];

  return (
    <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'minmax(0,1.8fr) minmax(260px,1fr)' }, gap: { xs: 3, md: '30px' } }}>
      <Box component="section" aria-label="Prepare your survey">
        <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 2.25 }}>
          <Typography component="h2" sx={{ fontSize: 17, fontWeight: 600, color: STUDIO.ink }}>Prepare your survey</Typography>
          <Typography sx={{ fontSize: 11, color: STUDIO.muted }}>Review each area</Typography>
        </Stack>
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 2 }}>
          {tiles.map((tile) => (
            <Box
              key={tile.key}
              component="button"
              type="button"
              onClick={() => onGoToTab(tile.tab)}
              sx={{
                textAlign: 'left', font: 'inherit', cursor: 'pointer', display: 'flex', flexDirection: 'column',
                minWidth: 0, p: '23px', minHeight: 183, borderRadius: '13px',
                bgcolor: tile.tinted ? '#f0f8f7' : '#f7f7f7', border: '1px solid transparent', color: STUDIO.ink,
                '&:hover': { borderColor: STUDIO.brand, bgcolor: '#f1f8f7' },
              }}
            >
              <Stack direction="row" alignItems="center" justifyContent="space-between">
                <Box sx={{ display: 'grid', placeItems: 'center', width: 31, height: 31, borderRadius: '7px', bgcolor: '#fff', color: '#555' }}>{tile.icon}</Box>
                <Arrow />
              </Stack>
              <Box sx={{ display: 'flex', alignItems: tile.numeric ? 'baseline' : 'flex-start', flexDirection: tile.numeric ? 'row' : 'column', gap: 0.75, mt: '17px', minWidth: 0 }}>
                <Typography component="strong" sx={{ fontSize: tile.numeric ? 32 : 16, fontWeight: 600, letterSpacing: tile.numeric ? '-1.5px' : '-0.4px', lineHeight: tile.numeric ? 1.1 : 1.4, color: STUDIO.ink }}>{tile.value}</Typography>
                <Typography sx={{ fontSize: 11, color: STUDIO.muted }}>{tile.unit}</Typography>
              </Box>
              <Typography component="span" sx={{ fontSize: 11, color: STUDIO.muted, mt: '12px' }}>{tile.label}</Typography>
            </Box>
          ))}
        </Box>
      </Box>

      <Box component="aside" sx={{ ...studioPanelSx, bgcolor: '#fbfbfb', borderColor: '#ededed', p: 3, display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', height: 'fit-content' }}>
        <Box aria-hidden="true" sx={{ width: 85, height: 85, bgcolor: '#edf8f7', display: 'grid', placeItems: 'center', borderRadius: '24px', color: STUDIO.ink, my: '5px 24px' }}>
          <HubIcon sx={{ fontSize: 45 }} />
        </Box>
        <Typography component="h2" sx={{ fontSize: 20, fontWeight: 700, letterSpacing: '-0.6px', color: STUDIO.ink }}>Review &amp; launch</Typography>
        <Typography sx={{ fontSize: 12, lineHeight: 1.9, color: STUDIO.muted, my: '11px 22px' }}>Run the checks.<br />Confirm before invitations send.</Typography>
        {canLaunch ? (
          <Button variant="contained" onClick={onReviewLaunch} endIcon={<Arrow />} sx={{ width: '100%', bgcolor: STUDIO.teal, '&:hover': { bgcolor: STUDIO.tealDark }, textTransform: 'none', fontWeight: 600, justifyContent: 'space-between' }}>
            Run launch checks
          </Button>
        ) : (
          <Typography sx={{ fontSize: 11, color: STUDIO.muted }}>You do not have permission to launch this survey.</Typography>
        )}
        <Stack direction="row" alignItems="center" spacing={0.75} sx={{ mt: 2.25, color: STUDIO.muted }}>
          <LockIcon sx={{ fontSize: 12 }} />
          <Typography sx={{ fontSize: 10 }}>Content locks after launch</Typography>
        </Stack>
      </Box>
    </Box>
  );
};

const SurveyOverviewPanel = ({ survey, onGoToTab, onViewResults, onRefresh, onReviewLaunch, canLaunch, lifecycleDetails, refreshToken = 0 }) => {
  if (!survey) return null;
  const status = lifecycleStatus(survey);

  if (status === 'draft') {
    return <DraftOverview survey={survey} onGoToTab={onGoToTab} onReviewLaunch={onReviewLaunch} canLaunch={canLaunch} />;
  }

  const summary = responseRateSummary(survey);
  const latest = survey.latestLaunch || survey.latest_launch;
  const outcomes = providerCounts(latest);
  const isReminder = latest?.kind === 'reminder';
  const rawEmails = isReminder ? 'reminders' : 'emails';
  const closed = status === 'closed';

  return (
    <Box>
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'minmax(0,1.75fr) minmax(260px,1fr)' }, gap: { xs: 2, md: '22px' }, mb: { xs: 3, md: '29px' } }}>
        <ResponsesVisual summary={{ ...summary, onViewRespondents: () => onGoToTab('respondents') }} />
        {closed
          ? <NextStepCard closed onViewResults={onViewResults} onReviewEmails={() => onGoToTab('email')} />
          : <AttentionCard problems={outcomes.problems} rawEmails={rawEmails} onReview={() => onGoToTab('email')} />}
      </Box>

      <EmailActivity
        survey={survey}
        refreshToken={refreshToken}
        onRefresh={onRefresh}
        onViewEmailHistory={() => onGoToTab('email')}
      />

      {!closed && (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, borderTop: `1px solid #ededed`, mt: 3, pt: 2, color: STUDIO.muted }}>
          <LockIcon sx={{ fontSize: 13 }} />
          <Typography sx={{ fontSize: 11 }}>
            Survey content and respondent identities are read-only while this survey is launched. Administrators can still edit reminder templates.
          </Typography>
        </Box>
      )}
      {closed && (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, borderTop: `1px solid #ededed`, mt: 3, pt: 2, color: STUDIO.muted }}>
          <LockIcon sx={{ fontSize: 13 }} />
          <Typography sx={{ fontSize: 11 }}>Survey content and respondent identities are read-only while this survey is closed.</Typography>
        </Box>
      )}

      {lifecycleDetails && (
        <Box sx={{ mt: 2.5 }}>
          <Box component="details" sx={{ '& summary': { cursor: 'pointer', fontSize: 11, color: STUDIO.teal, fontWeight: 600, width: 'fit-content' } }}>
            <Typography component="summary">Details &amp; definitions</Typography>
            <Box sx={{ pt: 2 }}>{lifecycleDetails}</Box>
          </Box>
        </Box>
      )}
    </Box>
  );
};

export default SurveyOverviewPanel;
