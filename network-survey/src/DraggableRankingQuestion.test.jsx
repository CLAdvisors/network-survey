import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Model, Question, Serializer } from 'survey-core';
import { EXCLUSIVE_GROUP_PROPERTY } from '@network-survey/frontend-shared';
import { DraggableRankingQuestion } from '@network-survey/frontend-react';

if (!Serializer.findClass('draggableranking')) {
  class QuestionDraggableRankingModel extends Question {
    getType() {
      return 'draggableranking';
    }
  }
  Serializer.addClass(
    'draggableranking',
    [
      { name: 'choices:itemvalues', default: [] },
      { name: 'minSelectedChoices:number', default: 0, minValue: 0 },
      { name: 'maxSelectedChoices:number', default: 0, minValue: 0 },
    ],
    () => new QuestionDraggableRankingModel(''),
    'question'
  );
  Serializer.addProperty('draggableranking', EXCLUSIVE_GROUP_PROPERTY);
}

vi.mock('react-beautiful-dnd', () => ({
  DragDropContext: ({ children, onDragStart, onDragEnd }) => (
    <div>
      <button data-testid="start-ranked" onClick={() => onDragStart({ source: { droppableId: 'ranked' } })}>
        Start ranked drag
      </button>
      <button data-testid="finish-ranked-reorder" onClick={() => onDragEnd({
        source: { droppableId: 'ranked', index: 0 },
        destination: { droppableId: 'ranked', index: 1 },
      })}>
        Finish ranked reorder
      </button>
      <button data-testid="start-available" onClick={() => onDragStart({ source: { droppableId: 'available' } })}>
        Start available drag
      </button>
      {children}
    </div>
  ),
  Droppable: ({ children, droppableId, direction, isDropDisabled = false }) => children(
    {
      innerRef: vi.fn(),
      droppableProps: {
        'data-testid': `drop-${droppableId}`,
        'data-direction': direction,
        'data-disabled': String(isDropDisabled),
      },
      placeholder: null,
    },
    { isDraggingOver: false }
  ),
  Draggable: ({ children }) => children(
    {
      innerRef: vi.fn(),
      draggableProps: { style: {} },
      dragHandleProps: {},
    },
    { isDragging: false }
  ),
}));

function createQuestion(value = []) {
  const handlers = new Set();
  return {
    choices: ['Alex', 'Blair', 'Casey'],
    maxSelectedChoices: 2,
    value,
    onPropertyChanged: {
      add: (handler) => handlers.add(handler),
      remove: (handler) => handlers.delete(handler),
    },
    emitValueChanged() {
      handlers.forEach((handler) => handler(this, { name: 'value' }));
    },
  };
}

describe('DraggableRankingQuestion', () => {
  it('synchronizes external SurveyJS value changes', async () => {
    const question = createQuestion(['Alex']);
    render(
      <DraggableRankingQuestion
        question={question}
        value={question.value}
        onChange={vi.fn()}
        valueSource="question"
      />
    );

    await waitFor(() => expect(within(screen.getByTestId('drop-ranked')).getByText('Alex')).toBeInTheDocument());

    question.value = ['Blair'];
    question.emitValueChanged();

    await waitFor(() => {
      const ranked = within(screen.getByTestId('drop-ranked'));
      expect(ranked.getByText('Blair')).toBeInTheDocument();
      expect(ranked.queryByText('Alex')).not.toBeInTheDocument();
    });
  });

  it('normalizes inherited SurveyJS ItemValue values without duplicating ranked options', async () => {
    const question = createQuestion([]);
    question.choices = ['Alex', 'Blair'].map((name) => Object.create({ value: name, text: name }));
    const onChange = vi.fn((nextValue) => {
      question.value = nextValue;
      question.emitValueChanged();
    });
    render(
      <DraggableRankingQuestion
        question={question}
        value={question.value}
        onChange={onChange}
        valueSource="question"
      />
    );

    fireEvent.click(await screen.findByRole('button', { name: 'Select: Alex' }));

    await waitFor(() => {
      expect(onChange).toHaveBeenCalledWith(['Alex']);
      expect(within(screen.getByTestId('drop-ranked')).getByText('Alex')).toBeInTheDocument();
      expect(within(screen.getByTestId('drop-available')).queryByText('Alex')).not.toBeInTheDocument();
    });
  });

  it('offers keyboard-operable select and unselect actions', async () => {
    const question = createQuestion([]);
    const onChange = vi.fn();
    render(
      <DraggableRankingQuestion question={question} value={question.value} onChange={onChange} />
    );

    expect(await screen.findByText('Selected options (drag to select):')).toBeInTheDocument();
    expect(screen.queryByText('Selected options (drag to reorder):')).not.toBeInTheDocument();

    const selectButton = screen.getByRole('button', { name: 'Select: Alex' });
    selectButton.focus();
    await userEvent.keyboard('{Enter}');

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Unselect: Alex' })).toHaveFocus();
    });
  });

  it('selects a lower-list option by action without disturbing available ordering', async () => {
    const question = createQuestion([]);
    const onChange = vi.fn();
    render(
      <DraggableRankingQuestion question={question} value={question.value} onChange={onChange} />
    );

    fireEvent.click(await screen.findByRole('button', { name: 'Select: Casey' }));

    expect(onChange).toHaveBeenLastCalledWith(['Casey']);
    expect(within(screen.getByTestId('drop-ranked')).getByText('Casey')).toBeInTheDocument();
    expect(within(screen.getByTestId('drop-available')).getAllByRole('button')
      .map((button) => button.getAttribute('aria-label'))).toEqual(['Select: Alex', 'Select: Blair']);
  });

  it('announces configured minimum and maximum selection progress', async () => {
    const question = createQuestion(['Alex']);
    question.minSelectedChoices = 2;
    render(
      <DraggableRankingQuestion question={question} value={question.value} onChange={vi.fn()} />
    );

    expect(await screen.findByRole('status')).toHaveTextContent('Selected 1 of 2 (minimum 2)');
    expect(screen.getByRole('status')).toHaveAttribute('aria-live', 'polite');
  });

  it('preserves controlled value-prop updates', async () => {
    const question = createQuestion(['Alex']);
    const props = { question, onChange: vi.fn() };
    const { rerender } = render(
      <DraggableRankingQuestion {...props} value={['Alex']} />
    );

    await waitFor(() => expect(within(screen.getByTestId('drop-ranked')).getByText('Alex')).toBeInTheDocument());

    question.value = ['Blair'];
    question.emitValueChanged();
    expect(within(screen.getByTestId('drop-ranked')).getByText('Alex')).toBeInTheDocument();

    rerender(<DraggableRankingQuestion {...props} value={['Casey']} />);

    await waitFor(() => {
      const ranked = within(screen.getByTestId('drop-ranked'));
      expect(ranked.getByText('Casey')).toBeInTheDocument();
      expect(ranked.queryByText('Alex')).not.toBeInTheDocument();
    });
  });

  it('allows ranked items to reorder when the selection limit is full', async () => {
    const question = createQuestion(['Alex', 'Blair']);
    const onChange = vi.fn();
    render(
      <DraggableRankingQuestion
        question={question}
        value={question.value}
        onChange={onChange}
      />
    );

    await waitFor(() => expect(screen.getByTestId('drop-ranked')).toHaveAttribute('data-disabled', 'true'));

    fireEvent.click(screen.getByTestId('start-ranked'));
    expect(screen.getByTestId('drop-ranked')).toHaveAttribute('data-disabled', 'false');

    fireEvent.click(screen.getByTestId('finish-ranked-reorder'));
    expect(onChange).toHaveBeenLastCalledWith(['Blair', 'Alex']);

    fireEvent.click(screen.getByTestId('start-available'));
    expect(screen.getByTestId('drop-ranked')).toHaveAttribute('data-disabled', 'true');
  });

  it('lets long labels wrap without pushing supplement and select actions onto another row', async () => {
    const question = createQuestion();
    question.choices = ['Borrowed-tool stewardship with a deliberately extended title'];
    render(
      <DraggableRankingQuestion
        question={question}
        value={[]}
        onChange={vi.fn()}
        renderChoiceSupplement={() => <button type="button">Definition</button>}
      />
    );

    const label = await screen.findByText('Borrowed-tool stewardship with a deliberately extended title');
    expect(label).toHaveStyle({ flex: '1 1 0', minWidth: '0' });
    const row = label.parentElement;
    expect(within(row).getByRole('button', { name: 'Definition' })).toBeInTheDocument();
    expect(within(row).getByRole('button', { name: /Select:/ })).toBeInTheDocument();
  });

  it('supports a vertical available-options layout', async () => {
    const question = createQuestion();
    render(
      <DraggableRankingQuestion
        question={question}
        value={question.value}
        onChange={vi.fn()}
        availableDirection="vertical"
      />
    );

    await waitFor(() => expect(screen.getByTestId('drop-available')).toHaveAttribute('data-direction', 'vertical'));
  });
});

describe('DraggableRankingQuestion exclusive groups', () => {
  function groupedSurvey(elements) {
    return new Model({ elements });
  }

  function ranking(name, extra = {}) {
    return {
      type: 'draggableranking',
      name,
      choices: ['Alex', 'Blair', 'Casey'],
      exclusiveGroup: 'values',
      ...extra,
    };
  }

  function renderQuestion(survey, name) {
    const question = survey.getQuestionByName(name);
    const onChange = vi.fn((value) => {
      question.value = value;
    });
    const view = render(
      <DraggableRankingQuestion
        question={question}
        value={question.value || []}
        onChange={onChange}
        valueSource="question"
      />
    );
    return { question, onChange, ...view };
  }

  const availableList = () => screen.getByTestId('drop-available');

  it('hides an option ranked in a linked question and restores it when unranked', async () => {
    const survey = groupedSurvey([ranking('q1'), ranking('q2')]);
    renderQuestion(survey, 'q2');
    await waitFor(() => expect(within(availableList()).getByText('Alex')).toBeInTheDocument());

    act(() => survey.setValue('q1', ['Alex']));
    await waitFor(() => expect(within(availableList()).queryByText('Alex')).not.toBeInTheDocument());
    expect(within(availableList()).getByText('Blair')).toBeInTheDocument();

    act(() => survey.setValue('q1', ['Blair']));
    await waitFor(() => expect(within(availableList()).getByText('Alex')).toBeInTheDocument());
    expect(within(availableList()).queryByText('Blair')).not.toBeInTheDocument();
  });

  it('explains hidden options and warns when the minimum cannot be met', async () => {
    const survey = groupedSurvey([
      ranking('q1'),
      ranking('q2', { minSelectedChoices: 3 }),
    ]);
    renderQuestion(survey, 'q2');
    await waitFor(() => expect(within(availableList()).getByText('Alex')).toBeInTheDocument());
    expect(screen.queryByText(/ranked in another linked question/)).not.toBeInTheDocument();

    act(() => survey.setValue('q1', ['Alex']));
    await waitFor(() => expect(screen.getByText(/1 option is ranked in another linked question/)).toBeInTheDocument());
    expect(screen.getByText(/Unselect an option in another question to free it up/)).toBeInTheDocument();
  });

  it('ignores linked questions that are hidden or read-only', async () => {
    const survey = groupedSurvey([
      { type: 'boolean', name: 'show' },
      ranking('q1', { visibleIf: '{show} = true' }),
      ranking('q2'),
      ranking('q3', { readOnly: true }),
    ]);
    renderQuestion(survey, 'q2');
    await waitFor(() => expect(within(availableList()).getByText('Alex')).toBeInTheDocument());
    act(() => survey.setValue('q1', ['Alex']));
    act(() => survey.setValue('q3', ['Blair']));
    expect(within(availableList()).getByText('Alex')).toBeInTheDocument();
    expect(within(availableList()).getByText('Blair')).toBeInTheDocument();

    act(() => survey.setValue('show', true));
    await waitFor(() => expect(within(availableList()).queryByText('Alex')).not.toBeInTheDocument());
    expect(within(availableList()).getByText('Blair')).toBeInTheDocument();
  });

  it('drops a conflicting value in favor of the earlier question in document order', async () => {
    const survey = groupedSurvey([ranking('q1'), ranking('q2')]);
    const { onChange } = renderQuestion(survey, 'q2');
    act(() => {
      survey.setValue('q1', ['Alex']);
      survey.setValue('q2', ['Alex', 'Blair']);
    });

    await waitFor(() => expect(onChange).toHaveBeenLastCalledWith(['Blair']));
    expect(onChange).not.toHaveBeenCalledWith(['Alex', 'Blair']);
    expect(within(availableList()).queryByText('Alex')).not.toBeInTheDocument();
  });

  it('keeps the stored value of a read-only linked question', async () => {
    const survey = groupedSurvey([
      ranking('q1'),
      ranking('q2', { readOnly: true }),
    ]);
    survey.setValue('q1', ['Alex']);
    survey.setValue('q2', ['Alex']);
    const { onChange } = renderQuestion(survey, 'q2');

    await waitFor(() => expect(within(screen.getByTestId('drop-ranked')).getByText('Alex')).toBeInTheDocument());
    expect(onChange).not.toHaveBeenCalledWith([]);
    expect(survey.getQuestionByName('q2').value).toEqual(['Alex']);
    expect(within(availableList()).queryByText('Alex')).not.toBeInTheDocument();
  });

  it('leaves ungrouped and differently grouped questions untouched', async () => {
    const survey = groupedSurvey([
      ranking('q1'),
      ranking('q2'),
      ranking('q3', { exclusiveGroup: 'other' }),
    ]);
    renderQuestion(survey, 'q2');
    await waitFor(() => expect(within(availableList()).getByText('Alex')).toBeInTheDocument());
    act(() => survey.setValue('q3', ['Alex']));
    expect(within(availableList()).getByText('Alex')).toBeInTheDocument();

    act(() => survey.setValue('q1', ['Alex']));
    await waitFor(() => expect(within(availableList()).queryByText('Alex')).not.toBeInTheDocument());
  });

  it('stops listening to the survey after unmount', () => {
    const survey = groupedSurvey([ranking('q1'), ranking('q2')]);
    const removeValueSpy = vi.spyOn(survey.onValueChanged, 'remove');
    const removeVisibilitySpy = vi.spyOn(survey.onQuestionVisibleChanged, 'remove');
    const { unmount } = renderQuestion(survey, 'q2');
    unmount();
    expect(removeValueSpy).toHaveBeenCalled();
    expect(removeVisibilitySpy).toHaveBeenCalled();
  });
});
