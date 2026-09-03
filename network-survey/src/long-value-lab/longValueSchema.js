import { Serializer } from 'survey-core';

export const LONG_VALUE_DEFINITION_PROPERTY = 'definition';

/** Register the lab-only additive property on SurveyJS ItemValue instances. */
export function registerLongValueDefinitionProperty() {
  if (!Serializer.findProperty('itemvalue', LONG_VALUE_DEFINITION_PROPERTY)) {
    Serializer.addProperty('itemvalue', {
      name: `${LONG_VALUE_DEFINITION_PROPERTY}:text`,
      category: 'general',
      visible: false,
    });
  }
}

/** Read a definition from either JSON data or a materialized SurveyJS ItemValue. */
export function extractChoiceDefinition(choice) {
  if (!choice || typeof choice !== 'object') return '';
  const raw = typeof choice.getPropertyValue === 'function'
    ? choice.getPropertyValue(LONG_VALUE_DEFINITION_PROPERTY)
    : choice[LONG_VALUE_DEFINITION_PROPERTY];
  return typeof raw === 'string' ? raw : '';
}

export function choiceMachineValue(choice) {
  if (choice && typeof choice === 'object' && 'value' in choice) return choice.value;
  return choice;
}

export function choiceLabel(choice) {
  if (choice && typeof choice === 'object') {
    const label = choice.text ?? choice.title ?? choice.label;
    if (label !== undefined && label !== null && label !== '') return String(label);
  }
  const value = choiceMachineValue(choice);
  return value === undefined || value === null ? '' : String(value);
}

export function extractLongValueChoices(question) {
  return (Array.isArray(question?.choices) ? question.choices : []).map((choice) => ({
    source: choice,
    value: choiceMachineValue(choice),
    label: choiceLabel(choice),
    definition: extractChoiceDefinition(choice),
  }));
}
