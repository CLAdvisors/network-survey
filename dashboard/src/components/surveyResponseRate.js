const nonNegativeInteger = (value) => {
  const numeric = Number(value);
  return Number.isSafeInteger(numeric) && numeric >= 0 ? numeric : 0;
};

const percentValue = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const numeric = Number(value);
  return Number.isInteger(numeric) && numeric >= 0 && numeric <= 100 ? numeric : null;
};

export const responseRateSummary = (survey = {}) => {
  const eligibleCount = nonNegativeInteger(survey.eligibleRespondents ?? survey.eligible_respondent_count);
  const completedCount = Math.min(
    nonNegativeInteger(survey.completedResponses ?? survey.completed_response_count),
    eligibleCount,
  );
  const responseRatePercent = eligibleCount === 0
    ? null
    : percentValue(survey.responseRatePercent ?? survey.response_rate_percent);

  return { eligibleCount, completedCount, responseRatePercent };
};

export const responseRateLabel = (summary) => summary.eligibleCount === 0
  ? 'No eligible respondents'
  : `${summary.completedCount} / ${summary.eligibleCount} (${summary.responseRatePercent === null ? 'Rate unavailable' : `${summary.responseRatePercent}%`})`;

export const responseRateDescription = (summary) => summary.eligibleCount === 0
  ? 'Response rate unavailable because this survey has no eligible respondents.'
  : `${summary.completedCount} of ${summary.eligibleCount} eligible respondents completed the survey${summary.responseRatePercent === null ? '.' : ` (${summary.responseRatePercent}% response rate).`}`;
