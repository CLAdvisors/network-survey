import React from 'react';
import { createRoot } from 'react-dom/client';
import { DraggableRankingWithDefinitions } from './DraggableRankingDefinitions.jsx';

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
    // Respondent and custom dashboard preview already provide this wrapper.
    // Creator's built-in Preview tab does not, so add a question-local scope
    // there rather than leaking production CSS into Creator's designer.
    const hasRuntimeScope = content.closest?.('.cla-survey-runtime');
    if (hasRuntimeScope) {
      content.replaceChildren(host);
    } else {
      const runtimeScope = document.createElement('div');
      runtimeScope.className = 'cla-survey-runtime';
      runtimeScope.appendChild(host);
      content.replaceChildren(runtimeScope);
    }

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
  };
}
