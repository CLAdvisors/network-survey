import { DefaultLightPanelless } from 'survey-core/themes';
import { BRAND_COLORS } from './constants.js';

const APP_FONT_FAMILY = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';

/**
 * The single SurveyJS runtime theme used by both respondent and dashboard previews.
 * Start with a supported built-in theme so new SurveyJS variables retain defaults,
 * then apply the application's brand and surface tokens.
 */
export const BRANDED_PANELLESS_SURVEY_THEME = Object.freeze({
  ...DefaultLightPanelless,
  cssVariables: Object.freeze({
    ...DefaultLightPanelless.cssVariables,
    '--sjs-font-family': APP_FONT_FAMILY,
    '--sjs-general-backcolor': '#ffffff',
    '--sjs-general-backcolor-dim': 'transparent',
    '--sjs-general-backcolor-dim-light': '#ffffff',
    '--sjs-general-forecolor': BRAND_COLORS.textPrimary,
    '--sjs-general-forecolor-light': 'rgba(51, 51, 51, 0.7)',
    '--sjs-primary-backcolor': BRAND_COLORS.primary,
    '--sjs-primary-backcolor-dark': BRAND_COLORS.primaryHover,
    '--sjs-primary-backcolor-light': 'rgba(66, 180, 175, 0.1)',
    '--sjs-primary-forecolor': '#ffffff',
    '--sjs-primary-forecolor-light': BRAND_COLORS.primary,
    '--sjs-secondary-backcolor': BRAND_COLORS.primary,
    '--sjs-secondary-backcolor-light': 'rgba(66, 180, 175, 0.1)',
    '--sjs-border-default': '#e4e9e8',
    '--sjs-border-light': '#e4e9e8',
    '--sjs-corner-radius': '6px',
    '--sjs-question-background': 'transparent',
    '--sjs-questionpanel-backcolor': 'transparent',
    '--sjs-header-backcolor': 'transparent',
    '--sjs-font-questiontitle-color': BRAND_COLORS.textPrimary,
    '--sjs-font-questiontitle-weight': '500',
    '--sjs-font-questiondescription-color': 'rgba(51, 51, 51, 0.7)',
    '--sjs-special-red': '#d32f2f',
    '--sjs-special-red-light': 'rgba(211, 47, 47, 0.1)',
    // Custom draggable-ranking renderer tokens. Including these in the theme
    // keeps Survey Creator's built-in preview aligned even without our MUI wrapper.
    '--survey-primary': BRAND_COLORS.primary,
    '--survey-primary-hover': BRAND_COLORS.primaryHover,
    '--survey-primary-light': 'rgba(66, 180, 175, 0.1)',
    '--survey-primary-border': 'rgba(66, 180, 175, 0.4)',
    '--survey-surface': '#ffffff',
    '--survey-text': BRAND_COLORS.textPrimary,
    '--survey-muted-text': 'rgba(51, 51, 51, 0.7)',
    '--survey-disabled-text': 'rgba(0, 0, 0, 0.38)',
    '--survey-error': '#d32f2f',
    '--survey-error-surface': 'rgba(211, 47, 47, 0.04)'
  })
});

/** Apply the shared theme through SurveyJS's supported instance API. */
export function applyBrandedPanellessSurveyTheme(survey) {
  if (!survey || typeof survey.applyTheme !== 'function') {
    throw new TypeError('A SurveyJS model with applyTheme() is required.');
  }
  survey.applyTheme(BRANDED_PANELLESS_SURVEY_THEME);
  return survey;
}

/**
 * MUI `sx` bridge for embedding SurveyJS in either application shell. SurveyJS
 * owns its component tokens; the wrapper only removes its outer page surfaces.
 */
export const BRANDED_SURVEY_WRAPPER_SX = Object.freeze({
  '--survey-primary': BRAND_COLORS.primary,
  '--survey-primary-hover': BRAND_COLORS.primaryHover,
  '--survey-primary-light': 'rgba(66, 180, 175, 0.1)',
  '--survey-primary-border': 'rgba(66, 180, 175, 0.4)',
  '--survey-surface': '#ffffff',
  '--survey-text': BRAND_COLORS.textPrimary,
  '--survey-muted-text': 'rgba(51, 51, 51, 0.7)',
  '--survey-disabled-text': 'rgba(0, 0, 0, 0.38)',
  '--survey-error': '#d32f2f',
  '--survey-error-surface': 'rgba(211, 47, 47, 0.04)',
  '& .sd-root-modern, & .sd-body, & .sd-container-modern': {
    backgroundColor: 'transparent'
  },
  '& .sd-body__page': {
    paddingTop: '10px'
  }
});
