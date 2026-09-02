import React from 'react';
import { extractChoiceDefinition } from './longValueSchema';

export const DEFINITION_VARIANTS = [
  { id: 'popover', label: 'Focus popover', summary: 'One transient explanation at a time.' },
  { id: 'inline', label: 'Expandable cards', summary: 'Keep several definitions open in context.' },
  { id: 'panel', label: 'Detail panel', summary: 'Scan labels while one reading region stays visible.' },
  { id: 'glossary', label: 'Glossary preview', summary: 'Study or search definitions in a separate preview.' },
];

const keyFor = (choice) => String(choice?.value ?? choice?.source?.value ?? choice?.key ?? '');
const labelFor = (choice) => String(choice?.label ?? choice?.text ?? choice?.source?.text ?? choice?.value ?? '');
const definitionFor = (choice) => choice?.definition ?? extractChoiceDefinition(choice?.source ?? choice);

function DefinitionText({ text }) {
  return <div className="lv-definition-text">{text}</div>;
}

function stopDefinitionEvent(event) {
  event.stopPropagation();
}

export function DefinitionExperience({ variant, choices, children }) {
  const availableChoices = React.useMemo(
    () => choices.filter((choice) => definitionFor(choice)),
    [choices]
  );
  const [openKeys, setOpenKeys] = React.useState(() => new Set());
  const [activeKey, setActiveKey] = React.useState(() => keyFor(availableChoices[0]));
  const [pinnedKey, setPinnedKey] = React.useState('');
  const [glossaryOpen, setGlossaryOpen] = React.useState(false);
  const [query, setQuery] = React.useState('');
  const instanceId = React.useId().replace(/:/g, '');
  const rootRef = React.useRef(null);
  const lastOpenerRef = React.useRef(null);
  const dialogCloseRef = React.useRef(null);
  const dialogRef = React.useRef(null);

  React.useEffect(() => {
    setOpenKeys(new Set());
    setPinnedKey('');
    setGlossaryOpen(false);
  }, [variant]);

  React.useEffect(() => {
    if (variant !== 'popover') return undefined;
    const outside = (event) => {
      if (!rootRef.current?.contains(event.target)) {
        setOpenKeys(new Set());
        setPinnedKey('');
      }
    };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [variant]);

  React.useEffect(() => {
    if (glossaryOpen) dialogCloseRef.current?.focus();
  }, [glossaryOpen]);

  const closeAll = React.useCallback((restoreFocus = true) => {
    setOpenKeys(new Set());
    setPinnedKey('');
    setGlossaryOpen(false);
    const opener = lastOpenerRef.current;
    if (restoreFocus && opener) requestAnimationFrame(() => opener.focus());
  }, []);

  const handleRootKeyDown = (event) => {
    if (event.key === 'Tab' && glossaryOpen && dialogRef.current) {
      const focusable = Array.from(dialogRef.current.querySelectorAll('button:not([disabled]), input:not([disabled]), [tabindex="0"]'));
      const first = focusable[0];
      const last = focusable.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
      return;
    }
    if (event.key !== 'Escape') return;
    if (!openKeys.size && !glossaryOpen) return;
    event.preventDefault();
    event.stopPropagation();
    closeAll();
  };

  const openTransient = (key) => {
    setActiveKey(key);
    setOpenKeys(new Set([key]));
  };

  const toggle = (choice) => {
    const key = keyFor(choice);
    setActiveKey(key);
    if (variant === 'inline') {
      setOpenKeys((current) => {
        const next = new Set(current);
        next.has(key) ? next.delete(key) : next.add(key);
        return next;
      });
      return;
    }
    if (variant === 'glossary') {
      setGlossaryOpen(true);
      return;
    }
    if (variant === 'panel') return;
    setOpenKeys((current) => current.has(key) && pinnedKey === key ? new Set() : new Set([key]));
    setPinnedKey((current) => current === key ? '' : key);
  };

  const renderControl = (choice) => {
    const key = keyFor(choice);
    const label = labelFor(choice);
    const definition = definitionFor(choice);
    if (!definition) return null;
    const expanded = variant === 'panel' ? activeKey === key : variant === 'glossary' ? glossaryOpen && activeKey === key : openKeys.has(key);
    const detailsId = variant === 'panel'
      ? `${instanceId}-lv-panel-details-mobile ${instanceId}-lv-panel-details-desktop`
      : `${instanceId}-lv-${variant}-${availableChoices.findIndex((candidate) => keyFor(candidate) === key)}-details`;
    const buttonLabel = variant === 'glossary' ? `Preview ${label} in glossary` : `Show definition for ${label}`;
    return (
      <React.Fragment key={`${variant}-${key}`}>
        <button
          type="button"
          className={`lv-definition-button${expanded ? ' is-active' : ''}`}
          aria-label={buttonLabel}
          aria-controls={detailsId}
          aria-expanded={variant === 'panel' ? undefined : expanded}
          aria-pressed={variant === 'panel' ? expanded : undefined}
          onPointerDown={stopDefinitionEvent}
          onMouseDown={stopDefinitionEvent}
          onTouchStart={stopDefinitionEvent}
          onDragStart={stopDefinitionEvent}
          onKeyDown={(event) => {
            event.stopPropagation();
            if (event.key === 'Escape' && (openKeys.size || glossaryOpen)) {
              event.preventDefault();
              closeAll();
            }
          }}
          onMouseEnter={(event) => {
            lastOpenerRef.current = event.currentTarget;
            setActiveKey(key);
            if (variant === 'popover') openTransient(key);
          }}
          onFocus={(event) => {
            lastOpenerRef.current = event.currentTarget;
            setActiveKey(key);
            if (variant === 'popover') openTransient(key);
          }}
          onBlur={(event) => {
            if (variant !== 'popover' || pinnedKey === key) return;
            if (event.relatedTarget?.closest?.(`[data-definition-cluster="${key}"]`)) return;
            setOpenKeys(new Set());
          }}
          onClick={(event) => {
            stopDefinitionEvent(event);
            lastOpenerRef.current = event.currentTarget;
            toggle(choice);
          }}
        >
          <span aria-hidden="true">i</span>
        </button>
        {(variant === 'popover' || variant === 'inline') && expanded && (
          <section
            id={detailsId}
            className={`lv-definition-callout lv-definition-callout--${variant}`}
            data-definition-cluster={key}
            aria-label={`Definition: ${label}`}
          >
            <strong>{label}</strong>
            <DefinitionText text={definition} />
            {variant === 'popover' && (
              <button type="button" className="lv-text-button" onClick={(event) => { stopDefinitionEvent(event); closeAll(); }}>
                Close definition
              </button>
            )}
          </section>
        )}
      </React.Fragment>
    );
  };

  const activeChoice = availableChoices.find((choice) => keyFor(choice) === activeKey) || availableChoices[0];
  const filteredChoices = availableChoices.filter((choice) => {
    const needle = query.trim().toLocaleLowerCase();
    return !needle || `${labelFor(choice)} ${definitionFor(choice)}`.toLocaleLowerCase().includes(needle);
  });

  return (
    <div ref={rootRef} className={`lv-experience lv-experience--${variant}`} onKeyDown={handleRootKeyDown}>
      <div className="lv-experience__task">
        {variant === 'panel' && activeChoice && (
          <aside id={`${instanceId}-lv-panel-details-mobile`} className="lv-detail-panel lv-detail-panel--mobile" aria-live="polite" aria-label="Selected value definition">
            <span className="lv-eyebrow">Currently previewing</span>
            <h3>{labelFor(activeChoice)}</h3>
            <DefinitionText text={definitionFor(activeChoice)} />
          </aside>
        )}
        {children({ renderControl, activeKey })}
      </div>
      {variant === 'panel' && activeChoice && (
        <aside id={`${instanceId}-lv-panel-details-desktop`} className="lv-detail-panel lv-detail-panel--desktop" aria-live="polite" aria-label="Selected value definition">
          <span className="lv-eyebrow">Currently previewing</span>
          <h3>{labelFor(activeChoice)}</h3>
          <DefinitionText text={definitionFor(activeChoice)} />
        </aside>
      )}
      {variant === 'glossary' && (
        <button
          type="button"
          className="lv-glossary-launch"
          aria-haspopup="dialog"
          aria-expanded={glossaryOpen}
          aria-controls={`${instanceId}-lv-glossary-dialog`}
          onClick={(event) => {
            lastOpenerRef.current = event.currentTarget;
            setGlossaryOpen(true);
          }}
        >
          Open searchable glossary ({availableChoices.length})
        </button>
      )}
      {variant === 'glossary' && glossaryOpen && (
        <div className="lv-dialog-backdrop" role="presentation" onPointerDown={(event) => { if (event.target === event.currentTarget) closeAll(); }}>
          <section id={`${instanceId}-lv-glossary-dialog`} ref={dialogRef} className="lv-dialog" role="dialog" aria-modal="true" aria-labelledby={`${instanceId}-lv-glossary-title`}>
            <header>
              <div>
                <span className="lv-eyebrow">Preview before deciding</span>
                <h2 id={`${instanceId}-lv-glossary-title`}>Value glossary</h2>
              </div>
              <button ref={dialogCloseRef} type="button" className="lv-dialog-close" aria-label="Close glossary" onClick={() => closeAll()}>×</button>
            </header>
            <label className="lv-glossary-search">
              <span>Search labels and definitions</span>
              <input value={query} onChange={(event) => setQuery(event.target.value)} type="search" />
            </label>
            <div className="lv-glossary-results" aria-live="polite">
              <span className="lv-result-count">{filteredChoices.length} definitions</span>
              {filteredChoices.map((choice) => (
                <article key={keyFor(choice)} id={`${instanceId}-lv-glossary-${availableChoices.indexOf(choice)}-details`} className={keyFor(choice) === activeKey ? 'is-target' : ''}>
                  <h3>{labelFor(choice)}</h3>
                  <DefinitionText text={definitionFor(choice)} />
                </article>
              ))}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
