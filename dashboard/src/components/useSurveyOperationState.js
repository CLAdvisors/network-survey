import React from 'react';

// Module-level registries keep operation state intact even if an editor temporarily
// unmounts while the user visits a survey they cannot access.
const pending = new Set();
const generations = new Map();
const listeners = new Set();

const notify = () => listeners.forEach((listener) => listener());

export const surveyOperationGeneration = (section, surveyId) =>
  generations.get(surveyId ? `${section}:${surveyId}` : null) || 0;

export const advanceSurveyOperationGeneration = (section, surveyId) => {
  if (!surveyId) return 0;
  const key = `${section}:${surveyId}`;
  const next = (generations.get(key) || 0) + 1;
  generations.set(key, next);
  return next;
};

const useSurveyOperationState = (section, onOperationChange) => {
  const [, render] = React.useReducer((value) => value + 1, 0);

  React.useEffect(() => {
    listeners.add(render);
    return () => listeners.delete(render);
  }, []);

  const keyFor = React.useCallback(
    (surveyId) => surveyId ? `${section}:${surveyId}` : null,
    [section]
  );

  const begin = React.useCallback((surveyId) => {
    const key = keyFor(surveyId);
    if (!key || pending.has(key)) return false;
    pending.add(key);
    onOperationChange?.(surveyId, section, true);
    notify();
    return true;
  }, [keyFor, onOperationChange, section]);

  const end = React.useCallback((surveyId) => {
    const key = keyFor(surveyId);
    if (!key || !pending.delete(key)) return;
    onOperationChange?.(surveyId, section, false);
    notify();
  }, [keyFor, onOperationChange, section]);

  const isPending = React.useCallback(
    (surveyId) => pending.has(keyFor(surveyId)),
    [keyFor]
  );

  const generation = React.useCallback(
    (surveyId) => surveyOperationGeneration(section, surveyId),
    [section]
  );

  const advanceGeneration = React.useCallback((surveyId) => {
    return advanceSurveyOperationGeneration(section, surveyId);
  }, [section]);

  return { begin, end, isPending, generation, advanceGeneration };
};

export default useSurveyOperationState;
