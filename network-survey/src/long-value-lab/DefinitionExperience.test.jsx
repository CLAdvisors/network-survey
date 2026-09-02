import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DefinitionExperience } from './DefinitionExperience';

const choices = [
  {
    value: 'stable-alpha',
    label: 'Alpha <literal>',
    definition: 'First paragraph.\n\n<img src=x onerror="alert(1)">\nLongUnbrokenSyntheticToken_ABCDEFGHIJKLMNOPQRSTUVWXYZ_0123456789',
  },
  { value: 'stable-beta', label: 'Beta', definition: 'A short second definition.' },
];

function Fixture({ variant = 'popover', parentEvents = {}, popoverHoverTarget = 'button' }) {
  return (
    <DefinitionExperience variant={variant} choices={choices} popoverHoverTarget={popoverHoverTarget}>
      {({ renderControl, getItemProps }) => (
        <div data-testid="answer-control" {...parentEvents}>
          {choices.map((choice) => <div key={choice.value} {...getItemProps(choice)}>{choice.label}{renderControl(choice)}</div>)}
        </div>
      )}
    </DefinitionExperience>
  );
}

describe('DefinitionExperience', () => {
  it('renders literal multiline content through focus with connected ARIA', () => {
    const { container } = render(<Fixture />);
    const button = screen.getByRole('button', { name: 'Show definition for Alpha <literal>' });
    fireEvent.focus(button);

    const details = screen.getByRole('region', { name: 'Definition: Alpha <literal>' });
    expect(button).toHaveAttribute('aria-expanded', 'true');
    expect(button).toHaveAttribute('aria-controls', details.id);
    expect(details).toHaveTextContent('<img src=x onerror="alert(1)">');
    expect(container.querySelector('img')).toBeNull();
    expect(details.querySelector('.lv-definition-text')).toHaveClass('lv-definition-text');
  });

  it('compares explicit-button and whole-row hover targets', () => {
    const buttonView = render(<Fixture popoverHoverTarget="button" />);
    fireEvent.mouseEnter(screen.getByText('Beta').closest('div'));
    expect(screen.queryByRole('region', { name: 'Definition: Beta' })).not.toBeInTheDocument();
    buttonView.unmount();

    render(<Fixture popoverHoverTarget="row" />);
    const row = screen.getByText('Beta').closest('div');
    fireEvent.mouseEnter(row);
    expect(screen.getByRole('region', { name: 'Definition: Beta' })).toBeInTheDocument();
    fireEvent.mouseLeave(row);
    expect(screen.queryByRole('region', { name: 'Definition: Beta' })).not.toBeInTheDocument();
  });

  it('supports hover, click pinning, Escape, and outside close', () => {
    render(<><Fixture /><button type="button">Outside</button></>);
    const button = screen.getByRole('button', { name: 'Show definition for Beta' });

    fireEvent.mouseEnter(button);
    expect(screen.getByRole('region', { name: 'Definition: Beta' })).toBeInTheDocument();
    fireEvent.click(button);
    expect(button).toHaveAttribute('aria-expanded', 'true');
    fireEvent.keyDown(button, { key: 'Escape' });
    expect(screen.queryByRole('region', { name: 'Definition: Beta' })).not.toBeInTheDocument();

    fireEvent.click(button);
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Outside' }));
    expect(screen.queryByRole('region', { name: 'Definition: Beta' })).not.toBeInTheDocument();
  });

  it('isolates tap/click, pointer, and keyboard events from answer and drag ancestors', () => {
    const onClick = vi.fn();
    const onPointerDown = vi.fn();
    const onTouchStart = vi.fn();
    const onKeyDown = vi.fn();
    render(<Fixture parentEvents={{ onClick, onPointerDown, onTouchStart, onKeyDown }} />);
    const button = screen.getByRole('button', { name: 'Show definition for Beta' });

    fireEvent.pointerDown(button);
    fireEvent.touchStart(button);
    fireEvent.keyDown(button, { key: 'Enter' });
    fireEvent.click(button);
    expect(onPointerDown).not.toHaveBeenCalled();
    expect(onTouchStart).not.toHaveBeenCalled();
    expect(onKeyDown).not.toHaveBeenCalled();
    expect(onClick).not.toHaveBeenCalled();
    expect(button).toHaveAttribute('aria-expanded', 'true');
  });

  it('allows multiple inline cards to remain expanded', () => {
    render(<Fixture variant="inline" />);
    const buttons = screen.getAllByRole('button', { name: /Show definition/ });
    fireEvent.click(buttons[0]);
    fireEvent.click(buttons[1]);
    expect(screen.getAllByRole('region', { name: /Definition:/ })).toHaveLength(2);
    expect(buttons[0]).toHaveAttribute('aria-expanded', 'true');
    expect(buttons[1]).toHaveAttribute('aria-expanded', 'true');
  });

  it('synchronizes the persistent panel without an expanded-state claim', () => {
    render(<Fixture variant="panel" />);
    const panels = screen.getAllByRole('complementary', { name: 'Selected value definition' });
    panels.forEach((panel) => expect(panel).toHaveTextContent('Alpha <literal>'));
    const beta = screen.getByRole('button', { name: 'Show definition for Beta' });
    fireEvent.focus(beta);
    panels.forEach((panel) => expect(panel).toHaveTextContent('A short second definition.'));
    expect(beta).toHaveAttribute('aria-pressed', 'true');
    expect(beta).not.toHaveAttribute('aria-expanded');
    panels.forEach((panel) => expect(beta.getAttribute('aria-controls')).toContain(panel.id));
  });

  it('uses instance-scoped IDs when two SurveyJS questions render together', () => {
    render(<><Fixture variant="panel" /><Fixture variant="panel" /></>);
    const ids = screen.getAllByRole('complementary', { name: 'Selected value definition' }).map((panel) => panel.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('opens a searchable glossary by click, filters safely, traps edge focus, and closes with Escape', async () => {
    render(<Fixture variant="glossary" />);
    const beta = screen.getByRole('button', { name: 'Preview Beta in glossary' });
    fireEvent.click(beta);
    const dialog = screen.getByRole('dialog', { name: 'Value glossary' });
    expect(dialog).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Close glossary' })).toHaveFocus();

    fireEvent.change(within(dialog).getByRole('searchbox'), { target: { value: 'second' } });
    expect(within(dialog).getByText('Beta')).toBeInTheDocument();
    expect(within(dialog).queryByText('Alpha <literal>')).not.toBeInTheDocument();

    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await waitFor(() => expect(beta).toHaveFocus());

    const launcher = screen.getByRole('button', { name: 'Open searchable glossary (2)' });
    fireEvent.click(launcher);
    fireEvent.click(screen.getByRole('button', { name: 'Close glossary' }));
    await waitFor(() => expect(launcher).toHaveFocus());
  });
});
