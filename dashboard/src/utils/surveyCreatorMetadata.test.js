import { afterAll, describe, expect, it } from 'vitest';
import { Serializer } from 'survey-core';
import { hideQuestionValueName } from './surveyCreatorMetadata';

const valueNameProperty = Serializer.findProperty('question', 'valueName');
const choicesByUrlProperty = Serializer.findProperty('selectbase', 'choicesByUrl');
const originalValueNameVisibility = valueNameProperty?.visible;
const originalChoicesByUrlVisibility = choicesByUrlProperty?.visible;

afterAll(() => {
  if (valueNameProperty) valueNameProperty.visible = originalValueNameVisibility;
  if (choicesByUrlProperty) choicesByUrlProperty.visible = originalChoicesByUrlVisibility;
});

describe('Survey Creator question metadata', () => {
  it('hides valueName for inherited question types without hiding the canonical name', () => {
    hideQuestionValueName();

    expect(Serializer.findProperty('text', 'valueName')?.visible).toBe(false);
    expect(Serializer.findProperty('tagbox', 'valueName')?.visible).toBe(false);
    expect(Serializer.findProperty('matrix', 'valueName')?.visible).toBe(false);
    expect(Serializer.findProperty('question', 'name')?.visible).toBe(true);
  });

  it('hides remote choice URLs from all inherited choice question metadata', () => {
    hideQuestionValueName();

    expect(Serializer.findProperty('checkbox', 'choicesByUrl')?.visible).toBe(false);
    expect(Serializer.findProperty('dropdown', 'choicesByUrl')?.visible).toBe(false);
    expect(Serializer.findProperty('tagbox', 'choicesByUrl')?.visible).toBe(false);
  });
});
