import React from 'react';
import { Box, Button, Stack, Typography } from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBackIosNewOutlined';
import { STUDIO } from '../theme/studioTokens';
import { lifecycleLabel, lifecycleStatus } from './surveyLifecycle';

const TAB_LABELS = { overview: 'Overview', content: 'Content', respondents: 'Respondents', email: 'Email' };

export const StudioStatusPill = ({ status, label }) => {
  const normalized = String(status || 'draft').toLowerCase();
  const palette = STUDIO.status[normalized] || STUDIO.status.draft;
  return (
    <Box
      component="span"
      sx={{
        display: 'inline-flex', alignItems: 'center', gap: '6px', px: '8px', py: '5px', borderRadius: '6px',
        bgcolor: palette.bg, color: palette.fg, fontSize: 11, fontWeight: 700, whiteSpace: 'nowrap', lineHeight: 1.2,
      }}
    >
      <Box component="span" aria-hidden="true" sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: 'currentColor' }} />
      {label || lifecycleLabel(normalized)}
    </Box>
  );
};

const SurveyWorkspace = ({ survey, tab, onTabChange, onBack, subtitle, primaryAction, menu, panels = [] }) => {
  const status = lifecycleStatus(survey);
  const activeTab = panels.some((panel) => panel.key === tab) ? tab : 'overview';

  return (
    <Box data-testid="survey-workspace" aria-label={`${survey.name} workspace`}>
      <Button
        onClick={onBack}
        startIcon={<ArrowBackIcon sx={{ fontSize: 12 }} />}
        sx={{ color: STUDIO.muted, fontSize: 11, textTransform: 'none', px: 0, mb: 2.5, minWidth: 0 }}
      >
        All surveys
      </Button>

      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        alignItems={{ xs: 'flex-start', sm: 'center' }}
        justifyContent="space-between"
        gap={2}
        sx={{ mb: 3 }}
      >
        <Box sx={{ minWidth: 0 }}>
          <Stack direction="row" alignItems="center" spacing={1.5} flexWrap="wrap">
            <Typography component="h1" tabIndex={-1} sx={{ fontSize: { xs: 24, md: 30 }, fontWeight: 700, letterSpacing: '-1px', color: STUDIO.ink }}>
              {survey.name}
            </Typography>
            <StudioStatusPill status={status} />
          </Stack>
          {subtitle && <Typography sx={{ fontSize: 12, color: STUDIO.muted, mt: 1 }}>{subtitle}</Typography>}
        </Box>
        <Stack direction="row" alignItems="center" spacing={1}>
          {primaryAction}
          {menu}
        </Stack>
      </Stack>

      <Box component="nav" aria-label="Survey sections" sx={{ display: 'flex', gap: { xs: '22px', md: '28px' }, borderBottom: `1px solid #dce5df`, mb: 3, overflowX: 'auto' }}>
        {panels.map((panel) => {
          const selected = panel.key === activeTab;
          return (
            <Box
              key={panel.key}
              component="button"
              type="button"
              onClick={() => onTabChange(panel.key)}
              aria-current={selected ? 'page' : undefined}
              sx={{
                font: 'inherit', cursor: 'pointer', background: 'none', border: 0, borderBottom: '2px solid transparent',
                padding: '0 0 14px', fontSize: 13, whiteSpace: 'nowrap',
                color: selected ? STUDIO.teal : STUDIO.muted,
                borderBottomColor: selected ? STUDIO.teal : 'transparent',
                fontWeight: selected ? 700 : 500,
              }}
            >
              {TAB_LABELS[panel.key] || panel.key}
            </Box>
          );
        })}
      </Box>

      {panels.map((panel) => (
        <Box key={panel.key} sx={{ display: panel.key === activeTab ? 'block' : 'none' }}>
          {panel.node}
        </Box>
      ))}
    </Box>
  );
};

export default SurveyWorkspace;
