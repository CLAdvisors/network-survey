import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import LongValueRadiogroup from './LongValueRadiogroup';

function questionFixture() {
  const handlers = new Set();
  return {
    name: 'anchor',
    title: 'Choose an anchor',
    value: 'stable-alpha',
    choices: [
      { value: 'stable-alpha', text: 'Alpha', definition: 'Alpha definition.' },
      { value: 'stable-beta', text: 'Beta', definition: 'Beta definition.' },
    ],
    onPropertyChanged: {
      add: (handler) => handlers.add(handler),
      remove: (handler) => handlers.delete(handler),
    },
    emitValueChanged() {
      handlers.forEach((handler) => handler(this, { name: 'value' }));
    },
  };
}

describe('LongValueRadiogroup', () => {
  it('keeps the stable SurveyJS answer unchanged while definitions are opened', () => {
    const question = questionFixture();
    render(<LongValueRadiogroup question={question} definitionVariant="inline" />);

    expect(screen.getByRole('radio', { name: /Alpha Selected/ })).toBeChecked();
    fireEvent.click(screen.getByRole('button', { name: 'Show definition for Beta' }));
    expect(question.value).toBe('stable-alpha');
    expect(screen.getByRole('radio', { name: /Alpha Selected/ })).toBeChecked();

    fireEvent.click(screen.getByRole('radio', { name: /Beta Not selected/ }));
    expect(question.value).toBe('stable-beta');
    expect(screen.getByRole('radio', { name: /Beta Selected/ })).toBeChecked();
  });

  it('preserves answer state while switching definition variants', () => {
    const question = questionFixture();
    const view = render(<LongValueRadiogroup question={question} definitionVariant="popover" />);
    fireEvent.click(screen.getByRole('radio', { name: /Beta Not selected/ }));

    view.rerender(<LongValueRadiogroup question={question} definitionVariant="panel" />);
    expect(question.value).toBe('stable-beta');
    expect(screen.getByRole('radio', { name: /Beta Selected/ })).toBeChecked();
    expect(screen.getAllByRole('complementary', { name: 'Selected value definition' })).toHaveLength(2);
  });

  it('subscribes to external SurveyJS value changes', () => {
    const question = questionFixture();
    render(<LongValueRadiogroup question={question} definitionVariant="inline" />);
    act(() => {
      question.value = 'stable-beta';
      question.emitValueChanged();
    });
    expect(screen.getByRole('radio', { name: /Beta Selected/ })).toBeChecked();
  });
});
