# Product IAM Org Authorization Implementation Plan

## PR 1 implementation status

Implemented on branch `product-iam-org-auth-pr1`:

- Added central org/survey authorization helpers in `api/server.js` using `Survey.id`/`organization_id` plus organization membership roles.
- Scoped dashboard/admin survey reads and mutations through `resolveSurveyForUser`; unauthorized guessed `surveyName` resolves as 404.
- Scoped `/api/surveys` to accessible organizations and includes role/org metadata for dashboard compatibility.
- Survey creation now attaches `organization_id` and `created_by_user_id`; single editor+ membership defaults, multiple memberships require `organizationId`, no membership gets 403, and platform admins must specify an org.
- Added additive Liquibase migration `v1_3_survey_archive.sql` for `Survey.archived_at` and `archived_by_user_id`; frontend-compatible `DELETE /api/survey/:surveyName` now archives rather than hard-deleting related data.
- Fixed start-survey `email_sent` update to scope status changes by survey name after central survey resolution.
- Preserved respondent public token endpoints without dashboard session requirements, kept public `demo` rejection, and now reject archived surveys during respondent token validation.
- Added API tests for role matrix, cross-org guessed-name denial, platform admin bypass, survey-create org default behavior, archive migration/static safety, and respondent regressions.
- Added minimal dashboard compatibility: memberships in auth context, role helpers, multi-org create org picker, basic 403 event emission, and obvious edit/archive controls hidden for lower roles.

Validation performed for this PR:

- `node --check api/server.js`
- `npm --prefix api test`
- `npm --prefix dashboard run build` (compiled with pre-existing warnings)
- `cd db && liquibase --url=offline:postgresql --changelog-file=changelogs/master-changelog.xml validate`
- `cd db && liquibase --url=offline:postgresql --changelog-file=changelogs/master-changelog.xml updateSQL`

Not performed: prod/staging migrations, deploys, Terraform, or local DB mutation.


## Current state after Phase 1 + Phase 2

Phase 1 and Phase 2 landed important foundations, but dashboard authorization is still mostly global:

- `api/server.js` now requires auth on dashboard/admin endpoints, blocks disabled users, gates public signup via `ALLOW_PUBLIC_SIGNUP`, regenerates login sessions, and validates respondent `userId + surveyName` on respondent routes.
- `db/changelogs/v1_2_product_iam_foundation.sql` adds `organizations`, `organization_memberships`, user account fields, `Survey.id`, `Survey.organization_id`, `Survey.created_by_user_id`, `Respondent.survey_id`, and `EMAIL.survey_id`, then backfills all existing data into `default-imported` and makes all existing users `owner` members.
- The application still queries almost everything by global `Survey.name` / `Respondent.survey_name` / `EMAIL.survey_name`.
- `/api/surveys` still returns every survey to any authenticated active user.
- Authenticated dashboard endpoints still do not check whether the current user belongs to the survey's organization or has an appropriate role.
- Dashboard components assume `survey.name` is the identifier and have no role-aware UI or 403 handling.
- Respondent app still uses legacy links: `?surveyName=...&userId=...`. This is acceptable for compatibility, but it must remain isolated from dashboard/org authorization and must keep token+survey matching.

## Recommendation: split into two fast PRs, not one mega-PR

Move quickly, but split at the highest-risk boundary:

1. **PR 1: org-scoped survey authorization and dashboard compatibility.**
   - Server-side role policy, central helpers, `/api/surveys` scoping, survey create ownership, all dashboard endpoints authorizing through one helper, minimal dashboard 403 handling/role hiding, and cross-org tests.
   - This is the security-critical coherent unit. Do not split endpoint-by-endpoint because partial helper usage invites bypasses.
2. **PR 2: account/member management.**
   - List org members, update role/status, optional create/invite placeholder, settings UI.
   - This can follow immediately after PR 1. It uses the PR 1 helpers and is less likely to lock users out of existing survey flows.
3. **Optional PR 3: respondent link modernization / token hardening.**
   - Move to `surveyId + token`, hashed tokens, expiry/revocation. Do not mix with PR 1 unless required; respondent compatibility bugs would slow the dashboard IAM push.

A single PR is manageable only if member management is kept API-only/minimal and all route authorization tests are completed. Otherwise prefer PRs 1 and 2.

## Role policy for PR 1

Use organization membership as the source of truth. No per-survey memberships yet.

| Role | Surveys list | View metadata/status | View targets/results/PII | Create/edit questions/templates/targets | Send emails | Delete survey | Manage members |
| --- | --- | --- | --- | --- | --- | --- | --- |
| owner | yes | yes | yes | yes | yes | yes | yes |
| admin | yes | yes | yes | yes | yes | yes | yes |
| editor | yes | yes | yes | yes | yes | no | no |
| analyst | yes | yes | yes | no | no | no | no |
| viewer | yes | yes, including question text | no | no | no | no | no |
| platform admin | all | all | all | all | all | all | all |

Near-term product decisions:

- Allow `viewer` to see survey metadata/status and question text.
- Require `analyst+` for `/api/results`, `/api/targets`, `/api/admin/names`, notifications reads, and respondent contact info/PII.
- Require `editor+` for updates, imports, sending, and test email.
- Require `admin+` for archive/delete-style survey lifecycle changes and member management.
- Replace survey hard delete with archive/soft-delete.
- Return **404 for unauthorized survey lookup** where possible to reduce survey-name enumeration; use 403 for known authenticated forbidden actions such as member role changes.

## Server implementation details

### New authorization helpers in `api/server.js`

Keep the first implementation in `api/server.js` to minimize refactor risk, but structure it so it can move to route modules later.

Add constants:

```js
const ROLE_RANK = { viewer: 10, analyst: 20, editor: 30, admin: 40, owner: 50 };
const READ_SURVEY_ROLES = ['owner', 'admin', 'editor', 'analyst', 'viewer'];
const ANALYST_ROLES = ['owner', 'admin', 'editor', 'analyst'];
const EDITOR_ROLES = ['owner', 'admin', 'editor'];
const ADMIN_ROLES = ['owner', 'admin'];
```

Add helpers:

- `hasAnyRole(role, allowedRoles)`
- `isPlatformAdmin(req.user)`
- `async getDefaultOrganizationForUser(userId)`
  - For create when frontend does not pass `organizationId`.
  - If exactly one membership, use it.
  - If many memberships and no `organizationId`, return `400` requiring selection.
  - If none and not platform admin, return `403` to prevent orphan survey creation.
- `async requireOrgAccess(req, res, organizationId, allowedRoles)`
  - Platform admin bypass.
  - Query `organization_memberships WHERE organization_id=$1 AND user_id=$2`.
- `async resolveSurveyForUser(req, res, { surveyName, surveyId, allowedRoles })`
  - Require at least one identifier.
  - Prefer `Survey.id` if provided; keep `Survey.name` for dashboard compatibility.
  - Query `Survey` plus membership in one statement:
    ```sql
    SELECT s.id, s.name, s.title, s.creation_date, s.questions,
           s.organization_id, s.created_by_user_id,
           om.role
    FROM Survey s
    LEFT JOIN organization_memberships om
      ON om.organization_id = s.organization_id AND om.user_id = $USER
    WHERE s.id = $ID_OR s.name = $NAME
    LIMIT 1
    ```
  - If platform admin, allow even if `om.role` is null.
  - If no row or no allowed role, return generic `404` for survey-scoped endpoints.
  - Attach/return the survey; all subsequent queries must use the resolved `survey.id` when available and `survey.name` for legacy columns.
- `async listAccessibleSurveys(req.user)`
  - Platform admins: all surveys.
  - Others: surveys joined through `organization_memberships`.

Add tests for helpers directly where practical. Export helpers only if needed by tests.

### Query pattern during compatibility window

Use stable IDs for auth and new writes, but keep legacy names populated:

- For `Survey`: read/return `id`, `organization_id`, `created_by_user_id`, `name`.
- For `Respondent`: write both `survey_id` and `survey_name`; query by `survey_id` after resolving survey, with fallback to `survey_name` only for rows not yet backfilled:
  ```sql
  WHERE (survey_id = $1 OR (survey_id IS NULL AND survey_name = $2))
  ```
- For `EMAIL`: same compatibility pattern.
- Do **not** remove old columns, constraints, or legacy URLs in this push.

## Endpoint-by-endpoint PR 1 changes

### Account/session

- `POST /api/register`
  - Keep current signup gate.
  - If public signup is enabled, new users should not automatically receive access to existing orgs. Consider returning success but no memberships.
- `POST /api/login`, `POST /api/logout`, `GET /api/check-auth`
  - Keep current behavior.
  - `check-auth` should return `{ user, memberships }`; dashboard should store memberships.
  - Ensure `requireAuth` loads `isPlatformAdmin` and status.

### Survey creation

- `POST /api/survey`
  - Require org role `owner/admin/editor`.
  - Request body: `{ surveyName, organizationId? }`.
  - Resolve organization:
    - If `organizationId` provided, require editor+ membership.
    - Else use single membership default.
    - For platform admin with no org, require explicit `organizationId` or use `default-imported` only if intentional.
  - Insert:
    ```sql
    INSERT INTO Survey (name, title, creation_date, organization_id, created_by_user_id)
    VALUES ($1, $2, NOW(), $3, $4)
    RETURNING id, name, organization_id
    ```
  - Insert placeholder respondent with both `survey_id` and `survey_name`.
  - Return `survey: { id, name, organizationId }`.
  - Risk: global `Survey.name` primary key remains; two orgs cannot use the same survey name yet. Return clear `409` on duplicate name.

### Survey list

- `GET /api/surveys`
  - Replace global query with membership-scoped query.
  - Return role and organization metadata:
    ```json
    { "surveys": [{ "id", "name", "organizationId", "organizationName", "role", "respondents", "questions", "date" }] }
    ```
  - Count respondents with `Respondent.survey_id = s.id OR legacy fallback`.
  - Do not subtract the placeholder below zero; current `number_of_respondents - 1` can produce incorrect strings.

### Dashboard read endpoints

All must call `resolveSurveyForUser` before querying:

- `GET /api/surveyStatus?surveyName=`
  - Allowed: viewer+.
  - Query by resolved survey.
- `GET /api/listQuestions?surveyName=`
  - Allowed: viewer+ because viewers may see question text.
- `GET /api/admin/questions?surveyName=`
  - Allowed: viewer+ if used only for read-only question preview/display. Mutating editor UI controls must still be hidden/disabled client-side and rejected server-side for viewer/analyst roles.
- `GET /api/results?surveyName=`
  - Allowed: analyst+.
  - Query by resolved `survey_id`; return 404/403 on no access, never empty global-looking data silently.
- `GET /api/targets?surveyName=`
  - Allowed: analyst+ because it returns PII.
- `GET /api/admin/names?surveyName=`
  - Allowed: analyst+; returns PII.
- `GET /api/survey-notifications/:surveyId`
  - Despite param name, currently expects survey name. For compatibility accept either UUID or name:
    - If UUID-shaped, resolve by `Survey.id`.
    - Else resolve by `Survey.name`.
  - Allowed: analyst+.

### Dashboard mutation endpoints

All must resolve survey first with editor+ unless noted:

- `POST /api/updateQuestions`
  - Allowed: editor+.
  - Update `Survey WHERE id=$resolvedId`.
- `POST /api/updateEmails`
  - Allowed: editor+.
  - Upsert `EMAIL (survey_id, survey_name, lang, text)`.
  - Current CSV splitting is naive; do not broaden scope, but validate no missing language/text.
- `POST /api/updateTarget` and `POST /api/updateTargets`
  - Allowed: editor+.
  - `insertUsers` should accept `{ surveyId, surveyName }` and write both identifiers.
  - Delete row should include both survey id/name predicate.
- `POST /api/testEmail`
  - Allowed: editor+.
  - Important: currently sends `userId=demo`, but respondent routes now reject demo for arbitrary surveys. Either:
    - create a dashboard-only preview endpoint for demo links, or
    - keep sending email content but clarify demo link may not load, or
    - generate a real disabled/test respondent token. Recommended for PR 1: do not claim demo respondent links are valid; add an open question/product follow-up.
- `POST /api/startSurvey`
  - Allowed: editor+.
  - `startSurvey` should accept resolved survey and select respondents by `survey_id`.
  - Fix email status update to include survey predicate: current `UPDATE Respondent SET email_sent=true WHERE contact_info = ANY($1)` can mark matching emails in other orgs.
- `DELETE /api/question`
  - Allowed: editor+.
  - Resolve survey first, update by `Survey.id`.
- `DELETE /api/user`
  - Allowed: editor+.
  - Delete by respondent name plus resolved `survey_id`/legacy fallback.
- Replace `DELETE /api/survey/:surveyName` hard delete behavior with archive/soft-delete behavior.
  - Allowed: owner/admin only.
  - Add an additive archive column before use, e.g. `Survey.archived_at TIMESTAMP` and optionally `Survey.archived_by_user_id INT REFERENCES users(id)`.
  - Endpoint can remain `DELETE /api/survey/:surveyName` for frontend compatibility, but it should update `Survey.archived_at = CURRENT_TIMESTAMP, archived_by_user_id = req.user.id` instead of deleting `EMAIL`, `Respondent`, or `Survey` rows.
  - `/api/surveys` and normal dashboard endpoints should exclude archived surveys by default.
  - Consider a later admin-only restore/purge flow.

### Respondent endpoints

Keep respondent flow public-token scoped, not org-membership scoped:

- `validateRespondentToken(surveyName, userId)` should additionally select/return `survey_id` and join/verify `Survey.id` if needed.
- Keep accepting legacy `surveyName + userId`.
- Do not require dashboard session on `/api/questions`, `/api/names`, `/api/user/status`, `/api/user`.
- Maintain the current rejection of `demo` on public respondent endpoints. Dashboard preview/demo should not weaken this.
- Continue to avoid returning data unless token matches the survey and `can_respond=true`.

## PR 2 member/account management

### API endpoints

Add org-scoped member endpoints under `/api/orgs/:organizationId/...`:

- `GET /api/orgs/:organizationId/members`
  - Allowed: owner/admin.
  - Return users and membership role/status: `id, username, email, displayName, status, role, createdAt`.
- `PATCH /api/orgs/:organizationId/members/:userId`
  - Allowed: owner/admin.
  - Body: `{ role?, status? }`.
  - Role changes update `organization_memberships.role`.
  - Status changes update `users.status`.
  - Guardrails:
    - cannot disable yourself;
    - cannot remove/demote the last active owner;
    - admin cannot modify owner unless actor is owner;
    - cannot set unsupported roles/status values.
- `POST /api/orgs/:organizationId/members`
  - Minimal fast version: create an active local user with temporary random password disabled/invited, or return `501 invite flow pending`.
  - Safer near-term: placeholder only, with plan for hashed invite tokens later.

### Dashboard Settings UI

- Use existing `Settings` route.
- Show current user and memberships from `AuthContext`.
- If role owner/admin, list members with role/status controls.
- If lower role, show read-only account/org info.
- Add global handling for 403 responses: show a forbidden snackbar/page instead of spinning or silently logging.

## Frontend PR 1 changes

- `dashboard/src/context/AuthContext.js`
  - Store `memberships` from `/check-auth` in context.
  - Expose helpers like `getSurveyRole(survey)` and `canEditSurvey(survey)` if simple.
- `dashboard/src/api/axios.js`
  - Add response interceptor:
    - 401: clear auth/redirect to login or emit auth event.
    - 403: emit/display forbidden message.
  - Avoid infinite redirects during `/check-auth`.
- Survey selection components (`Dashboard.js`, `Results.js`, `SurveyEditor.js`)
  - Continue using `survey.name` for requests in PR 1, but preserve `survey.id` in state.
  - Pass `organizationId` when creating a survey if user has multiple memberships.
- UI hiding:
  - Hide/disable create/import/edit/send/archive controls based on survey `role` from `/api/surveys`.
  - Viewer may see survey question text/metadata/status but should not see Results, targets, or respondent contact info.
  - Analyst can view Results, targets, and respondent contact info, but cannot save edits/send/archive.
- `SignUp`
  - Since public signup defaults off, handle `403 Public signup is disabled` with a friendly message and link to login/contact admin.
  - Consider removing authenticated `/signup` route from DashboardLayout unless member creation is implemented.

## Tests required

Use `api/test/security.test.js` patterns with mocked `pool.query`, plus integration-style route tests where feasible.

### Authorization helper tests

- Active user with owner/admin/editor/analyst/viewer roles can/cannot pass each allowed role set.
- Disabled user rejected before authorization.
- Platform admin can access surveys without membership.
- User with no membership receives 404/403 and no downstream query runs.
- Survey lookup by name and by UUID both work.

### Cross-org route tests

Create mocked or test DB fixtures for:

- Org A survey, Org B survey.
- User A member of Org A only.
- User B member of Org B only.
- User with viewer role.
- User with analyst role.
- User with editor role.
- User with owner/admin role.

Assertions:

- `/api/surveys` for User A returns only Org A surveys.
- User A cannot call `/api/results?surveyName=OrgBsurvey`.
- User A cannot call `/api/targets?surveyName=OrgBsurvey`.
- User A cannot mutate `/api/updateQuestions`, `/api/updateTarget(s)`, `/api/updateEmails`, `/api/startSurvey`, `/api/testEmail` for Org B.
- User A cannot delete Org B survey/respondents/questions.
- Viewer can list/status/question text but cannot access targets/results/contact info or mutations.
- Analyst can results/targets/contact info but cannot mutations.
- Editor can mutations but cannot archive survey.
- Admin/owner can archive survey.
- Duplicate survey name creation returns 409, not 500.
- Survey creation without membership returns 403; with one org membership attaches `organization_id` and `created_by_user_id`.
- Multi-org create without `organizationId` returns 400 to avoid wrong-org data.

### Respondent regression tests

- Valid `surveyName + token` still loads questions/names/status and submits.
- Valid token for Survey A cannot access Survey B.
- `demo` remains rejected by public respondent endpoints.
- `/api/names` never runs PII query when token validation fails.
- Dashboard org authorization changes do not add session requirement to respondent endpoints.

### Data safety tests

- `startSurvey` email_sent update includes survey scoping.
- Delete survey deletes only rows for resolved survey id/name.
- Legacy rows with `survey_id IS NULL` are still found via fallback.

## Migration and data considerations

No destructive migration is required for PR 1. A small additive migration is likely needed for survey archive fields.

Before deploying PR 1:

1. Confirm `v1_2_product_iam_foundation.sql` has run in target DB.
2. Run inventory queries:
   - `SELECT COUNT(*) FROM Survey WHERE id IS NULL OR organization_id IS NULL;`
   - `SELECT COUNT(*) FROM Respondent WHERE survey_id IS NULL;`
   - `SELECT COUNT(*) FROM EMAIL WHERE survey_id IS NULL;`
   - `SELECT o.slug, COUNT(*) FROM organization_memberships om JOIN organizations o ON o.id=om.organization_id GROUP BY o.slug;`
3. Confirm at least one known admin user is active and owner of `default-imported`.
4. Take/confirm final snapshot before deploying route authorization.
5. Have a rollback path: redeploy previous API image. Since PR 1 has no destructive migration, rollback is application-only unless new rows were created with new columns; legacy columns are still populated.

Additive migration likely needed in PR 1:

- Add `Survey.archived_at TIMESTAMP` and optionally `Survey.archived_by_user_id INT REFERENCES users(id)` for archive semantics.
- Keep this additive and avoid hard deletes.

Follow-up migration after successful PR 1/2, not now:

- Make `Survey.id`, `Survey.organization_id`, `Respondent.survey_id`, and `EMAIL.survey_id` `NOT NULL` after validating backfill.
- Add FK constraints from `Respondent.survey_id` and `EMAIL.survey_id` to `Survey.id`.
- Add `UNIQUE(organization_id, name)` only after deciding how to relax/drop the current global `Survey.name` primary key.
- Consider soft-delete/archive columns before more destructive delete workflows.

## Adversarial risk checklist

- **Lockout risk:** If existing users are not owner members of `default-imported`, `/api/surveys` will become empty. Verify memberships before deploy and keep platform admin escape hatch.
- **Wrong org creation risk:** Multi-org users creating without `organizationId` could attach surveys to arbitrary/default org. Return 400 if ambiguous.
- **Cross-org bypass via `surveyName`:** Every route that accepts `surveyName` must resolve through the helper first. Do not authorize `/api/surveys` only and assume UI selection is trusted.
- **Mixed identifier route risk:** `/api/survey-notifications/:surveyId` is actually passing survey names today. Implement UUID-or-name resolution to avoid breaking dashboard.
- **PII overexposure:** `/api/targets`, `/api/results`, `/api/admin/names`, and respondent `/api/names` expose names/emails/responses. Keep analyst+ or stricter and never expose across orgs.
- **Email status cross-org bug:** `UPDATE Respondent SET email_sent=true WHERE contact_info=ANY($1)` can affect same email in other surveys/orgs. Scope by survey.
- **Demo link confusion:** Public respondent endpoints reject `demo`; test emails and dashboard preview links currently create `userId=demo` URLs. Do not re-open arbitrary public survey definition access to make demo work. Preferred direction: create a real demo account/org and seeded demo survey/respondent data.
- **Silent dashboard failures:** Many components only log errors. Add 403-visible UX or users will interpret authorization as broken data.
- **Legacy backfill gaps:** New code must tolerate `survey_id IS NULL` during rollout, but tests should ensure new writes populate both old and new columns.
- **Global survey name uniqueness:** Full tenant UX may expect same survey names across orgs, but current PK blocks this. Document as a later migration.

## Known PR 2 follow-ups after final review

PR 2 addresses the high-risk review findings from the member/account-management stack before merge: arbitrary `/api/testEmail` respondent-token leakage, reset-token `NODE_ENV` footgun, owner-management transaction recheck, slug collision-safe backfill, Settings owner-control visibility, and reminder survey identifier handling.

Remaining non-blocking holes to track after PR 2 lands:

- **Reminder/test-email semantics:** `/api/testEmail` now requires the recipient email to match an active respondent for the resolved survey before sending a live token. It still calls shared `sendMail()`, so a successful one-off reminder marks that respondent `email_sent = true`. Later split or rename test/preview/reminder email paths if product needs distinct status semantics.
- **Platform-admin settings UX:** backend platform admins can manage org member APIs without organization membership, but the Settings UI currently renders organizations from the user's memberships. Add a platform-admin org picker/list before relying on platform admins for broad UI-based administration.
- **Migration integration coverage:** `v1_4_product_iam_remaining.sql` now performs collision-aware slug backfill before the active org/slug unique index, but automated coverage is mostly static/regex plus Liquibase validation. Add an integration migration test with populated slug collisions before larger production activation.
- **Invite/reset delivery:** invite creation and password reset foundations exist, tokens are hashed at rest, and reset raw-token return is explicit opt-in via `RETURN_DEV_TOKENS=true`. Full production email delivery, operator documentation, and UI polish remain follow-up work.
- **Respondent-token lifecycle:** respondent links still use live UUID tokens. Later add hashing, expiry/revocation, and better preview/demo-token separation.

## Open questions

1. Resolved: `viewer` can see question text plus survey metadata/status.
2. Resolved: `analyst+` can see respondent contact info/PII.
3. Resolved direction: only the operator/owner needs platform-admin or break-glass access initially; bootstrap can use any chosen admin username/credentials, documented separately from public signup.
4. Resolved: survey delete should become archive/soft-delete before exposing multiple orgs.
5. Should invite/member creation be implemented immediately, or should PR 2 only manage roles/status for existing users?
6. Resolved direction: replace public `userId=demo` behavior with a real demo account/org and seeded demo survey/respondent data rather than reopening unauthenticated demo bypasses.
