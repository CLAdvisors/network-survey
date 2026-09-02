import { Model } from 'survey-core';
import { describe, expect, it } from 'vitest';
import {
  extractLongValueChoices,
  registerLongValueDefinitionProperty,
} from './longValueSchema';

describe('long-value experimental SurveyJS schema', () => {
  it('keeps machine values, labels, and multiline definitions separate through SurveyJS', () => {
    registerLongValueDefinitionProperty();
    const model = new Model({
      elements: [{
        type: 'radiogroup',
        name: 'charter',
        choices: [{
          value: 'stable-machine-id',
          text: 'Readable label',
          definition: 'First paragraph.\n\nSecond paragraph.',
        }],
      }],
    });

    const question = model.getQuestionByName('charter');
    expect(extractLongValueChoices(question)).toEqual([expect.objectContaining({
      value: 'stable-machine-id',
      label: 'Readable label',
      definition: 'First paragraph.\n\nSecond paragraph.',
    })]);
    expect(question.toJSON().choices[0]).toEqual({
      value: 'stable-machine-id',
      text: 'Readable label',
      definition: 'First paragraph.\n\nSecond paragraph.',
    });
  });

  it('ignores non-string metadata instead of coercing it into respondent copy', () => {
    expect(extractLongValueChoices({ choices: [{ value: 'safe', text: 'Safe', definition: { html: '<b>no</b>' } }] }))
      .toEqual([expect.objectContaining({ definition: '' })]);
  });
});
