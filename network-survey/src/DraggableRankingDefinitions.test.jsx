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
    expect(info).not.toHaveAttribute('aria-controls');

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

  it('closes a focus-opened definition only after focus exits its trigger and callout', () => {
    render(<><Fixture /><button type="button">Outside ranking</button></>);
    const info = screen.getByRole('button', { name: 'Info: Beta' });
    const outside = screen.getByRole('button', { name: 'Outside ranking' });

    fireEvent.focus(info);
    const callout = screen.getByRole('region', { name: 'Definition: Beta' });
    const rank = screen.getByRole('button', { name: 'Rank: Beta' });
    const close = within(callout).getByRole('button', { name: 'Close definition' });
    fireEvent.blur(info, { relatedTarget: rank });
    fireEvent.focus(rank);
    expect(callout).toBeInTheDocument();
    fireEvent.blur(rank, { relatedTarget: close });
    fireEvent.focus(close);
    expect(callout).toBeInTheDocument();

    fireEvent.blur(close, { relatedTarget: outside });
    fireEvent.focus(outside);
    expect(screen.queryByRole('region', { name: 'Definition: Beta' })).not.toBeInTheDocument();
    expect(info).not.toHaveAttribute('aria-controls');
  });

  it('does not steal unrelated keyboard focus when Escape closes hover-only content', () => {
    render(<><input aria-label="Unrelated field" /><Fixture /></>);
    const input = screen.getByRole('textbox', { name: 'Unrelated field' });
    const info = screen.getByRole('button', { name: 'Info: Beta' });
    input.focus();
    expect(input).toHaveFocus();
    fireEvent.mouseEnter(info);
    expect(screen.getByRole('region', { name: 'Definition: Beta' })).toBeInTheDocument();
    expect(input).toHaveFocus();

    const escapeWasNotCancelled = fireEvent.keyDown(input, { key: 'Escape' });
    expect(escapeWasNotCancelled).toBe(true);
    expect(screen.queryByRole('region', { name: 'Definition: Beta' })).not.toBeInTheDocument();
    expect(input).toHaveFocus();
  });

  it('keeps focus and hover disclosure state independent for mixed-input users', () => {
    render(<Fixture />);
    const info = screen.getByRole('button', { name: 'Info: Beta' });

    fireEvent.mouseEnter(info);
    fireEvent.focus(info);
    expect(screen.getByRole('region', { name: 'Definition: Beta' })).toBeInTheDocument();
    fireEvent.mouseLeave(info, { relatedTarget: document.body });
    expect(screen.getByRole('region', { name: 'Definition: Beta' })).toBeInTheDocument();

    fireEvent.mouseEnter(info);
    fireEvent.blur(info, { relatedTarget: document.body });
    expect(screen.getByRole('region', { name: 'Definition: Beta' })).toBeInTheDocument();
    fireEvent.mouseLeave(info, { relatedTarget: document.body });
    expect(screen.queryByRole('region', { name: 'Definition: Beta' })).not.toBeInTheDocument();
  });

  it('treats controls in another ranking question as an outside interaction', () => {
    render(<><Fixture /><Fixture /></>);
    const betaInfos = screen.getAllByRole('button', { name: 'Info: Beta' });

    fireEvent.click(betaInfos[0]);
    expect(screen.getAllByRole('region', { name: 'Definition: Beta' })).toHaveLength(1);
    fireEvent.pointerDown(betaInfos[1]);
    fireEvent.click(betaInfos[1]);

    expect(screen.getAllByRole('region', { name: 'Definition: Beta' })).toHaveLength(1);
    expect(betaInfos[0]).toHaveAttribute('aria-expanded', 'false');
    expect(betaInfos[1]).toHaveAttribute('aria-expanded', 'true');
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

    const currentInfo = screen.getByRole('button', { name: 'Info: Beta' });
    const currentAction = screen.getByRole('button', { name: 'Unrank: Beta' });
    fireEvent.focus(currentInfo);
    expect(screen.getByRole('region', { name: 'Definition: Beta' })).toBeInTheDocument();
    fireEvent.blur(currentInfo, { relatedTarget: currentAction });
    fireEvent.focus(currentAction);
    fireEvent.keyDown(currentAction, { key: 'Escape' });
    expect(currentInfo).toHaveFocus();
    expect(screen.queryByRole('region', { name: 'Definition: Beta' })).not.toBeInTheDocument();
    expect(parentEvents.onKeyDown).not.toHaveBeenCalled();
  });

  it('gives rendered callouts unique ARIA targets and keeps DOM, visual, and focus action order coherent', async () => {
    render(<><Fixture /><Fixture /></>);
    const infos = screen.getAllByRole('button', { name: /Info:/ });
    expect(infos.every((button) => !button.hasAttribute('aria-controls'))).toBe(true);

    const ids = [];
    for (const info of infos) {
      fireEvent.focus(info);
      await waitFor(() => expect(info).toHaveAttribute('aria-controls'));
      ids.push(info.getAttribute('aria-controls'));
      fireEvent.blur(info, { relatedTarget: document.body });
    }
    expect(new Set(ids).size).toBe(ids.length);

    const alphaInfo = infos[0];
    fireEvent.focus(alphaInfo);
    const row = alphaInfo.parentElement;
    const rank = within(row).getByRole('button', { name: /Rank: A deliberately long Alpha/ });
    const close = within(row).getByRole('button', { name: 'Close definition' });
    expect(alphaInfo.compareDocumentPosition(rank) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(rank.compareDocumentPosition(close) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(document.getElementById(alphaInfo.getAttribute('aria-controls'))).toBeInTheDocument();
  });

  it('does not add Info controls or supplemental row layout for blank and definition-free choices', async () => {
    const definitionFreeQuestion = {
      choices: [
        { value: 'blank', text: 'Blank', definition: ' \n\t ' },
        { value: 'missing', text: 'Missing' },
      ],
      value: [],
      maxSelectedChoices: 0,
    };
    render(
      <DraggableRankingWithDefinitions
        question={definitionFreeQuestion}
        value={[]}
        onChange={vi.fn()}
      />
    );

    expect(screen.queryByRole('button', { name: /Info:/ })).not.toBeInTheDocument();
    const label = await screen.findByText('Blank');
    expect(label).toHaveStyle({ flex: '1 1 auto', textAlign: 'center' });
    expect(label).not.toHaveAttribute('aria-label');
    expect(within(label.parentElement).getByRole('button', { name: 'Rank: Blank' })).toBeInTheDocument();
  });
});
