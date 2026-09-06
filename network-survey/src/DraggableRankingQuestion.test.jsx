import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { DraggableRankingQuestion } from '@network-survey/frontend-react';

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

    const selectButton = await screen.findByRole('button', { name: 'Select: Alex' });
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
