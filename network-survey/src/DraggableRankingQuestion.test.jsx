import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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

  it('preserves controlled value-prop updates', async () => {
    const question = createQuestion(['Alex']);
    const props = { question, onChange: vi.fn() };
    const { rerender } = render(
      <DraggableRankingQuestion {...props} value={['Alex']} />
    );

    await waitFor(() => expect(within(screen.getByTestId('drop-ranked')).getByText('Alex')).toBeInTheDocument());

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
