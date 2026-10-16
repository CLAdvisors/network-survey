// Dashboard-only visual tokens for the approved "Studio" direction.
// These mirror the frozen approved-design/visual.html palette. They are applied
// through local sx props only and never mutate the shared @network-survey
// theme, so the respondent application presentation is unaffected.
export const STUDIO = {
  brand: '#42b4af',
  teal: '#147d78',
  tealDark: '#105e5b',
  ink: '#233431',
  muted: '#647570',
  line: '#e0e8e5',
  bg: '#f5f8f7',
  soft: '#eaf5f2',
  surface: '#ffffff',
  amber: '#925f13',
  amberBg: '#fff5e2',
  amberBorder: '#ede7da',
  amberInk: '#765f40',
  red: '#a64239',
  redBg: '#fff0ed',
  track: '#e9f0ec',
  // Lifecycle pills (approved list design).
  status: {
    active: { bg: '#e8f5ed', fg: '#28764d', label: 'Launched' },
    draft: { bg: '#fff3dd', fg: '#8a6018', label: 'Draft' },
    closed: { bg: '#edf0ef', fg: '#596962', label: 'Closed' },
  },
};

// Uppercase eyebrow used above several studio sections.
export const eyebrowSx = {
  fontSize: 10,
  letterSpacing: '1px',
  textTransform: 'uppercase',
  color: STUDIO.muted,
  fontWeight: 700,
  m: 0,
};

export const studioPanelSx = {
  bgcolor: STUDIO.surface,
  border: `1px solid ${STUDIO.line}`,
  borderRadius: '12px',
};
