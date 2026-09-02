import React from 'react';
import { createRoot } from 'react-dom/client';
import { DraggableRankingWithDefinitions } from './DraggableRankingDefinitions.jsx';

const creatorRuntimeScopes = new WeakMap();

function retainCreatorRuntimeScope(element) {
  const existing = creatorRuntimeScopes.get(element);
  if (existing) {
    existing.references += 1;
    return;
  }
  const owned = !element.classList.contains('cla-survey-runtime');
  if (owned) element.classList.add('cla-survey-runtime');
  creatorRuntimeScopes.set(element, { owned, references: 1 });
}

function releaseCreatorRuntimeScope(element) {
  const state = creatorRuntimeScopes.get(element);
  if (!state) return;
  state.references -= 1;
  if (state.references > 0) return;
  if (state.owned) element.classList.remove('cla-survey-runtime');
  creatorRuntimeScopes.delete(element);
}

/**
 * Attaches the production draggable-ranking renderer to a SurveyJS model.
 * The returned disposer removes the event handler and unmounts every root.
 */
export function attachDraggableRankingRenderer(survey, options = {}) {
  if (!survey?.onAfterRenderQuestion?.add) {
    throw new TypeError('A SurveyJS model with onAfterRenderQuestion is required.');
  }

  const {
    availableDirection = 'vertical',
    className = 'draggable-ranking-host',
  } = options;
  const roots = new Map();
  const retainedRuntimeScopes = new Set();

  const unmountQuestion = (question) => {
    const entry = roots.get(question);
    if (!entry) return;
    entry.root.unmount();
    roots.delete(question);
  };

  // SurveyJS can discard a rendered question host without emitting another
  // onAfterRenderQuestion event (notably while Creator swaps preview models).
  // Observe removals so independent React roots and their document listeners
  // cannot outlive the host that made them reachable.
  const detachedHostObserver = typeof MutationObserver === 'function' && document.documentElement
    ? new MutationObserver(() => {
      roots.forEach((entry, question) => {
        if (!entry.host.isConnected) unmountQuestion(question);
      });
    })
    : null;
  detachedHostObserver?.observe(document.documentElement, { childList: true, subtree: true });

  const renderQuestion = (_, renderOptions) => {
    const question = renderOptions?.question;
    if (!question || question.getType?.() !== 'draggableranking') return;

    const questionElement = renderOptions.htmlElement?.matches?.('.sd-question')
      ? renderOptions.htmlElement
      : renderOptions.htmlElement?.querySelector?.('.sd-question') || renderOptions.htmlElement;
    const content = questionElement?.querySelector?.('.sd-question__content') || questionElement;
    if (!content) return;

    unmountQuestion(question);
    const host = document.createElement('div');
    host.className = className;
    // Respondent and custom Demo already have an outer production scope. For
    // Creator Preview, scope the complete SurveyJS root rather than nesting a
    // padded runtime wrapper inside every ranking question.
    const surveyRoot = questionElement.closest?.('.sd-root-modern, .sv-root-modern');
    const nearestRuntimeScope = content.closest?.('.cla-survey-runtime');
    // Retain a scope already installed on this root by another renderer. Skip
    // only a distinct outer wrapper owned by respondent/custom Demo layout.
    if (surveyRoot && (!nearestRuntimeScope || nearestRuntimeScope === surveyRoot) &&
        !retainedRuntimeScopes.has(surveyRoot)) {
      retainCreatorRuntimeScope(surveyRoot);
      retainedRuntimeScopes.add(surveyRoot);
    }
    content.replaceChildren(host);

    if (!question.title && question.name) question.title = question.name;

    const root = createRoot(host);
    roots.set(question, { root, host });
    root.render(
      <DraggableRankingWithDefinitions
        question={question}
        value={question.value || []}
        onChange={(value) => { question.value = value; }}
        availableDirection={availableDirection}
        valueSource="question"
      />
    );
  };

  survey.onAfterRenderQuestion.add(renderQuestion);

  return () => {
    survey.onAfterRenderQuestion.remove(renderQuestion);
    detachedHostObserver?.disconnect();
    roots.forEach(({ root }) => root.unmount());
    roots.clear();
    retainedRuntimeScopes.forEach(releaseCreatorRuntimeScope);
    retainedRuntimeScopes.clear();
  };
}
