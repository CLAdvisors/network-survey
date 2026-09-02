import { Serializer } from 'survey-core';

export const CHOICE_DEFINITION_PROPERTY = 'definition';

/**
 * Registers the additive, plain-text definition field used by choice-based
 * questions. Calling this more than once is safe (respondent and dashboard
 * bundles share SurveyJS's global Serializer).
 */
export function registerChoiceDefinitionProperty(options = {}) {
  const {
    visible = true,
    category = 'choices',
    displayName = 'Definition',
  } = options;

  let property = Serializer.findProperty('itemvalue', CHOICE_DEFINITION_PROPERTY);
  if (!property) {
    Serializer.addProperty('itemvalue', {
      name: `${CHOICE_DEFINITION_PROPERTY}:text`,
      category,
      displayName,
      visible,
    });
    property = Serializer.findProperty('itemvalue', CHOICE_DEFINITION_PROPERTY);
  }
  if (property?.type !== 'text' || property?.isLocalizable === true) {
    throw new Error('SurveyJS itemvalue.definition is registered with an incompatible schema.');
  }
  return property;
}

/** Reads only literal string definitions from JSON or SurveyJS ItemValue. */
export function getChoiceDefinition(choice) {
  if (!choice || typeof choice !== 'object') return '';
  const value = typeof choice.getPropertyValue === 'function'
    ? choice.getPropertyValue(CHOICE_DEFINITION_PROPERTY)
    : choice[CHOICE_DEFINITION_PROPERTY];
  return typeof value === 'string' ? value : '';
}
