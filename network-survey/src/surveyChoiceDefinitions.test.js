import { Model, Serializer } from 'survey-core';
import { describe, expect, it } from 'vitest';
import {
  CHOICE_DEFINITION_PROPERTY,
  getChoiceDefinition,
  registerChoiceDefinitionProperty,
} from '@network-survey/frontend-shared';

describe('production SurveyJS choice definitions', () => {
  it('registers idempotently before model construction and preserves stable values', () => {
    const first = registerChoiceDefinitionProperty({ visible: false });
    const second = registerChoiceDefinitionProperty({ visible: false });
    expect(first).toBe(second);
    expect(Serializer.findProperty('itemvalue', CHOICE_DEFINITION_PROPERTY)).toBe(first);

    const model = new Model({
      elements: [{
        type: 'radiogroup',
        name: 'priority',
        choices: [{
          value: 'stable-machine-value',
          text: 'Readable label',
          definition: 'First paragraph.\n\nSecond paragraph.',
        }],
      }],
    });
    const choice = model.getQuestionByName('priority').choices[0];

    expect(choice.value).toBe('stable-machine-value');
    expect(getChoiceDefinition(choice)).toBe('First paragraph.\n\nSecond paragraph.');
    expect(model.getQuestionByName('priority').toJSON().choices[0]).toEqual({
      value: 'stable-machine-value',
      text: 'Readable label',
      definition: 'First paragraph.\n\nSecond paragraph.',
    });
  });

  it('refuses to coerce structured or HTML-like metadata and returns strings literally', () => {
    expect(getChoiceDefinition({ definition: { html: '<b>unsafe</b>' } })).toBe('');
    expect(getChoiceDefinition({ definition: '<b>shown literally</b>' })).toBe('<b>shown literally</b>');
  });
});
