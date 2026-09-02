import React from 'react';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { attachDraggableRankingRenderer } from '@network-survey/frontend-react';

vi.mock('react-beautiful-dnd', () => ({
  DragDropContext: ({ children }) => <div>{children}</div>,
  Droppable: ({ children, droppableId }) => children({
    innerRef: vi.fn(),
    droppableProps: { 'data-testid': `drop-${droppableId}` },
    placeholder: null,
  }, { isDraggingOver: false }),
  Draggable: ({ children }) => children({
    innerRef: vi.fn(),
    draggableProps: { style: {} },
    dragHandleProps: {},
  }, { isDragging: false }),
}));

function surveyEvent() {
  const handlers = new Set();
  return {
    add: (handler) => handlers.add(handler),
    remove: (handler) => handlers.delete(handler),
    emit: (options) => handlers.forEach((handler) => handler(null, options)),
    size: () => handlers.size,
  };
}

describe('attachDraggableRankingRenderer', () => {
  it('owns the production SurveyJS host/root lifecycle and preserves answer values', async () => {
    const onAfterRenderQuestion = surveyEvent();
    const survey = { onAfterRenderQuestion };
    const question = {
      name: 'priorities',
      title: 'Priorities',
      choices: [{ value: 'stable-value', text: 'Stable label', definition: 'Literal definition.' }],
      value: [],
      getType: () => 'draggableranking',
    };
    const surveyRoot = document.createElement('main');
    surveyRoot.className = 'sd-root-modern';
    const element = document.createElement('section');
    element.className = 'sd-question';
    element.innerHTML = '<div class="sd-question__content"><span>SurveyJS fallback</span></div>';
    surveyRoot.appendChild(element);
    document.body.appendChild(surveyRoot);

    const dispose = attachDraggableRankingRenderer(survey);
    expect(onAfterRenderQuestion.size()).toBe(1);
    onAfterRenderQuestion.emit({ question, htmlElement: element });

    const info = await screen.findByRole('button', { name: 'Info: Stable label' });
    expect(surveyRoot).toHaveClass('cla-survey-runtime');
    expect(element.querySelector('.sd-question__content > .draggable-ranking-host')).toBeInTheDocument();
    fireEvent.click(info);
    expect(screen.getByRole('region', { name: 'Definition: Stable label' })).toHaveTextContent('Literal definition.');
    expect(question.value).toEqual([]);

    dispose();
    expect(onAfterRenderQuestion.size()).toBe(0);
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Info: Stable label' })).not.toBeInTheDocument());
    expect(surveyRoot).not.toHaveClass('cla-survey-runtime');
    surveyRoot.remove();
  });

  it('reference-counts a shared Creator Preview runtime scope across renderers', () => {
    const firstEvent = surveyEvent();
    const secondEvent = surveyEvent();
    const surveyRoot = document.createElement('main');
    surveyRoot.className = 'sd-root-modern';
    const element = document.createElement('section');
    element.className = 'sd-question';
    element.innerHTML = '<div class="sd-question__content"></div>';
    surveyRoot.appendChild(element);
    document.body.appendChild(surveyRoot);
    const question = {
      name: 'shared',
      choices: [{ value: 'one', text: 'One', definition: 'Definition.' }],
      value: [],
      getType: () => 'draggableranking',
    };

    const disposeFirst = attachDraggableRankingRenderer({ onAfterRenderQuestion: firstEvent });
    const disposeSecond = attachDraggableRankingRenderer({ onAfterRenderQuestion: secondEvent });
    firstEvent.emit({ question, htmlElement: element });
    secondEvent.emit({ question, htmlElement: element });
    expect(surveyRoot).toHaveClass('cla-survey-runtime');

    disposeFirst();
    expect(surveyRoot).toHaveClass('cla-survey-runtime');
    disposeSecond();
    expect(surveyRoot).not.toHaveClass('cla-survey-runtime');
    surveyRoot.remove();
  });

  it('unmounts roots and document listeners when SurveyJS detaches a question host', async () => {
    const addListener = vi.spyOn(document, 'addEventListener');
    const removeListener = vi.spyOn(document, 'removeEventListener');
    const onAfterRenderQuestion = surveyEvent();
    const survey = { onAfterRenderQuestion };
    const question = {
      name: 'detached',
      choices: [{ value: 'one', text: 'One', definition: 'Definition one.' }],
      value: [],
      getType: () => 'draggableranking',
    };
    const element = document.createElement('section');
    element.className = 'sd-question';
    element.innerHTML = '<div class="sd-question__content"></div>';
    document.body.appendChild(element);
    const dispose = attachDraggableRankingRenderer(survey);

    onAfterRenderQuestion.emit({ question, htmlElement: element });
    const info = await screen.findByRole('button', { name: 'Info: One' });
    fireEvent.click(info);
    await screen.findByRole('region', { name: 'Definition: One' });
    const ownedListeners = addListener.mock.calls.filter(([type]) =>
      type === 'pointerdown' || type === 'keydown'
    );
    expect(ownedListeners).toHaveLength(2);

    element.remove();

    await waitFor(() => expect(screen.queryByRole('button', { name: 'Info: One' })).not.toBeInTheDocument());
    ownedListeners.forEach(([type, handler]) => {
      if (type === 'pointerdown') expect(removeListener).toHaveBeenCalledWith(type, handler, true);
      else expect(removeListener).toHaveBeenCalledWith(type, handler);
    });
    expect(onAfterRenderQuestion.size()).toBe(1);

    dispose();
    expect(onAfterRenderQuestion.size()).toBe(0);
    addListener.mockRestore();
    removeListener.mockRestore();
  });
});
