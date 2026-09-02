import { Serializer } from 'survey-core';
import {
  CHOICE_DEFINITION_PROPERTY,
  registerChoiceDefinitionProperty,
} from '@network-survey/frontend-shared';

export const DRAGGABLE_RANKING_DEFINITION_LIMITS = Object.freeze({
  choices: 100,
  surveyChoices: 1000,
  valueCharacters: 128,
  valueBytes: 512,
  textCharacters: 240,
  textBytes: 1024,
  definitionCharacters: 10_000,
  definitionBytes: 40 * 1024,
  surveyDefinitionCharacters: 250_000,
  surveyDefinitionBytes: 512 * 1024,
});

const FORBIDDEN_LITERAL_CHARACTERS = /[\u0000-\u0009\u000B-\u001F\u007F-\u009F\u061C\u200E\u200F\u202A-\u202E\u2066-\u2069]/u;
const textEncoder = typeof TextEncoder === 'undefined' ? null : new TextEncoder();
const typeOf = (element) => typeof element?.getType === 'function' ? element.getType() : element?.type;
const characterCount = (value) => [...value].length;
const byteCount = (value) => textEncoder ? textEncoder.encode(value).length : unescape(encodeURIComponent(value)).length;

export const choiceDefinitionError = (value) => {
  if (value === undefined || value === null || value === '') return '';
  if (typeof value !== 'string') return 'Definition must be plain text.';
  const normalized = value.replace(/\r\n?/g, '\n').trim();
  if (FORBIDDEN_LITERAL_CHARACTERS.test(normalized)) {
    return 'Definition contains a forbidden control or bidirectional formatting character.';
  }
  if (!normalized) return '';
  const limits = DRAGGABLE_RANKING_DEFINITION_LIMITS;
  if (characterCount(normalized) > limits.definitionCharacters || byteCount(normalized) > limits.definitionBytes) {
    return `Definition exceeds its ${limits.definitionCharacters}-character or ${limits.definitionBytes}-byte limit.`;
  }
  return '';
};

/** Register authoring metadata before any Survey Creator model is constructed. */
export const registerDraggableRankingDefinitionMetadata = () => {
  const property = registerChoiceDefinitionProperty({
    visible: false,
    category: 'choices',
    displayName: 'Definition (optional plain text)',
  }) || Serializer.findProperty('itemvalue', CHOICE_DEFINITION_PROPERTY);

  if (!property) return null;
  property.isLocalizable = false;
  property.locationInTable = 'detail';
  property.visible = true;
  property.visibleIf = (choice) => typeOf(choice?.locOwner) === 'draggableranking';
  property.onPropertyEditorUpdate = (_choice, editor) => {
    editor.rows = 5;
    editor.autoGrow = true;
    editor.allowResize = true;
    editor.descriptionLocation = 'underInput';
    editor.description = 'Optional plain text shown by the respondent information button. Line breaks are preserved and HTML is displayed literally. If any choice has a definition, every choice needs separate Value and Text strings; each ranking is limited to 100 choices and definition-enabled rankings to 1,000 choices per survey. Each definition is limited to 10,000 characters / 40,960 UTF-8 bytes, and all survey definitions together to 250,000 characters / 524,288 bytes.';
  };
  return property;
};

/** Fast Entry drops per-choice fields, so it is unsafe when definitions exist. */
export const configureDraggableRankingChoiceEditor = (_sender, options) => {
  if (options?.propertyName !== 'choices' || typeOf(options?.element || options?.obj) !== 'draggableranking') return;
  options.allowBatchEdit = false;
  if (options.editorOptions) {
    options.editorOptions.allowBatchEdit = false;
    options.editorOptions.showTextView = false;
  }
};

export const validateDraggableRankingDefinitionProperty = (_sender, options) => {
  if (options?.propertyName !== CHOICE_DEFINITION_PROPERTY || typeOf(options?.element?.locOwner || options?.obj?.locOwner) !== 'draggableranking') return;
  options.error = choiceDefinitionError(options.value);
};

const boundedLiteralError = (value, label, maxCharacters, maxBytes) => {
  if (typeof value !== 'string') return `${label} must be an explicit string.`;
  const lineNormalized = value.replace(/\r\n?/g, '\n');
  if (FORBIDDEN_LITERAL_CHARACTERS.test(lineNormalized)) return `${label} contains a forbidden control or bidirectional formatting character.`;
  const normalized = lineNormalized.trim();
  if (!normalized) return `${label} must be nonempty.`;
  if (characterCount(normalized) > maxCharacters || byteCount(normalized) > maxBytes) {
    return `${label} exceeds its ${maxCharacters}-character or ${maxBytes}-byte limit.`;
  }
  return '';
};

/**
 * Materialize value/text strings required by the backend whenever a ranking has
 * definitions. SurveyJS normally omits text when it equals value.
 */
export const normalizeDraggableRankingDefinitions = (elements) => {
  let surveyCharacters = 0;
  let surveyBytes = 0;
  let surveyChoices = 0;
  const limits = DRAGGABLE_RANKING_DEFINITION_LIMITS;

  const normalized = (Array.isArray(elements) ? elements : []).map((element, questionIndex) => {
    if (element?.type !== 'draggableranking' || !Array.isArray(element.choices)) return element;
    const hasDefinitions = element.choices.some((choice) => {
      if (!choice || typeof choice !== 'object' || Array.isArray(choice) ||
          !Object.prototype.hasOwnProperty.call(choice, CHOICE_DEFINITION_PROPERTY)) return false;
      if (typeof choice.definition !== 'string') return true;
      const lineNormalized = choice.definition.replace(/\r\n?/g, '\n');
      return FORBIDDEN_LITERAL_CHARACTERS.test(lineNormalized) || lineNormalized.trim().length > 0;
    });
    if (!hasDefinitions) return element;
    if (element.choices.length > limits.choices) {
      throw new Error(`Question ${questionIndex + 1} with definitions may contain at most ${limits.choices} choices.`);
    }
    surveyChoices += element.choices.length;
    if (surveyChoices > limits.surveyChoices) {
      throw new Error(`Definition-enabled rankings may contain at most ${limits.surveyChoices} choices across the survey.`);
    }

    const values = new Set();
    const choices = element.choices.map((choice, choiceIndex) => {
      const label = `Question ${questionIndex + 1} choice ${choiceIndex + 1}`;
      if (!choice || typeof choice !== 'object' || Array.isArray(choice)) {
        throw new Error(`${label} must use separate text and value fields when any definition is present.`);
      }
      if (!Object.prototype.hasOwnProperty.call(choice, 'value') || typeof choice.value !== 'string') {
        throw new Error(`${label} must explicitly define string value and text properties when any definition is present.`);
      }
      // SurveyJS omits text from toJSON() when the displayed label equals value.
      // Persist that effective label explicitly so the API still receives the
      // stable value + short label contract authors see in Creator.
      const textSource = Object.prototype.hasOwnProperty.call(choice, 'text')
        ? choice.text
        : choice.value;
      if (typeof textSource !== 'string') {
        throw new Error(`${label} must explicitly define string value and text properties when any definition is present.`);
      }
      if (/[\r\n]/u.test(choice.value)) {
        throw new Error(`${label} value must be canonical and may not contain CR or LF characters.`);
      }
      if (choice.value !== choice.value.trim()) {
        throw new Error(`${label} value must be canonical and may not have leading or trailing whitespace.`);
      }
      const valueError = boundedLiteralError(choice.value, `${label} value`, limits.valueCharacters, limits.valueBytes);
      if (valueError) throw new Error(valueError);
      const textError = boundedLiteralError(textSource, `${label} text`, limits.textCharacters, limits.textBytes);
      if (textError) throw new Error(textError);
      const value = choice.value;
      const text = textSource.replace(/\r\n?/g, '\n').trim();
      if (values.has(value)) throw new Error(`Question ${questionIndex + 1} choice values must be unique: ${value}.`);
      values.add(value);

      const next = { ...choice, value, text };
      if (Object.prototype.hasOwnProperty.call(choice, CHOICE_DEFINITION_PROPERTY)) {
        const error = choiceDefinitionError(choice.definition);
        if (error) throw new Error(`${label}: ${error}`);
        const definition = typeof choice.definition === 'string' ? choice.definition.replace(/\r\n?/g, '\n').trim() : '';
        if (definition) {
          next.definition = definition;
          surveyCharacters += characterCount(definition);
          surveyBytes += byteCount(definition);
        } else {
          delete next.definition;
        }
      }
      return next;
    });
    return { ...element, choices };
  });

  if (surveyCharacters > limits.surveyDefinitionCharacters || surveyBytes > limits.surveyDefinitionBytes) {
    throw new Error(`Survey choice definitions exceed the ${limits.surveyDefinitionCharacters}-character or ${limits.surveyDefinitionBytes}-byte aggregate limit.`);
  }
  return normalized;
};
