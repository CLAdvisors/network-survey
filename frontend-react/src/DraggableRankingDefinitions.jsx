import React from 'react';
import DraggableRankingQuestion from './DraggableRankingQuestion.jsx';
import { getChoiceDefinition } from '@network-survey/frontend-shared';

const stopAnswerEvent = (event) => event.stopPropagation();

const choiceLabel = (item) => String(
  item?.text ?? item?.source?.text ?? item?.value ?? ''
);

const choiceDefinition = (item) => {
  const definition = getChoiceDefinition(item?.source ?? item);
  return definition.trim() ? definition : '';
};

function DefinitionText({ text }) {
  const paragraphs = String(text).split(/\n\s*\n/);
  return (
    <div className="cla-choice-definition__text">
      {paragraphs.map((paragraph, index) => <p key={index}>{paragraph}</p>)}
    </div>
  );
}

function DefinitionControl({ item, state, choiceAction }) {
  const key = item.key;
  const label = choiceLabel(item);
  const definition = choiceDefinition(item);
  const reactId = React.useId().replace(/:/g, '');
  const detailsId = `${reactId}-choice-definition`;
  const buttonRef = React.useRef(null);
  const actionRef = React.useRef(null);
  const calloutRef = React.useRef(null);
  const suppressNextFocusOpenRef = React.useRef(false);
  const expanded = state.openKey === key;

  const isWithinPopover = React.useCallback((node) => Boolean(
    node && typeof node.nodeType === 'number' &&
      (buttonRef.current?.contains(node) || calloutRef.current?.contains(node))
  ), []);
  const isWithinFocusPath = React.useCallback((node) => Boolean(
    isWithinPopover(node) || (node && actionRef.current?.contains(node))
  ), [isWithinPopover]);

  const close = React.useCallback((restoreFocus = false) => {
    state.close(key);
    if (restoreFocus && buttonRef.current && document.activeElement !== buttonRef.current) {
      suppressNextFocusOpenRef.current = true;
      buttonRef.current.focus();
    }
  }, [key, state]);

  React.useEffect(() => {
    if (!expanded) return undefined;
    const handlePointerDown = (event) => {
      if (!isWithinPopover(event.target)) close(false);
    };
    const handleKeyDown = (event) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      // Hover is progressive enhancement and may open while keyboard focus is
      // elsewhere. Never steal that unrelated focus when Escape dismisses it.
      close(isWithinFocusPath(document.activeElement));
    };
    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [close, expanded, isWithinFocusPath, isWithinPopover]);

  if (!definition) return null;

  const openTransient = () => state.openTransient(key);
  const closeTransientOnPointerExit = (event) => {
    if (!isWithinPopover(event.relatedTarget)) state.closeTransient(key);
  };
  const closeTransientOnFocusExit = (event) => {
    if (!isWithinFocusPath(event.relatedTarget)) state.closeTransient(key);
  };
  const handleControlKeyDown = (event) => {
    event.stopPropagation();
    if (event.key === 'Escape' && expanded) {
      event.preventDefault();
      close(true);
    }
  };

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className={`cla-choice-definition__button${expanded ? ' is-active' : ''}`}
        aria-label={`Info: ${label}`}
        aria-controls={expanded ? detailsId : undefined}
        aria-expanded={expanded}
        onPointerDown={stopAnswerEvent}
        onMouseDown={stopAnswerEvent}
        onTouchStart={stopAnswerEvent}
        onDragStart={stopAnswerEvent}
        onKeyDown={handleControlKeyDown}
        onMouseEnter={openTransient}
        onMouseLeave={closeTransientOnPointerExit}
        onFocus={() => {
          if (suppressNextFocusOpenRef.current) {
            suppressNextFocusOpenRef.current = false;
            return;
          }
          openTransient();
        }}
        onBlur={closeTransientOnFocusExit}
        onClick={(event) => {
          stopAnswerEvent(event);
          state.togglePinned(key);
        }}
      >
        Info
      </button>
      <span ref={actionRef} className="cla-choice-definition__action">
        {choiceAction}
      </span>
      {expanded && (
        <section
          ref={calloutRef}
          id={detailsId}
          className="cla-choice-definition__callout"
          aria-label={`Definition: ${label}`}
          onPointerDown={stopAnswerEvent}
          onMouseDown={stopAnswerEvent}
          onTouchStart={stopAnswerEvent}
          onDragStart={stopAnswerEvent}
          onKeyDown={handleControlKeyDown}
          onMouseEnter={openTransient}
          onMouseLeave={closeTransientOnPointerExit}
          onBlur={closeTransientOnFocusExit}
        >
          <strong>{label}</strong>
          <DefinitionText text={definition} />
          <button
            type="button"
            className="cla-choice-definition__close"
            onClick={(event) => {
              stopAnswerEvent(event);
              close(true);
            }}
          >
            Close definition
          </button>
        </section>
      )}
    </>
  );
}

// DraggableRankingQuestion uses this marker to place the Rank/Unrank action
// between the Info trigger and its callout. DOM, visual, and keyboard focus
// order therefore remain Info -> Rank/Unrank -> callout controls.
DefinitionControl.rendersChoiceAction = true;

/** Production Option 1: explicit Info-button definitions for draggable ranking. */
export function DraggableRankingWithDefinitions(props) {
  const [transientKey, setTransientKey] = React.useState('');
  const [pinnedKey, setPinnedKey] = React.useState('');
  const openKey = pinnedKey || transientKey;

  const definitionState = React.useMemo(() => ({
    openKey,
    openTransient(key) {
      if (!pinnedKey) setTransientKey(key);
    },
    closeTransient(key) {
      setTransientKey((current) => current === key ? '' : current);
    },
    togglePinned(key) {
      setTransientKey('');
      setPinnedKey((current) => current === key ? '' : key);
    },
    close(key) {
      setTransientKey((current) => current === key ? '' : current);
      setPinnedKey((current) => current === key ? '' : current);
    },
  }), [openKey, pinnedKey]);

  return (
    <DraggableRankingQuestion
      {...props}
      renderChoiceSupplement={(item) => choiceDefinition(item) ? (
        <DefinitionControl key={item.key} item={item} state={definitionState} />
      ) : null}
    />
  );
}
