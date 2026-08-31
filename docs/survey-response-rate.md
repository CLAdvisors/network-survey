# Survey response-rate contract

`GET /api/surveys` is authoritative for survey-level response rates and returns these numeric fields for every visible survey, identically for platform administrators and organization members:

- `eligibleRespondents`: current respondent rows where `can_respond IS TRUE`.
- `completedResponses`: those currently eligible rows where `response IS NOT NULL`.
- `responseRatePercent`: the nearest whole-number percentage, rounded half up with integer arithmetic; `null` when `eligibleRespondents` is zero.

The displayed form is `completed / eligible (percentage)`. A zero denominator is displayed as **No eligible respondents**, never as `0%`, `NaN`, or infinity.

## Historical and legacy behavior

Eligibility is evaluated at read time. If a completed respondent later becomes ineligible, that row is excluded from both numerator and denominator. If it becomes eligible again while retaining a response, it is included in both. A JSON response is complete whenever the database value is non-`NULL`, including an empty JSON object; only SQL `NULL` is incomplete.

The exact legacy placeholder (`name = 'None'`, `contact_info = 'N/A'`, `can_respond = false`) never contributes because it is ineligible. This rule does not alter the separate displayed-roster count, which continues to exclude only that exact placeholder and still includes genuine ineligible roster rows.

## Query and performance notes

Both authorization variants compute the two filtered counts in the existing grouped survey-list query. They issue no respondent-detail or per-survey requests, and the correlated latest-launch aggregate remains separate, so delivery rows cannot multiply respondent counts. The response-rate work is a constant number of filtered counters during the same respondent scan: for a 1,000-person roster it adds O(1) state and O(1,000) simple boolean/NULL checks, without increasing result cardinality or exposing respondent data.

Local verification covers a generated 1,000-row aggregate fixture and asserts one survey-list query per request. No external or staging load test is required or permitted for this change.
