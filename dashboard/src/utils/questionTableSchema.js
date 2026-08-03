import { TAGBOX_PAGE_SIZE } from '@network-survey/frontend-shared';

const NEW_QUESTION_NAME_PREFIX = 'new_question_';
const API_SAFE_QUESTION_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,99}$/;

const applyPeopleTagboxDefaults = (element) => {
  if (element.type !== 'tagbox') return;

  if (!Array.isArray(element.choices)) element.choices = [];
  element.choicesLazyLoadEnabled = true;
  if (!element.choicesLazyLoadPageSize || Number(element.choicesLazyLoadPageSize) <= 0) {
    element.choicesLazyLoadPageSize = TAGBOX_PAGE_SIZE;
  }
  element.allowAddNewTag = false;
};

const createUniqueQuestionName = (proposedName, reservedNames, usedNames, sequence) => {
  if (
    typeof proposedName === 'string'
    && API_SAFE_QUESTION_NAME.test(proposedName)
    && !reservedNames.has(proposedName)
    && !usedNames.has(proposedName)
  ) {
    return proposedName;
  }

  let candidate;
  do {
    candidate = `${NEW_QUESTION_NAME_PREFIX}${sequence.value}`;
    sequence.value += 1;
  } while (reservedNames.has(candidate) || usedNames.has(candidate));
  return candidate;
};

// Patch the table projection onto the persisted schema. Persisted elements are
// matched at most once so an imported row cannot clone an existing question's
// choices, expressions, or other type-specific configuration.
export const buildQuestionTableSchema = (currentSchema, rows) => {
  const current = currentSchema && typeof currentSchema === 'object' ? currentSchema : {};
  const sourceElements = Array.isArray(current.elements) ? current.elements : [];
  const sourceByName = new Map(sourceElements.map((element) => [element.name, element]));
  const reservedNames = new Set(sourceByName.keys());
  const consumedSourceNames = new Set();
  const usedNames = new Set();
  const sequence = { value: 1 };

  return {
    ...current,
    elements: rows.map((row) => {
      const sourceName = typeof row.name === 'string' ? row.name : '';
      const canReuseSource = sourceName
        && sourceByName.has(sourceName)
        && !consumedSourceNames.has(sourceName);
      const existing = canReuseSource ? sourceByName.get(sourceName) : null;

      if (canReuseSource) consumedSourceNames.add(sourceName);

      const name = existing
        ? sourceName
        : createUniqueQuestionName(sourceName, reservedNames, usedNames, sequence);
      usedNames.add(name);

      const max = Number(row.max);
      const element = {
        ...(existing || {}),
        type: row.type || existing?.type || 'tagbox',
        name,
        title: row.text || '',
        isRequired: row.required === true,
      };

      if (Number.isFinite(max) && max > 0) {
        element.maxSelectedChoices = Math.floor(max);
        if (element.type === 'tagbox') element.claMaxSelections = Math.floor(max);
      } else {
        delete element.maxSelectedChoices;
        if (element.type === 'tagbox') element.claMaxSelections = 0;
      }

      // Rows created by Add Row or CSV import have never passed through the
      // Survey Creator hooks, so apply the same People Tagbox runtime contract.
      // Existing choices and valid page-size configuration remain intact.
      applyPeopleTagboxDefaults(element);

      return element;
    }),
  };
};
