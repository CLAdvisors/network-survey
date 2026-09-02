import React from 'react';
import { DefinitionExperience } from './DefinitionExperience';
import { extractLongValueChoices } from './longValueSchema';

export default function LongValueRadiogroup({ question, definitionVariant, popoverHoverTarget }) {
  const choices = React.useMemo(() => extractLongValueChoices(question), [question, question?.choices]);
  const [value, setValue] = React.useState(question?.value);
  const groupName = React.useId();

  React.useEffect(() => {
    const handler = (_, options) => {
      if (options?.name === 'value') setValue(question.value);
    };
    question?.onPropertyChanged?.add?.(handler);
    return () => question?.onPropertyChanged?.remove?.(handler);
  }, [question]);

  const select = (nextValue) => {
    question.value = nextValue;
    setValue(nextValue);
  };

  return (
    <DefinitionExperience variant={definitionVariant} choices={choices} popoverHoverTarget={popoverHoverTarget}>
      {({ renderControl, getItemProps }) => (
        <fieldset className="lv-choice-fieldset">
          <legend className="lv-visually-hidden">{question?.title || question?.name}</legend>
          <p className="lv-task-instruction">Choose one option. Use each information button to inspect a definition without changing your answer.</p>
          <div className="lv-choice-list">
            {choices.map((choice, index) => {
              const selected = Object.is(value, choice.value);
              const inputId = `${groupName}-${index}`;
              return (
                <div key={String(choice.value)} className={`lv-choice${selected ? ' is-selected' : ''}`} {...getItemProps(choice)}>
                  <input
                    id={inputId}
                    type="radio"
                    name={groupName}
                    value={String(choice.value)}
                    checked={selected}
                    onChange={() => select(choice.value)}
                  />
                  <label htmlFor={inputId}>
                    <span>{choice.label}</span>
                    <small>{selected ? 'Selected' : 'Not selected'}</small>
                  </label>
                  {renderControl(choice)}
                </div>
              );
            })}
          </div>
        </fieldset>
      )}
    </DefinitionExperience>
  );
}
