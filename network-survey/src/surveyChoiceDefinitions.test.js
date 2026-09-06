import { Model, Serializer } from 'survey-core';
import { describe, expect, it } from 'vitest';
import {
  CHOICE_DEFINITION_PROPERTY,
  getChoiceDefinition,
  QuestionDraggableRankingModel,
  registerChoiceDefinitionProperty,
} from '@network-survey/frontend-shared';

if (!Serializer.findClass('draggableranking')) {
  Serializer.addClass(
    'draggableranking',
    [
      { name: 'choices:itemvalues', default: [] },
      { name: 'minSelectedChoices:number', default: 0, minValue: 0 },
      { name: 'maxSelectedChoices:number', default: 0, minValue: 0 },
    ],
    () => new QuestionDraggableRankingModel(''),
    'question'
  );
}

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

  it('exposes the custom composite ranking with group semantics', () => {
    const question = new QuestionDraggableRankingModel('ranking');
    expect(question.getType()).toBe('draggableranking');
    expect(question.ariaRole).toBe('group');
    expect(question.isNewA11yStructure).toBe(false);
  });

  it('validates the configurable minimum while preserving omission as no minimum', () => {
    const legacy = new QuestionDraggableRankingModel('legacy');
    legacy.value = ['one'];
    const legacyErrors = [];
    legacy.onCheckForErrors(legacyErrors, false, true);
    expect(legacyErrors).toEqual([]);

    const configured = new QuestionDraggableRankingModel('configured');
    configured.minSelectedChoices = 2;
    configured.value = ['one'];
    const errors = [];
    configured.onCheckForErrors(errors, false, true);
    expect(errors).toHaveLength(1);
    expect(errors[0].getText()).toContain('2');

    configured.value = ['one', 'two'];
    const satisfiedErrors = [];
    configured.onCheckForErrors(satisfiedErrors, false, true);
    expect(satisfiedErrors).toEqual([]);
  });

  it('applies a positive minimum to optional visible questions but exempts hidden and disabled ones', () => {
    const survey = new Model({ elements: [
      { type: 'boolean', name: 'show' },
      {
        type: 'draggableranking', name: 'visible', choices: ['one'],
        isRequired: false, minSelectedChoices: 1,
      },
      {
        type: 'draggableranking', name: 'hidden', choices: ['one'],
        isRequired: false, minSelectedChoices: 1, visibleIf: '{show} = true',
      },
      {
        type: 'draggableranking', name: 'disabled', choices: ['one'],
        isRequired: false, minSelectedChoices: 1, enableIf: '{show} = true',
      },
    ] });
    survey.data = { show: false };
    const visible = survey.getQuestionByName('visible');
    const hidden = survey.getQuestionByName('hidden');
    const disabled = survey.getQuestionByName('disabled');

    expect(survey.validate()).toBe(false);
    expect(visible.errors).toHaveLength(1);
    expect(hidden.errors).toHaveLength(0);
    expect(disabled.errors).toHaveLength(0);

    visible.value = ['one'];
    expect(survey.validate()).toBe(true);
  });

  it('refuses to coerce structured or HTML-like metadata and returns strings literally', () => {
    expect(getChoiceDefinition({ definition: { html: '<b>unsafe</b>' } })).toBe('');
    expect(getChoiceDefinition({ definition: '<b>shown literally</b>' })).toBe('<b>shown literally</b>');
  });
});
