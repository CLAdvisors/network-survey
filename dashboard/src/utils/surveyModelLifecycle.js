/**
 * Releases hooks owned by one configured SurveyJS model and removes every
 * context reference to it. Survey Creator owns model disposal; this helper
 * only releases dashboard listeners and renderer roots.
 */
export function releaseSurveyModel(contextModels, hooksBySurvey, survey, cleanupSurvey) {
  if (!survey) return;
  hooksBySurvey.get(survey)?.cleanup?.();
  hooksBySurvey.delete(survey);
  cleanupSurvey?.(survey);
  contextModels.forEach((current, context) => {
    if (current === survey) contextModels.delete(context);
  });
}

/** Replaces (and first releases) the model previously owned by a UI context. */
export function replaceSurveyContextModel(
  contextModels,
  hooksBySurvey,
  context,
  survey,
  cleanupSurvey,
  { disposePrevious = false } = {}
) {
  const previous = contextModels.get(context);
  if (previous && previous !== survey) {
    releaseSurveyModel(contextModels, hooksBySurvey, previous, cleanupSurvey);
    if (disposePrevious && typeof previous.dispose === 'function') previous.dispose();
  }
  if (survey) contextModels.set(context, survey);
}
