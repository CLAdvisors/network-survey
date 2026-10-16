import React, { useMemo, useState } from 'react';
import { Alert, Box, Button, CircularProgress, InputBase, Stack, Typography } from '@mui/material';
import SearchIcon from '@mui/icons-material/SearchOutlined';
import AddIcon from '@mui/icons-material/AddOutlined';
import { STUDIO } from '../theme/studioTokens';
import { lifecycleLabel, lifecycleStatus } from './surveyLifecycle';
import SurveyTable from './SurveyTable';

const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'draft', label: 'Draft' },
  { key: 'active', label: 'Launched' },
  { key: 'closed', label: 'Closed' },
];

const SurveysList = ({
  rows,
  selectRow,
  onSurveyDeleted,
  onSurveyCopied,
  onLifecycleChange,
  dirtyBySurvey = {},
  operationsBySurvey = {},
  canCreate = false,
  onCreate,
  loading = false,
  error = '',
  onRetry,
}) => {
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');

  const allRows = rows || [];
  const visibleRows = useMemo(() => allRows.filter((survey) => {
    const matchesFilter = filter === 'all' || lifecycleStatus(survey) === filter;
    const matchesSearch = String(survey?.name || '').toLowerCase().includes(search.trim().toLowerCase());
    return matchesFilter && matchesSearch;
  }), [allRows, filter, search]);

  return (
    <Box data-testid="surveys-list">
      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        alignItems={{ xs: 'flex-start', sm: 'center' }}
        justifyContent="space-between"
        gap={2}
        sx={{ mb: 3.5 }}
      >
        <Box>
          <Typography component="h1" tabIndex={-1} sx={{ fontSize: { xs: 28, md: 34 }, fontWeight: 700, letterSpacing: '-1.2px', color: STUDIO.ink }}>
            Surveys
          </Typography>
          <Typography sx={{ fontSize: 12, color: STUDIO.muted, mt: 1 }}>Your survey workspace</Typography>
        </Box>
        {canCreate && (
          <Button
            variant="contained"
            startIcon={<AddIcon sx={{ fontSize: 17 }} />}
            onClick={onCreate}
            sx={{ bgcolor: STUDIO.teal, '&:hover': { bgcolor: STUDIO.tealDark }, textTransform: 'none', fontWeight: 600, fontSize: 12, px: 2, py: 1 }}
          >
            Create survey
          </Button>
        )}
      </Stack>

      <Box sx={{ bgcolor: STUDIO.surface, border: `1px solid ${STUDIO.line}`, borderRadius: '12px', overflow: 'hidden' }}>
        <Stack
          direction={{ xs: 'column', md: 'row' }}
          gap={{ xs: 1.5, md: 2 }}
          alignItems={{ xs: 'stretch', md: 'center' }}
          justifyContent="space-between"
          sx={{ p: 2, borderBottom: `1px solid ${STUDIO.line}` }}
        >
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, border: '1px solid #dbe4df', borderRadius: '7px', px: 1.25, py: 0.75, minWidth: { md: 240 }, bgcolor: '#fff' }}>
            <SearchIcon sx={{ fontSize: 17, color: STUDIO.muted }} />
            <InputBase
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search surveys…"
              inputProps={{ 'aria-label': 'Search surveys' }}
              sx={{ fontSize: 12, width: '100%' }}
            />
          </Box>
          <Stack direction="row" role="group" aria-label="Filter surveys by lifecycle" sx={{ bgcolor: '#f1f5f3', p: 0.5, borderRadius: '7px', gap: '3px' }}>
            {FILTERS.map((item) => {
              const selected = filter === item.key;
              return (
                <Box
                  key={item.key}
                  component="button"
                  type="button"
                  aria-pressed={selected}
                  onClick={() => setFilter(item.key)}
                  sx={{
                    font: 'inherit', cursor: 'pointer', border: 0, borderRadius: '5px', px: 1.5, py: 0.75, fontSize: 11,
                    fontWeight: 600, color: selected ? STUDIO.ink : '#63716b', bgcolor: selected ? '#fff' : 'transparent',
                    boxShadow: selected ? '0 1px 3px #123c3014' : 'none', flex: { xs: 1, md: 'initial' },
                  }}
                >
                  {item.label}
                </Box>
              );
            })}
          </Stack>
        </Stack>

        {error && rows?.length > 0 && (
          <Alert severity="warning" sx={{ borderRadius: 0, fontSize: 12 }} action={<Button size="small" onClick={onRetry}>Retry</Button>}>
            Couldn’t refresh surveys. Showing the last loaded list.
          </Alert>
        )}

        {loading ? (
          <Box data-testid="survey-list-loading" sx={{ height: 320, display: 'grid', placeItems: 'center' }}>
            <CircularProgress size={28} aria-label="Loading surveys" />
          </Box>
        ) : error && !(rows?.length > 0) ? (
          <Box data-testid="survey-list-error" sx={{ p: 4, textAlign: 'center' }}>
            <Typography sx={{ fontSize: 13, color: STUDIO.muted, mb: 1.5 }}>{error}</Typography>
            <Button variant="contained" onClick={onRetry} sx={{ bgcolor: STUDIO.teal, '&:hover': { bgcolor: STUDIO.tealDark }, textTransform: 'none' }}>Retry</Button>
          </Box>
        ) : !(rows?.length > 0) ? (
          <Box data-testid="survey-list-empty" sx={{ p: 5, textAlign: 'center', color: STUDIO.muted, fontSize: 13 }}>
            No surveys yet. Create one to get started.
          </Box>
        ) : (
          <Box data-testid="survey-table-region" sx={{ p: 0, height: { xs: 460, md: 560 } }}>
            <SurveyTable
              rows={visibleRows}
              selectRow={selectRow}
              onSurveyDeleted={onSurveyDeleted}
              onSurveyCopied={onSurveyCopied}
              onLifecycleChange={onLifecycleChange}
              dirtyBySurvey={dirtyBySurvey}
              operationsBySurvey={operationsBySurvey}
            />
          </Box>
        )}

        <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ borderTop: `1px solid ${STUDIO.line}`, px: 2, py: 1.5, color: STUDIO.muted, fontSize: 11 }}>
          <Box component="span" aria-live="polite">
            {loading || (error && !(rows?.length > 0)) ? 'Surveys unavailable' : `${visibleRows.length} of ${allRows.length} surveys`}
          </Box>
          <Box component="span">Sort, column controls and export are available in the table toolbar.</Box>
        </Stack>
      </Box>
    </Box>
  );
};

export default SurveysList;
