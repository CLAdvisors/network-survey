const placeholderObservers = new WeakMap();

function getSearchPlaceholder(question) {
  // SurveyJS localizes this specifically as a search instruction (for
  // example, “Type to search…”). The question placeholder is usually a
  // longer empty-control prompt and does not fit beneath selected tags.
  return question?.dropdownListModel?.listModel?.filterStringPlaceholder
    || question?.placeholder
    || '';
}

export function disposeTagboxSearchPlaceholder(question) {
  const state = placeholderObservers.get(question);
  if (!state) return;
  state.observer?.disconnect();
  if (state.animationFrame !== null && typeof cancelAnimationFrame === 'function') {
    cancelAnimationFrame(state.animationFrame);
  }
  placeholderObservers.delete(question);
}

export function restoreTagboxSearchPlaceholder(questionElement, question) {
  if (question?.getType?.() !== 'tagbox' || !questionElement) {
    return () => {};
  }

  disposeTagboxSearchPlaceholder(question);

  const applyPlaceholder = () => {
    const input = questionElement.querySelector('.sd-tagbox__filter-string-input');
    const placeholder = getSearchPlaceholder(question);
    if (input && placeholder && input.placeholder !== placeholder) {
      // SurveyJS clears the real input placeholder after each selection.
      // Keep the localized search instruction on the actual combobox rather
      // than exposing it only through generated CSS content.
      input.placeholder = placeholder;
    }
  };

  applyPlaceholder();

  const state = { observer: null, animationFrame: null };
  if (typeof MutationObserver === 'function') {
    state.observer = new MutationObserver(applyPlaceholder);
    state.observer.observe(questionElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['placeholder'],
    });
  }

  if (typeof requestAnimationFrame === 'function') {
    state.animationFrame = requestAnimationFrame(applyPlaceholder);
  }
  placeholderObservers.set(question, state);

  return () => disposeTagboxSearchPlaceholder(question);
}
