import { Serializer } from 'survey-core';

// The API assigns canonical question names as response keys and deliberately
// supplies selection choices itself. Creator must not expose alternate answer
// keys or remote choice URLs that the API will not resolve.
export const hideQuestionValueName = () => {
  const unsupportedProperties = [
    Serializer.findProperty('question', 'valueName'),
    Serializer.findProperty('selectbase', 'choicesByUrl'),
  ];

  unsupportedProperties.forEach((property) => {
    if (property) property.visible = false;
  });
};
