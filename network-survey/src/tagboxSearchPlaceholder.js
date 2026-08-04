const placeholderObservers = new WeakMap();

function getSearchPlaceholder(question) {
  const configured = question?.placeholder;
  const defaultPlaceholder = question?.getDefaultPropertyValue?.('placeholder');

  if (configured && configured !== defaultPlaceholder) {
    return configured;
  }

  return question?.dropdownListModel?.listModel?.filterStringPlaceholder
    || configured
    || '';
}

export function restoreTagboxSearchPlaceholder(questionElement, question) {
  if (question?.getType?.() !== 'tagbox' || !questionElement) {
    return;
  }

  placeholderObservers.get(questionElement)?.disconnect();

  const applyPlaceholder = () => {
    const input = questionElement.querySelector('.sd-tagbox__filter-string-input');
    const placeholder = getSearchPlaceholder(question);
    if (input && placeholder && input.placeholder !== placeholder) {
      // SurveyJS clears the real input placeholder after each selection.
      // Keep the configured/localized search instruction on the actual
      // combobox rather than exposing it only through generated CSS content.
      input.placeholder = placeholder;
    }
  };

  applyPlaceholder();

  if (typeof MutationObserver === 'function') {
    const observer = new MutationObserver(applyPlaceholder);
    observer.observe(questionElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['placeholder'],
    });
    placeholderObservers.set(questionElement, observer);
  }

  if (typeof requestAnimationFrame === 'function') {
    requestAnimationFrame(applyPlaceholder);
  }
}
