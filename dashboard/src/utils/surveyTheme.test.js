import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Model } from 'survey-core';
import { DefaultLightPanelless } from 'survey-core/themes';
import {
  applyBrandedPanellessSurveyTheme,
  BRANDED_PANELLESS_SURVEY_THEME,
  BRANDED_SURVEY_WRAPPER_SX
} from '@network-survey/frontend-shared';

describe('shared SurveyJS theme', () => {
  it('extends the supported panelless theme with the exact brand tokens', () => {
    expect(BRANDED_PANELLESS_SURVEY_THEME).toMatchObject({
      themeName: DefaultLightPanelless.themeName,
      colorPalette: DefaultLightPanelless.colorPalette,
      isPanelless: true,
      cssVariables: {
        '--sjs-general-backcolor-dim': 'transparent',
        '--sjs-primary-backcolor': '#42B4AF',
        '--sjs-primary-backcolor-dark': '#3B9F9B',
        '--sjs-primary-backcolor-light': 'rgba(66, 180, 175, 0.1)',
        '--sjs-general-forecolor': '#333',
        '--sjs-border-default': '#e4e9e8',
        '--sjs-question-background': 'transparent',
        '--survey-primary-border': 'rgba(66, 180, 175, 0.4)',
        '--survey-surface': '#ffffff'
      }
    });
    expect(BRANDED_PANELLESS_SURVEY_THEME.cssVariables).toEqual({
      ...DefaultLightPanelless.cssVariables,
      ...BRANDED_PANELLESS_SURVEY_THEME.cssVariables
    });
  });

  it('applies the one exported theme object through the model instance API', () => {
    const survey = { applyTheme: vi.fn() };

    expect(applyBrandedPanellessSurveyTheme(survey)).toBe(survey);
    expect(survey.applyTheme).toHaveBeenCalledOnce();
    expect(survey.applyTheme).toHaveBeenCalledWith(BRANDED_PANELLESS_SURVEY_THEME);
  });

  it('renders questions without the framed-card class that caused the staging regression', () => {
    const survey = new Model({ elements: [{ type: 'text', name: 'question_1' }] });
    applyBrandedPanellessSurveyTheme(survey);

    expect(survey.getQuestionByName('question_1').getRootCss()).not.toContain('sd-element--with-frame');
    expect(survey.cssVariables['--sjs-primary-backcolor']).toBe('#42B4AF');
  });

  it('keeps both runtime entry points wired to the shared instance helper', () => {
    const dashboardPreview = readFileSync(
      resolve(process.cwd(), 'src/components/SurveyEditor.js'),
      'utf8'
    );
    const respondentRuntime = readFileSync(
      resolve(process.cwd(), '../network-survey/src/SurveyComponent.jsx'),
      'utf8'
    );

    for (const source of [dashboardPreview, respondentRuntime]) {
      expect(source).toContain('applyBrandedPanellessSurveyTheme');
      expect(source).not.toMatch(/Model\.cssType|cssType\s*=/);
    }
  });

  it('shares the transparent panelless wrapper bridge', () => {
    expect(BRANDED_SURVEY_WRAPPER_SX).toEqual({
      '--survey-primary': '#42B4AF',
      '--survey-primary-hover': '#3B9F9B',
      '--survey-primary-light': 'rgba(66, 180, 175, 0.1)',
      '--survey-primary-border': 'rgba(66, 180, 175, 0.4)',
      '--survey-surface': '#ffffff',
      '--survey-text': '#333',
      '--survey-muted-text': 'rgba(51, 51, 51, 0.7)',
      '--survey-disabled-text': 'rgba(0, 0, 0, 0.38)',
      '--survey-error': '#d32f2f',
      '--survey-error-surface': 'rgba(211, 47, 47, 0.04)',
      '& .sd-root-modern, & .sd-body, & .sd-container-modern': {
        backgroundColor: 'transparent'
      }
    });
  });
});
