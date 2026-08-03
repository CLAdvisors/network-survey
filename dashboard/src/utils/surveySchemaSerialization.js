export const NESTED_QUESTIONS_UNSUPPORTED_MESSAGE =
  "Nested SurveyJS questions, panels, and pages are not supported. Move every question into the survey's top-level elements array and remove panels/pages before saving.";

const hasUnsupportedNestedElements = (elements) => (
  Array.isArray(elements) && elements.some((element) => (
    element &&
    typeof element === 'object' &&
    (element.type === 'panel' ||
      element.type === 'paneldynamic' ||
      element.elements !== undefined ||
      element.templateElements !== undefined)
  ))
);

/**
 * Converts Survey Creator's one logical page representation to the flat schema
 * accepted by the API. The input is never mutated.
 */
export const serializeFlatSurveySchema = (surveyJson) => {
  const schema = surveyJson && typeof surveyJson === 'object' && !Array.isArray(surveyJson)
    ? surveyJson
    : {};

  let elements = schema.elements;
  if (schema.pages !== undefined) {
    if (!Array.isArray(schema.pages) || schema.pages.length !== 1) {
      throw new Error(NESTED_QUESTIONS_UNSUPPORTED_MESSAGE);
    }

    const page = schema.pages[0];
    if (!page || typeof page !== 'object' ||
        (page.elements !== undefined && !Array.isArray(page.elements))) {
      throw new Error(NESTED_QUESTIONS_UNSUPPORTED_MESSAGE);
    }
    elements = page.elements || [];
  }

  if (hasUnsupportedNestedElements(elements)) {
    throw new Error(NESTED_QUESTIONS_UNSUPPORTED_MESSAGE);
  }

  const { pages: _pages, ...surveyProperties } = schema;
  return {
    ...surveyProperties,
    elements: Array.isArray(elements) ? elements : []
  };
};
