# Draft Requirements Review

**Reviewed:** 2026-07-11  
**Source:** `/home/bennettgarcia/Downloads/DRAFT Requirements List.docx.txt`

This review compares the draft requirements with the current repository. No implementation changes were made as part of the review.

## Requirements status and feasibility

| Requirement | Current status | Feasibility / notes |
|---|---|---|
| Mobile-friendly respondent survey | Partially implemented | The respondent app uses responsive MUI containers and a mobile-specific header. However, the survey layout/CSS has very few mobile breakpoints, and question cards use large fixed padding. Test and adjust handset/tablet layouts, tagboxes, ranking questions, long text, keyboard behavior, and completion controls. **High priority; moderate effort.** |
| Admin-configurable required questions | Partially implemented | `isRequired` is persisted in SurveyJS question JSON and displayed in the Question Table. The Survey Editor can expose SurveyJS’s standard required setting for normal question types. However, People Tagbox questions are forced back to required in `dashboard/src/components/SurveyEditor.js`; the Question Table Required column is not editable; CSV import makes every question required. Complete this by removing the forced-required behavior and adding an editable table boolean or using the editor property panel consistently. |
| Editable survey instructions | Not implemented | Instructions are hard-coded in `network-survey/src/Survey.jsx`; no database field or API exists. Add an additive `Survey.instructions` field (or structured settings JSON), a dashboard editor control, an authorized update endpoint, and render it in the respondent app. |
| Editable invitation-email subject | Not implemented | The mail subject is hard-coded as `CLA Network Survey` in `api/server.js`. The existing notification editor supports only the email body by language. Add a localized subject alongside the body in `EMAIL`, or a survey-level subject if localization is not needed. |
| Copy a survey design | Not implemented | New surveys begin empty; no copy action/API exists. Create a new survey and transactionally deep-copy question JSON and relevant configuration (instructions and invitation content/subjects), but do not copy respondents, responses, send state, or tokens. |
| Link two surveys and combine results | Not implemented | Results, exports, and visualization currently operate on one survey only. Recommended design: create a parent study/report group with many surveys, preserve source-survey provenance, and add grouped results/export. Do not blindly merge raw answers: positional keys such as `question_1` can mean different things between surveys. **Most product/design-intensive request.** |
| Validate capacity / performance | Not implemented | There is no load/performance suite or documented capacity target. The API has an in-process email queue that batches 10 messages/second, but no durable queue, observability, retries, or load validation. Define service-level targets, seed representative staging data, run staged load tests, monitor API/DB/browser metrics, and publish an approved concurrency limit. |

## Nice-to-haves

| Requirement | Current status | Feasibility / notes |
|---|---|---|
| Export network edge list | Not implemented | Current Results export is respondent-by-question CSV only. Generate rows such as `source respondent`, `target selected person`, `relationship type/question key`, plus survey and timestamp. Prefer an API-generated CSV for larger datasets. |
| Accurate multi-select dropdown rendering in Survey Editor | Partially addressed; likely incomplete | The project configures tagboxes for lazy loading and limits and provides a preview dialog, but the editor canvas still relies on SurveyJS’s default rendering rather than a dedicated tagbox design-mode renderer. Reproduce with a saved survey, then add a creator/design-mode renderer or representative mock choices while retaining lazy loading in preview/respondent mode. |

## Mobile-specific findings

The respondent application is `network-survey/`.

- Foundations already present: MUI responsive container, `MobileView` header, and SurveyJS responsive baseline.
- Gaps: no focused handset/tablet breakpoint rules in `network-survey/src/Survey.jsx` or `network-survey/src/Survey.css`; fixed desktop-like padding/spacing; no automated mobile viewport tests.
- Performance: the respondent production bundle is approximately 486 KB gzip and produces Vite’s large-chunk warning. Consider code-splitting/deferred loading after functional mobile improvements.

## Scoped feature: email me a demo survey

### Goal

Let an authorized survey administrator send themselves a time-limited email link to experience the current survey as a respondent, without adding a respondent, sending to the survey population, or contaminating real results.

### Current state

- The Survey Editor has an in-dashboard **Demo Survey** preview, but it does not send an email or exercise the public respondent-link flow.
- `dashboard/src/components/SendDemoDialog.js` exists but is not wired into the dashboard.
- `POST /api/testEmail` is used for respondent reminders and intentionally rejects an arbitrary administrator email unless it already belongs to an active respondent. It must not be repurposed for this feature.

### In scope

1. Add an **Email me a demo** action for users with survey edit permission, available from the survey action menu (and optionally the Survey Editor).
2. Use the authenticated account's email address; do not accept an arbitrary recipient address. If the account has no verified email, explain this and direct the user to add/verify one.
3. Create a separate, cryptographically random, single-purpose demo session/token with its own survey ID, dashboard user ID, recipient email, creation time, expiry, and optional revoked/used timestamps.
4. Send the normal survey invitation presentation, marked as a demo, using the survey's configured invitation body/subject and a demo URL.
5. Permit the demo URL to load the live survey definition and respondent choice list and proceed through completion.
6. Keep demo answers separate from `Respondent.response`; exclude demo sessions and answers from Results, CSV exports, network graphs, respondent counts, reminder flows, and production email-send state.
7. Add expiry/revocation handling, authorization checks, rate limiting, audit events, success/error UI feedback, and automated tests.

### Technical approach

- Add an additive `survey_demo_sessions` table rather than creating a temporary `Respondent` row. A temporary respondent would leak into target lists, response counts, results, and email state.
- Generalize public respondent-link authorization enough to recognize a valid demo session while retaining the existing respondent-token validation and isolation guarantees.
- For demo sessions, load choices from the selected survey but exclude placeholder/non-responding entries as appropriate. On completion, either discard answers after the completion screen or store them only in `survey_demo_sessions.demo_response` for the administrator's private review; the initial release should discard them unless review is explicitly required.
- Add a dedicated `POST /api/surveys/:surveyId/demo-email` endpoint, limited to editor-capable users and the authenticated user's verified email. Return a generic success response and never expose the raw token in normal production responses.
- Reuse the invitation template renderer, but give demo emails an unambiguous subject/preamble such as `[Demo] …`; this avoids mistaking a test link for a live invitation.

### Acceptance criteria

- An editor can request a demo email for a survey they are authorized to edit and receives one at their own verified account email.
- A non-member, viewer, unauthorized cross-organization user, or arbitrary recipient cannot obtain a demo link.
- The link renders the survey and supports the same question types, lazy-loaded choices, validation, and completion experience as a respondent link.
- Demo completion never changes `Respondent`, survey results, exports, graph data, response status, sent-email status, or survey counts.
- Expired, revoked, malformed, or reused (if single-use is selected) links fail safely without revealing survey data.
- The action is auditable and protected against repeated sends.

### Decisions needed before implementation

- Token lifetime (recommended: 24 hours) and whether it is single-use or reusable until expiry.
- Whether demo answers should be discarded or retained privately for the administrator.
- Whether to send only to verified account emails, or introduce an explicit verified-email flow first for accounts lacking one.

### Effort and dependencies

**Moderate effort.** It requires an additive migration, public-link authorization changes, dashboard UX, email-template work, and integration/security tests. It is independent of survey copy/linking, but benefits from the proposed invitation-subject configuration.

## Recommended implementation order

1. Mobile audit/fixes and responsive viewport regression tests.
2. Complete the required-question toggle.
3. Add instructions and invitation-email subject configuration.
4. Implement **Email me a demo**.
5. Add edge-list export.
6. Add survey-copy workflow.
7. Define and execute a capacity/load-testing plan.
8. Build linked/grouped surveys after reporting semantics are agreed.

## Validation performed

- API tests: 30 passed.
- Dashboard tests: 4 passed, with existing React `act(...)` warnings.
- Respondent and dashboard production builds: passed.
- Both builds warn about oversized bundles; neither failed.
