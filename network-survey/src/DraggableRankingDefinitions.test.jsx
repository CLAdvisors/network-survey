import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DraggableRankingWithDefinitions } from '@network-survey/frontend-react';

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

const choices = [
  {
    value: 'stable-alpha',
    text: 'A deliberately long Alpha choice label that must wrap',
    definition: 'First paragraph.\n\n<img src=x onerror="alert(1)">\nLongUnbrokenToken_ABCDEFGHIJKLMNOPQRSTUVWXYZ_0123456789',
  },
  { value: 'stable-beta', text: 'Beta', definition: 'Beta literal definition.' },
];

const question = () => ({ choices, value: [], maxSelectedChoices: 0 });

function Fixture({ onChange = vi.fn(), parentEvents = {} }) {
  return (
    <div {...parentEvents}>
      <DraggableRankingWithDefinitions question={question()} value={[]} onChange={onChange} />
    </div>
  );
}

describe('production draggable-ranking Info definitions', () => {
  it('opens the same literal, paragraph-preserving content by hover, focus, click, and tap activation', () => {
    const { container } = render(<Fixture />);
    const info = screen.getByRole('button', { name: /Info: A deliberately long Alpha/ });

    fireEvent.mouseEnter(info);
    let details = screen.getByRole('region', { name: /Definition: A deliberately long Alpha/ });
    expect(details.querySelectorAll('p')).toHaveLength(2);
    expect(details).toHaveTextContent('<img src=x onerror="alert(1)">');
    expect(container.querySelector('img')).toBeNull();
    fireEvent.mouseLeave(info);
    expect(screen.queryByRole('region', { name: /Definition: A deliberately long Alpha/ })).not.toBeInTheDocument();

    fireEvent.focus(info);
    details = screen.getByRole('region', { name: /Definition: A deliberately long Alpha/ });
    expect(info).toHaveAttribute('aria-controls', details.id);
    expect(info).toHaveAttribute('aria-expanded', 'true');
    fireEvent.keyDown(info, { key: 'Escape' });
    expect(info).toHaveFocus();
    expect(screen.queryByRole('region', { name: /Definition: A deliberately long Alpha/ })).not.toBeInTheDocument();

    fireEvent.touchStart(info);
    fireEvent.click(info);
    expect(screen.getByRole('region', { name: /Definition: A deliberately long Alpha/ })).toHaveTextContent('First paragraph.');
  });

  it('uses explicit-button-only hover and closes at the actual control boundary', () => {
    render(<><Fixture /><button type="button">Outside ranking</button></>);
    const betaInfo = screen.getByRole('button', { name: 'Info: Beta' });
    const betaRow = betaInfo.parentElement;

    fireEvent.mouseEnter(betaRow);
    expect(screen.queryByRole('region', { name: 'Definition: Beta' })).not.toBeInTheDocument();

    fireEvent.click(betaInfo);
    expect(screen.getByRole('region', { name: 'Definition: Beta' })).toBeInTheDocument();
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Rank: Beta' }));
    expect(screen.queryByRole('region', { name: 'Definition: Beta' })).not.toBeInTheDocument();

    fireEvent.click(betaInfo);
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Outside ranking' }));
    expect(screen.queryByRole('region', { name: 'Definition: Beta' })).not.toBeInTheDocument();
  });

  it('does not leak definition interactions into answer, selection, keyboard, or drag ancestors', () => {
    const onChange = vi.fn();
    const parentEvents = {
      onClick: vi.fn(),
      onPointerDown: vi.fn(),
      onTouchStart: vi.fn(),
      onKeyDown: vi.fn(),
      onDragStart: vi.fn(),
    };
    render(<Fixture onChange={onChange} parentEvents={parentEvents} />);
    const info = screen.getByRole('button', { name: 'Info: Beta' });

    fireEvent.pointerDown(info);
    fireEvent.mouseDown(info);
    fireEvent.touchStart(info);
    fireEvent.dragStart(info);
    fireEvent.keyDown(info, { key: 'Enter' });
    fireEvent.click(info);

    expect(onChange).not.toHaveBeenCalled();
    Object.values(parentEvents).forEach((handler) => expect(handler).not.toHaveBeenCalled());

    fireEvent.click(screen.getByRole('button', { name: 'Rank: Beta' }));
    expect(onChange).toHaveBeenCalledWith(['stable-beta']);
  });

  it('gives every question/choice relationship a unique ARIA target and keeps Info and Rank in the action row', async () => {
    render(<><Fixture /><Fixture /></>);
    const infos = screen.getAllByRole('button', { name: /Info:/ });
    const ids = infos.map((button) => button.getAttribute('aria-controls'));
    expect(new Set(ids).size).toBe(ids.length);

    const alphaInfo = infos[0];
    const row = alphaInfo.parentElement;
    expect(within(row).getByRole('button', { name: /Rank: A deliberately long Alpha/ })).toBeInTheDocument();
    expect(alphaInfo).toHaveTextContent('Info');

    fireEvent.focus(alphaInfo);
    await waitFor(() => expect(document.getElementById(alphaInfo.getAttribute('aria-controls'))).toBeInTheDocument());
  });
});
