import { DefaultLight } from 'survey-core/themes';
import { BRAND_COLORS } from './constants.js';

// The deployed CRA SurveyJS build bundled and used Open Sans for runtime text.
const APP_FONT_FAMILY = '"Open Sans", "Helvetica Neue", Helvetica, Arial, sans-serif';

/** Opt-in scope shared by the respondent runtime and dashboard Demo Survey. */
export const PRODUCTION_SURVEY_CLASS_NAME = 'cla-survey-runtime';

/**
 * SurveyJS must use its framed model to emit `sd-element--with-frame`.
 * The accompanying scoped stylesheet then ports the production CRA rules onto
 * current SurveyJS class names without affecting Survey Creator's designer.
 */
export const PRODUCTION_SURVEY_THEME = Object.freeze({
  ...DefaultLight,
  cssVariables: Object.freeze({
    ...DefaultLight.cssVariables,
    '--sjs-font-family': APP_FONT_FAMILY,
    '--sjs-general-backcolor': '#ffffff',
    '--sjs-general-backcolor-dim': 'transparent',
    '--sjs-general-backcolor-dim-light': '#ffffff',
    '--sjs-general-forecolor': '#161616',
    '--sjs-general-forecolor-light': '#909090',
    '--sjs-primary-backcolor': BRAND_COLORS.primary,
    '--sjs-primary-backcolor-dark': BRAND_COLORS.primaryHover,
    '--sjs-primary-backcolor-light': 'rgba(66, 180, 175, 0.1)',
    '--sjs-primary-forecolor': '#ffffff',
    '--sjs-primary-forecolor-light': BRAND_COLORS.primary,
    '--sjs-secondary-backcolor': BRAND_COLORS.primary,
    '--sjs-secondary-backcolor-light': 'rgba(66, 180, 175, 0.1)',
    '--sjs-border-default': '#e8e8e8',
    '--sjs-border-light': '#e8e8e8',
    '--sjs-corner-radius': '6px',
    '--sjs-question-background': '#ffffff',
    '--sjs-questionpanel-backcolor': '#ffffff',
    '--sjs-header-backcolor': 'transparent',
    '--sjs-font-questiontitle-color': '#161616',
    '--sjs-font-questiontitle-weight': '600',
    '--sjs-font-questiondescription-color': '#909090',
    '--sjs-special-red': '#ff4d4f',
    '--sjs-special-red-light': 'rgba(255, 77, 79, 0.1)',
    // Tokens consumed by the custom draggable-ranking renderer.
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

/** Apply the production theme through SurveyJS's supported instance API. */
export function applyProductionSurveyTheme(survey) {
  if (!survey || typeof survey.applyTheme !== 'function') {
    throw new TypeError('A SurveyJS model with applyTheme() is required.');
  }
  survey.applyTheme(PRODUCTION_SURVEY_THEME);
  return survey;
}

/** MUI bridge for custom renderer tokens inside either application shell. */
export const PRODUCTION_SURVEY_WRAPPER_SX = Object.freeze({
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
});
