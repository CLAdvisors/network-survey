import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(resolve(process.cwd(), 'src/components/SurveyEditor.js'), 'utf8');

describe('Survey Editor definition runtime integration', () => {
  it('routes both Creator Preview and custom Demo Survey through the production renderer', () => {
    expect(source.match(/attachDraggableRankingRenderer\(surveyModel\)/g)).toHaveLength(1);
    expect(source).toContain("configureSurveyModel(options.survey, 'preview')");
    expect(source).toContain("configureSurveyModel(model, 'preview-runtime')");
    expect(source).not.toContain('ReactDOM.createRoot');
  });

  it('registers definition metadata before constructing Survey Creator', () => {
    expect(source.indexOf('registerDraggableRankingDefinitionMetadata();'))
      .toBeLessThan(source.indexOf('new SurveyCreator(creatorOptions)'));
    expect(source).toContain('showJSONEditorTab: false');
  });
});
