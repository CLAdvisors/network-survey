import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Model } from 'survey-core';
import { DefaultLight } from 'survey-core/themes';
import {
  applyProductionSurveyTheme,
  PRODUCTION_SURVEY_CLASS_NAME,
  PRODUCTION_SURVEY_THEME,
  PRODUCTION_SURVEY_WRAPPER_SX
} from '@network-survey/frontend-shared';

const runtimeCss = readFileSync(
  resolve(process.cwd(), '../frontend-shared/src/surveyRuntime.css'),
  'utf8'
);

describe('production SurveyJS styling', () => {
  it('uses SurveyJS framed questions and the historical brand tokens', () => {
    expect(PRODUCTION_SURVEY_THEME).toMatchObject({
      themeName: DefaultLight.themeName,
      colorPalette: DefaultLight.colorPalette,
      isPanelless: false,
      cssVariables: {
        '--sjs-general-backcolor-dim': 'transparent',
        '--sjs-font-family': '"Open Sans", "Helvetica Neue", Helvetica, Arial, sans-serif',
        '--sjs-general-forecolor': '#161616',
        '--sjs-general-forecolor-light': '#909090',
        '--sjs-font-questiontitle-color': '#161616',
        '--sjs-font-questiontitle-weight': '600',
        '--sjs-font-questiondescription-color': '#909090',
        '--sjs-primary-backcolor': '#42B4AF',
        '--sjs-primary-backcolor-dark': '#3B9F9B',
        '--sjs-border-default': '#e8e8e8',
        '--sjs-question-background': '#ffffff',
        '--sjs-questionpanel-backcolor': '#ffffff'
      }
    });

    const survey = new Model({ elements: [{ type: 'text', name: 'question_1' }] });
    applyProductionSurveyTheme(survey);

    expect(survey.getQuestionByName('question_1').getRootCss()).toContain('sd-element--with-frame');
    expect(survey.cssVariables['--sjs-primary-backcolor']).toBe('#42B4AF');
  });

  it('ports the historical 1000px layout and teal question-frame rule', () => {
    expect(runtimeCss).toMatch(/\.cla-survey-runtime\s*\{[\s\S]*?max-width:\s*1000px;[\s\S]*?margin:\s*0 auto;/);
    expect(runtimeCss).toMatch(/\.cla-survey-runtime \.sd-question\.sd-element--with-frame\s*\{[\s\S]*?padding:\s*40px;[\s\S]*?margin-bottom:\s*1rem;[\s\S]*?box-shadow:\s*0 0 0 1px rgba\(49, 201, 166, 0\.4\);/);
  });

  it('matches the effective DefaultV2 typography rendered by production', () => {
    expect(runtimeCss).toMatch(/\.cla-survey-runtime \.sd-root-modern,[\s\S]*?font-family:\s*"Open Sans", "Helvetica Neue", Helvetica, Arial, sans-serif;/);
    expect(runtimeCss).toMatch(/\.cla-survey-runtime \.sd-title\.sd-element__title\s*\{[\s\S]*?color:\s*#161616;[\s\S]*?font-weight:\s*600;/);
    expect(runtimeCss).toMatch(/\.cla-survey-runtime \.sd-element__title span\s*\{[\s\S]*?font-size:\s*16px;[\s\S]*?line-height:\s*24px;/);
    expect(runtimeCss).toMatch(/\.cla-survey-runtime \.sd-description\s*\{[\s\S]*?color:\s*#909090;[\s\S]*?font-size:\s*16px;[\s\S]*?font-weight:\s*400;[\s\S]*?line-height:\s*24px;/);
  });

  it('retains historical progress, rating, button, and input rules', () => {
    expect(runtimeCss).toContain('.cla-survey-runtime .sd-progress__bar');
    expect(runtimeCss).toMatch(/\.cla-survey-runtime \.sd-progress\s*\{\s*height:\s*2px;/);
    expect(runtimeCss).toContain('.cla-survey-runtime .sd-rating__item--selected');
    expect(runtimeCss).toContain('.cla-survey-runtime .sd-navigation__complete-btn');
    expect(runtimeCss).toContain('.cla-survey-runtime .sd-input:not(.sd-tagbox)');
    expect(runtimeCss).toMatch(/background:\s*#42b4af !important;/);
    expect(runtimeCss).toMatch(/min-height:\s*42px;/);
  });

  it('keeps mobile tagbox and custom ranking safeguards in the shared scope', () => {
    expect(runtimeCss).toContain('@media (max-width: 599.95px)');
    expect(runtimeCss).toContain('.cla-survey-runtime .draggable-ranking-host [data-rbd-draggable-id]');
    expect(runtimeCss).toContain('white-space: normal;');
    expect(runtimeCss).toContain('overflow-wrap: anywhere;');
    expect(runtimeCss).toContain('--respondent-tag-value-width: 100%;');
    expect(runtimeCss).toMatch(/@media[\s\S]*?\.sd-question\.sd-element--with-frame\s*\{[\s\S]*?box-shadow:\s*none;/);
    expect(runtimeCss).toMatch(/@media[\s\S]*?\.sd-description\s*\{[\s\S]*?font-size:\s*13px;/);
    expect(runtimeCss).toMatch(/@media[\s\S]*?\.sd-body__progress--bottom\s*\{[\s\S]*?margin-top:\s*32px;/);
  });

  it('opts in only the respondent runtime and dashboard Demo Survey', () => {
    const dashboardPreview = readFileSync(
      resolve(process.cwd(), 'src/components/SurveyEditor.js'),
      'utf8'
    );
    const respondentRuntime = readFileSync(
      resolve(process.cwd(), '../network-survey/src/SurveyComponent.jsx'),
      'utf8'
    );

    for (const source of [dashboardPreview, respondentRuntime]) {
      expect(source).toContain('applyProductionSurveyTheme');
      expect(source).toContain('PRODUCTION_SURVEY_CLASS_NAME');
      expect(source).toContain('surveyRuntime.css');
      expect(source).not.toMatch(/Model\.cssType|cssType\s*=/);
    }
    expect(dashboardPreview).toContain('data-testid="branded-survey-wrapper"');
    expect(PRODUCTION_SURVEY_CLASS_NAME).toBe('cla-survey-runtime');
    expect(PRODUCTION_SURVEY_WRAPPER_SX['--survey-primary']).toBe('#42B4AF');
  });

  it('does not expose unscoped SurveyJS selectors that can style Creator', () => {
    expect(runtimeCss).not.toMatch(/^\s*\.(?:sd|sv)-/m);
    expect(runtimeCss).not.toContain('.svc-');
  });
});
