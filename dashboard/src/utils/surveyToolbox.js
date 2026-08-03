// Keep this list aligned with the API's supported answer-bearing question types.
// Containers and display-only elements are intentionally excluded.
export const SUPPORTED_SURVEY_TOOLBOX_TYPES = Object.freeze([
  'text',
  'comment',
  'boolean',
  'rating',
  'radiogroup',
  'dropdown',
  'checkbox',
  'tagbox',
  'ranking',
  'draggableranking',
  'imagepicker',
  'file',
  'matrix',
  'matrixdropdown',
  'matrixdynamic',
  'multipletext',
]);

const supportedTypeSet = new Set(SUPPORTED_SURVEY_TOOLBOX_TYPES);

export const setSurveyToolboxItem = (toolbox, item) => {
  if (!toolbox || typeof toolbox.removeItem !== 'function' || typeof toolbox.addItem !== 'function') {
    return;
  }
  toolbox.removeItem(item.name);
  toolbox.addItem(item);
};

export const restrictSurveyToolbox = (toolbox) => {
  if (!toolbox || !Array.isArray(toolbox.itemNames) || typeof toolbox.removeItem !== 'function') {
    return;
  }

  toolbox.itemNames
    .filter((name) => !supportedTypeSet.has(name))
    .forEach((name) => toolbox.removeItem(name));
};
