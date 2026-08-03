import { describe, expect, it } from 'vitest';
import { SurveyCreator } from 'survey-creator-react';
import {
  NESTED_QUESTIONS_UNSUPPORTED_MESSAGE,
  serializeFlatSurveySchema,
} from './surveySchemaSerialization';

describe('serializeFlatSurveySchema', () => {
  it('saves the single logical page created for a flat one-question survey', () => {
    const creator = new SurveyCreator({
      showPagesPanel: false,
      pageEditMode: 'single'
    });
    creator.JSON = {
      elements: [{ type: 'text', name: 'question_1', title: 'Your name' }]
    };

    // Survey Creator internally represents even a loaded flat schema as a page.
    const editorJson = creator.survey.toJSON();
    expect(editorJson.pages).toHaveLength(1);

    expect(serializeFlatSurveySchema(editorJson)).toEqual({
      elements: [{ type: 'text', name: 'question_1', title: 'Your name' }]
    });
    creator.dispose();
  });

  it('accepts SurveyJS\'s single empty page representation', () => {
    expect(serializeFlatSurveySchema({ pages: [{ name: 'page1' }] })).toEqual({ elements: [] });
  });

  it('preserves survey properties and expressions while removing one page', () => {
    const schema = {
      showQuestionNumbers: 'off',
      calculatedValues: [{ name: 'score', expression: '{question_1} * 2' }],
      completedHtml: 'Score: {score}',
      pages: [{
        name: 'page1',
        elements: [{
          type: 'text',
          name: 'question_1',
          visibleIf: '{enabled} = true',
          requiredIf: '{score} > 0'
        }]
      }]
    };

    const result = serializeFlatSurveySchema(schema);

    expect(result).toEqual({
      showQuestionNumbers: 'off',
      calculatedValues: [{ name: 'score', expression: '{question_1} * 2' }],
      completedHtml: 'Score: {score}',
      elements: [{
        type: 'text',
        name: 'question_1',
        visibleIf: '{enabled} = true',
        requiredIf: '{score} > 0'
      }]
    });
    expect(schema.pages).toHaveLength(1);
  });

  it('keeps an already-flat elements schema', () => {
    const schema = {
      locale: 'en',
      elements: [{ type: 'boolean', name: 'question_1' }]
    };

    expect(serializeFlatSurveySchema(schema)).toEqual(schema);
  });

  it('rejects multiple pages with the actionable unsupported message', () => {
    const schema = {
      pages: [
        { name: 'page1', elements: [{ type: 'text', name: 'question_1' }] },
        { name: 'page2', elements: [{ type: 'text', name: 'question_2' }] }
      ]
    };

    expect(() => serializeFlatSurveySchema(schema)).toThrow(NESTED_QUESTIONS_UNSUPPORTED_MESSAGE);
  });

  it.each([
    [{ type: 'panel', name: 'panel1', elements: [] }],
    [{ type: 'paneldynamic', name: 'panel1', templateElements: [] }],
    [{ type: 'text', name: 'question_1', templateElements: [] }]
  ])('rejects nested panel/template elements instead of flattening them', (elements) => {
    expect(() => serializeFlatSurveySchema({ pages: [{ name: 'page1', elements }] }))
      .toThrow(NESTED_QUESTIONS_UNSUPPORTED_MESSAGE);
  });
});
