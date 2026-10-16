import React from 'react';
import { render, screen, within } from '@testing-library/react';
import { createTheme, ThemeProvider } from '@mui/material/styles';
import { expect, test } from 'vitest';
import SurveyOverviewPanel from './SurveyOverviewPanel';

const theme = createTheme();

const activeSurvey = {
  id: 'survey-1',
  name: 'Survey',
  lifecycleStatus: 'active',
  respondents: 10,
  eligibleRespondents: 10,
  completedResponses: 5,
  responseRatePercent: 50,
};

const renderPanel = (campaign, overrides = {}) => render(
  <ThemeProvider theme={theme}>
    <SurveyOverviewPanel
      survey={{ ...activeSurvey, ...(overrides.survey || {}) }}
      campaign={campaign}
      campaignLoaded={overrides.campaignLoaded ?? false}
      campaignLoading={overrides.campaignLoading ?? false}
      campaignError={overrides.campaignError ?? ''}
      onGoToTab={() => {}}
      onViewResults={() => {}}
      onRefresh={() => {}}
      canOpenEmail={overrides.canOpenEmail ?? true}
      canOpenRespondents={overrides.canOpenRespondents ?? true}
    />
  </ThemeProvider>,
);

const fullCounts = {
  target: 10, accepted: 10, pending: 0, leased: 0, retryWait: 0, failed: 0, uncertain: 0, cancelled: 0,
};

test('shows the distinct delivery problem count when the launch provides it', () => {
  renderPanel({
    id: 'l1', kind: 'initial', created_at: '2026-10-12T13:30:00Z',
    counts: fullCounts,
    provider_outcome_counts: { delivered_count: 8, provider_waiting_count: 2, provider_problem_count: 2, bounced_count: 1, complained_count: 1 },
  });
  expect(screen.getByText('emails with delivery problems')).toBeInTheDocument();
  expect(within(screen.getByLabelText('Latest campaign')).getByText('2')).toBeInTheDocument();
  expect(screen.getByTestId('campaign-state')).toHaveTextContent('Complete');
  expect(screen.getByText(/Latest campaign · Initial invitations ·/)).toBeInTheDocument();
});

test('never synthesizes a delivery problem count from overlapping event reports', () => {
  renderPanel({
    id: 'l2', kind: 'initial', created_at: '2026-10-12T13:30:00Z',
    counts: fullCounts,
    // Distinct problem/waiting/delivered fields absent; bounced+complained can overlap.
    provider_outcome_counts: { bounced_count: 2, complained_count: 2 },
  });
  expect(screen.queryByText('emails with delivery problems')).not.toBeInTheDocument();
  expect(within(screen.getByLabelText('Latest campaign')).getByText('Unavailable')).toBeInTheDocument();
});

test('does not render an incomplete campaign as Complete or as zero', () => {
  renderPanel({ id: 'l3', kind: 'initial', status: 'queued' });
  expect(screen.getByTestId('campaign-state')).toHaveTextContent('Unavailable');
  expect(screen.queryByText('Complete')).not.toBeInTheDocument();
  // Missing counts render as unavailable placeholders, not a factual 0 of 0.
  expect(screen.queryByText(/^0 of 0/)).not.toBeInTheDocument();
});

test('renders processing counts and delivery indicators only when provided', () => {
  renderPanel({
    id: 'l4', kind: 'initial', created_at: '2026-10-12T13:30:00Z',
    counts: { target: 13, accepted: 8, pending: 1, leased: 0, retry_wait: 1, failed: 1, uncertain: 1, cancelled: 1 },
    provider_outcome_counts: { delivered_count: 2, provider_waiting_count: 2, provider_problem_count: 3, delayed_count: 1 },
  });
  expect(screen.getByTestId('campaign-state')).toHaveTextContent('Processing');
  expect(screen.getByText('2 processing')).toBeInTheDocument();
  expect(screen.getByText('3 not confirmed sent')).toBeInTheDocument();
  expect(screen.getByText('Delivery confirmations')).toBeInTheDocument();
  expect(screen.getByText('Awaiting final result')).toBeInTheDocument();
});

test('does not present an accepted/unverified subset as awaiting-final-result', () => {
  renderPanel({
    id: 'l6', kind: 'initial', created_at: '2026-10-12T13:30:00Z',
    counts: fullCounts,
    // Distinct waiting count absent; accepted-unverified is a subset, not the total.
    provider_outcome_counts: { sent_count: 10, accepted_unverified_count: 2, provider_problem_count: 0, delivered_count: 10 },
  });
  expect(screen.queryByText('2 awaiting final result')).not.toBeInTheDocument();
  expect(screen.getByText('Awaiting final result unavailable')).toBeInTheDocument();
});

test('does not report processing totals when component counts are incomplete', () => {
  renderPanel({
    id: 'l7', kind: 'initial', created_at: '2026-10-12T13:30:00Z',
    // pending present, but leased/retry-wait missing: the true total is unknown.
    counts: { target: 10, accepted: 10, pending: 1 },
    provider_outcome_counts: { delivered_count: 10, provider_waiting_count: 0, provider_problem_count: 0 },
  });
  expect(screen.queryByText(/processing$/)).not.toBeInTheDocument();
  expect(screen.getByText('processing unavailable')).toBeInTheDocument();
});

test('hides respondent and email destinations the viewer cannot open', () => {
  renderPanel({ id: 'l5', kind: 'initial', counts: fullCounts, provider_outcome_counts: { provider_problem_count: 1, delivered_count: 10, provider_waiting_count: 0 } }, { canOpenEmail: false, canOpenRespondents: false });
  expect(screen.queryByRole('button', { name: 'View respondents' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Email history' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /Review emails/ })).not.toBeInTheDocument();
});

test('an explicit no-campaign does not revive the stale list snapshot', () => {
  renderPanel(null, {
    campaignLoaded: true,
    survey: { latestLaunch: { id: 'stale', kind: 'initial', provider_outcome_counts: { provider_problem_count: 5, delivered_count: 1 } } },
  });
  expect(screen.getByText('No campaign has been sent yet.')).toBeInTheDocument();
  expect(screen.queryByText('Delivery confirmations')).not.toBeInTheDocument();
  expect(screen.queryByText('emails with delivery problems')).not.toBeInTheDocument();
  expect(within(screen.getByLabelText('Latest campaign')).getByText('Unavailable')).toBeInTheDocument();
});

test('distinguishes a loading campaign from a confirmed empty one', () => {
  renderPanel(null, { campaignLoaded: false, campaignLoading: true });
  expect(screen.getByText('Loading campaign data…')).toBeInTheDocument();
  expect(screen.queryByText('No campaign has been sent yet.')).not.toBeInTheDocument();
});
