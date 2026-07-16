# Product IAM and User Data Management Plan

## Scope and goal

This plan covers application-level identity, authentication, authorization, product roles, survey/respondent data ownership, and privacy controls for the `network-survey` product. It intentionally does **not** cover AWS IAM except where runtime/session/secrets configuration affects product auth.

Goal: move from a single shared dashboard data space to a tenant-aware model where authenticated product users can only access surveys and respondent data that they own or are explicitly authorized to manage, while preserving the public respondent survey-link flow.

## Repo-specific findings

### Database schema and migrations

Current Liquibase migrations are in `db/changelogs/`:

- `v1_0_create_initial_tables.sql`
  - `Survey(name PRIMARY KEY, title, creation_date, questions JSONB)`
  - `Respondent(respondent_id SERIAL PRIMARY KEY, name, contact_info, survey_name REFERENCES Survey(name), can_respond, uuid UNIQUE, lang, response JSONB, UNIQUE(name, survey_name))`
  - `EMAIL(survey_name REFERENCES Survey(name), lang, text, UNIQUE(survey_name, lang))`
  - `users(id SERIAL PRIMARY KEY, username UNIQUE NOT NULL, password NOT NULL, created_at)`
  - `sessions(sid PRIMARY KEY, sess json, expire)` for `connect-pg-simple`
- `v1_1_add_sent_email_count.sql`
  - `Respondent.email_sent BOOLEAN DEFAULT FALSE`

Important implications:

- Survey identity is the mutable/business value `Survey.name`; there is no stable `survey_id`.
- There is no organization/workspace/client table.
- There is no ownership or membership relationship between `users` and `Survey`.
- There are no roles, permissions, invites, account status fields, password reset fields, or audit tables.
- Respondent PII (`name`, `contact_info`) and responses live in the same `Respondent` row.
- Respondent link token is `Respondent.uuid VARCHAR(50) UNIQUE`; it is treated as a bearer credential.
- Existing unique constraints are global enough to make tenant isolation awkward: `Survey.name` is globally unique and `Respondent.uuid` is globally unique, but survey names are not scoped by owner/org.

### API authentication/session model

`api/server.js` uses:

- `express-session` with PostgreSQL session store (`sessions` table).
- Cookie name from `SESSION_COOKIE_NAME || 'sessionId'`.
- `httpOnly: true`, `sameSite: 'lax'`, `maxAge: 24h`.
- `secure: process.env.NODE_ENV === 'prod'` and prod cookie domain `.bennetts.work`.
- Local username/password auth with `bcrypt.hash(password, 10)`.

Auth endpoints:

- `POST /api/register`: public self-registration, username/password only, min password length 6.
- `POST /api/login`: looks up `users.username`, verifies bcrypt, stores `req.session.userId` and `req.session.username`.
- `POST /api/logout`: destroys session.
- `GET /api/check-auth`: returns session user if present.

The only middleware is:

```js
const requireAuth = (req, res, next) => {
  if (!req.session.userId) return res.status(401).json({ error: 'Unauthorized' });
  next();
};
```

### API authorization gaps by route

Route inventory from `api/server.js`:

Public dashboard/admin-data mutation routes today:

- `POST /api/survey` creates any survey.
- `POST /api/testEmail` sends test emails for any survey.
- `POST /api/startSurvey` emails all respondents for any survey.
- `POST /api/updateEmails` modifies email templates for any survey.
- `POST /api/updateTarget` upserts/deletes respondents for any survey.
- `POST /api/updateTargets` bulk upserts respondents for any survey.
- `POST /api/updateQuestions` changes questions for any survey.

Public dashboard/admin-data read routes today:

- `GET /api/survey-notifications/:surveyId`
- `GET /api/listQuestions?surveyName=...`
- `GET /api/results?surveyName=...`
- `GET /api/targets?surveyName=...`
- `GET /api/surveyStatus?surveyName=...`

Authenticated but not owner-scoped:

- `GET /api/surveys` requires auth but returns all surveys in the database.
- `DELETE /api/survey/:surveyName` requires auth but deletes any survey.
- `DELETE /api/user` requires auth but deletes a respondent from any survey.
- `DELETE /api/question` requires auth but deletes a question from any survey.

Public respondent routes that should remain public-ish but must be token-scoped:

- `GET /api/questions?surveyName=...` loads survey definition.
- `GET /api/names?surveyName=...&userId=...` lazy-loads all possible names/emails except current respondent.
- `GET /api/user/status?userId=...` checks if token has a response.
- `POST /api/user` submits response for `userId` but does not verify that the token belongs to the provided `surveyName`.

### Frontend auth usage

Dashboard app (`dashboard/src`):

- `dashboard/src/api/axios.js` sets `withCredentials: true` and `/api` base URL from env.
- `dashboard/src/context/AuthContext.js` calls `/check-auth`, `/login`, `/logout` and stores `{isAuthenticated, user}` in React state.
- `dashboard/src/App.js` gates dashboard routes client-side. Unauthenticated users see landing/login/signup.
- `dashboard/src/components/SignUp.js` exposes public signup, then logs in.
- Dashboard components call admin data endpoints directly by `surveyName`; most calls assume the API enforces access but it currently does not.

Survey respondent app (`network-survey/src`):

- `SurveyComponent.jsx` reads `surveyName` and `userId` from the URL query string.
- It fetches `/questions`, `/user/status`, and `/names`, and submits to `/user`.
- No session cookie is used for respondents; the `userId` token is the only credential.
- Demo mode uses `userId=demo` and does not submit responses.

## Current product IAM/data model

Current model is effectively:

- One global dashboard namespace.
- Any registered dashboard user is equivalent to a global administrator for the database, but only some routes actually require login.
- Anyone who can reach the API and knows/guesses a `surveyName` can read or mutate most survey configuration, respondent lists, templates, and results.
- Respondents are authenticated by a bearer URL token (`Respondent.uuid`), with no expiry, no explicit status, and limited server-side validation.

## Key gaps and risks

1. **No server-side authorization on most admin endpoints.** Client-side route gating does not protect the API.
2. **No survey ownership.** Surveys cannot be safely partitioned between customers, teams, consultants, or admins.
3. **No roles.** There is no distinction between platform admin, org admin, survey editor, analyst/read-only user, or respondent.
4. **Public self-registration.** Anyone can create a dashboard account. Because some authenticated routes operate globally, signup creates escalation risk.
5. **Global data exposure.** `/api/surveys` lists all surveys to any authenticated user; unauthenticated endpoints expose targets/results by survey name.
6. **Unsafe respondent token handling.** `POST /api/user` updates by `uuid` only and accepts a separate `surveyName`; `/api/questions` can load by survey name alone; `/api/names` exposes names and emails for a survey to any valid-looking request.
7. **PII overexposure.** Names, emails, responses, and network nominations are broadly returned to dashboard endpoints and respondent lazy-load endpoints.
8. **Destructive actions have no ownership checks or audit trail.** Survey/respondent/question deletes are hard deletes with no actor recording.
9. **Account lifecycle missing.** No email, display name, disabled/locked state, last login, password reset, or invited-by tracking.
10. **Session hardening incomplete.** Login does not explicitly regenerate the session ID; CSRF protection is absent for cookie-authenticated state-changing routes.
11. **Schema naming creates migration friction.** Mixed-case table names require quoting in future SQL; `users.password` should be renamed logically to `password_hash`.

## Recommended target model

### Product tenancy and ownership

Introduce an organization/workspace model, even if initially every existing survey is assigned to one default organization.

Recommended tables:

- `organizations`
  - `id UUID PRIMARY KEY DEFAULT gen_random_uuid()`
  - `name TEXT NOT NULL`
  - `slug TEXT UNIQUE`
  - `created_at`, `updated_at`, `archived_at`
- `organization_memberships`
  - `organization_id REFERENCES organizations(id)`
  - `user_id REFERENCES users(id)`
  - `role TEXT NOT NULL CHECK (role IN ('owner','admin','editor','analyst','viewer'))`
  - `created_at`, `created_by_user_id`
  - `PRIMARY KEY (organization_id, user_id)`
- `survey_memberships` (optional but recommended for per-survey exceptions)
  - `survey_id REFERENCES surveys(id)`
  - `user_id REFERENCES users(id)`
  - `role TEXT NOT NULL CHECK (role IN ('owner','editor','analyst','viewer'))`
  - `PRIMARY KEY (survey_id, user_id)`

Add stable survey identity and ownership:

- Add `Survey.id UUID DEFAULT gen_random_uuid()` and eventually make it the primary key.
- Add `Survey.organization_id UUID REFERENCES organizations(id)`.
- Add `Survey.created_by_user_id INT REFERENCES users(id)`.
- Keep `Survey.name` as a display/legacy slug initially; later enforce `UNIQUE(organization_id, name)` instead of global PK.

Role semantics:

- `platform_admin`: global support/operator role on `users` or separate `user_roles` table. Use sparingly.
- Organization `owner/admin`: manage members, settings, all org surveys.
- `editor`: create/edit surveys, respondents, questions, templates, start sends.
- `analyst`: read respondents/results and export/report, no edits.
- `viewer`: read survey metadata/status only; no PII/results by default unless explicitly allowed.
- Respondents are **not** dashboard users; they remain token-authenticated subjects tied to a survey.

### User account model

Extend `users`:

- Rename/alias `password` usage to `password_hash` in code after migration.
- Add `email CITEXT UNIQUE`, `display_name`, `status CHECK ('invited','active','disabled')`, `is_platform_admin BOOLEAN DEFAULT false`, `last_login_at`, `password_changed_at`, `created_by_user_id`.
- Make public registration configurable or remove it from production. Prefer invite-created accounts.
- Add future tables for `user_invites` and `password_reset_tokens` with hashed tokens and expiry.

### Respondent/access-token model

Keep the respondent no-login experience but make the URL token first-class and scoped.

Recommended changes:

- Add `Respondent.survey_id UUID REFERENCES Survey(id)` while retaining `survey_name` during migration.
- Add `respondent_tokens` or enhance `Respondent`:
  - `token_hash TEXT UNIQUE NOT NULL` instead of storing raw token as the lookup credential.
  - `token_created_at`, `token_expires_at`, `token_revoked_at`, `last_accessed_at`.
  - Keep raw token only at creation/email time; never return it from APIs.
- Require both token and survey identifier to resolve to the same respondent for all respondent routes.
- Add response metadata: `response_submitted_at`, `response_updated_at`, maybe `response_ip_hash`/`user_agent_hash` if needed and privacy-approved.

### Authorization rules by API area

Implement centralized helpers in `api/server.js` or, preferably, route modules when refactoring:

- `requireAuth`: validates session and loads current user from DB including status/platform admin.
- `requireOrgRole(orgId, allowedRoles)`.
- `requireSurveyRole(surveyId/name, allowedRoles)` resolves survey and checks organization/survey membership.
- `requireRespondentToken(token, surveyId/name)` resolves respondent and attaches it to `req.respondent`.

Target route policy:

- Account/session:
  - `POST /api/register`: disabled in production or invite-only; no org access until membership exists.
  - `POST /api/login`, `/logout`, `/check-auth`: public/session only.
- Dashboard survey admin/read routes:
  - Require auth and survey/org role on every route.
  - List only accessible surveys in `/api/surveys`.
  - Create survey in an organization where user is owner/admin/editor.
  - Results/targets require analyst/editor/admin/owner and should support PII-minimized response shapes.
  - Delete survey requires owner/admin, or possibly survey owner only.
- Respondent routes:
  - `GET /api/questions`: require valid respondent token for that survey, except demo/public preview endpoint should be separate.
  - `GET /api/names`: require valid respondent token for that survey; return only fields needed by SurveyJS. Consider not exposing emails in choice text.
  - `GET /api/user/status`: require token and survey.
  - `POST /api/user`: require token and survey match; update only that respondent.

## Phased implementation plan

### Phase 0: Safety inventory and tests before schema changes

1. Add API integration tests or smoke tests for current auth/session and major endpoints before changing behavior.
2. Snapshot production DB before product IAM migrations, consistent with repo guidance to preserve current production data.
3. Inventory existing production rows:
   - survey count, survey names, respondents per survey, duplicate names/emails, users, sessions.
4. Decide bootstrap ownership for existing data: default organization name and initial owner/admin user(s).

No product behavior change in this phase.

### Phase 1: Immediate API hardening with current schema

Make minimal code changes before deeper migrations:

1. Apply `requireAuth` to all dashboard/admin endpoints:
   - `/api/survey`, `/api/testEmail`, `/api/startSurvey`, `/api/updateEmails`, `/api/updateTarget`, `/api/updateTargets`, `/api/updateQuestions`, `/api/survey-notifications/:surveyId`, `/api/listQuestions`, `/api/results`, `/api/targets`, `/api/surveyStatus`.
2. Keep respondent endpoints public but validate token/survey consistency:
   - `/api/questions` should accept `userId` and verify `Respondent.uuid = userId AND survey_name = surveyName` unless `userId=demo`.
   - `/api/names` already receives `userId`; return 403/404 if no matching respondent in that survey.
   - `/api/user/status` should include `surveyName` and verify both.
   - `/api/user` should update with `WHERE uuid = $1 AND survey_name = $2` and return a response status.
3. Disable or gate public signup in production:
   - Add env like `ALLOW_PUBLIC_SIGNUP=false` defaulting false outside local/dev.
4. Regenerate session on login before setting `userId` to reduce fixation risk.
5. Add basic rate limiting to login/register/respondent token endpoints.

This phase does not solve multi-tenant ownership but closes the largest unauthenticated holes.

### Phase 2: Add ownership schema without breaking existing code

Add a new Liquibase migration, for example `v1_2_product_iam_foundation.sql`:

1. Enable UUID support (`pgcrypto`): `CREATE EXTENSION IF NOT EXISTS pgcrypto;`.
2. Create `organizations` and `organization_memberships`.
3. Add nullable/backfilled columns:
   - `ALTER TABLE users ADD COLUMN email CITEXT`, `display_name`, `status`, `is_platform_admin`, `last_login_at`, etc. If `citext` is used, add extension.
   - `ALTER TABLE Survey ADD COLUMN id UUID DEFAULT gen_random_uuid();`
   - `ALTER TABLE Survey ADD COLUMN organization_id UUID;`
   - `ALTER TABLE Survey ADD COLUMN created_by_user_id INT REFERENCES users(id);`
   - `ALTER TABLE Respondent ADD COLUMN survey_id UUID;`
   - `ALTER TABLE EMAIL ADD COLUMN survey_id UUID;`
4. Backfill:
   - Create a default org, e.g. `Default / Imported`.
   - Attach all existing surveys to that org.
   - Choose existing local/prod admin user(s) as `organization_memberships.role='owner'`.
   - Backfill `Respondent.survey_id` and `EMAIL.survey_id` from `survey_name`.
5. Add indexes:
   - `Survey(organization_id, name)`.
   - `Respondent(survey_id)`, `Respondent(survey_id, uuid)`.
   - `EMAIL(survey_id, lang)`.
   - Membership indexes by `user_id` and `organization_id`.
6. Keep old columns and constraints until application code has moved.

### Phase 3: Owner-scoped API reads/writes

1. Load current user in auth middleware from `users`, including `status` and platform-admin flag.
2. Add `getSurveyForUser({ surveyName or surveyId, userId, allowedRoles })` helper.
3. Change `/api/surveys` query to only return surveys accessible through `organization_memberships` or `survey_memberships`.
4. Change all dashboard endpoints to resolve the survey first through the authorization helper, then use the resolved `survey.id`/`survey.name` in queries.
5. For create survey:
   - Accept `organizationId` from frontend if user has multiple orgs.
   - Set `created_by_user_id = req.user.id` and `organization_id`.
6. For destructive actions:
   - Restrict to `owner/admin`.
   - Add soft-delete/archive for surveys if product wants recoverability; otherwise add audit logging before hard delete.

### Phase 4: Frontend migration

Dashboard:

1. Extend `AuthContext` user shape to include `email`, `displayName`, platform/admin flags, and memberships/active organization if returned by API.
2. Add organization selector only if multiple orgs are returned; otherwise keep current UI simple.
3. Stop exposing signup in production unless public signup is explicitly enabled.
4. Update all API calls to use `surveyId` where available, while preserving `surveyName` in display.
5. Handle 401/403 globally in `dashboard/src/api/axios.js` with an interceptor that redirects to login or displays forbidden state.
6. Hide UI actions based on role:
   - viewers cannot edit/delete/send.
   - analysts can view results but not modify respondents/questions/templates.
   - editors can edit but not manage members/delete org.

Survey app:

1. Move links from `?surveyName=...&userId=...` to `?surveyId=...&token=...` or `?s=...&t=...`.
2. Continue accepting legacy links during a compatibility window by resolving `surveyName + userId`.
3. Include token in every respondent endpoint; never rely on survey name alone.
4. Consider removing emails from nomination display: currently `/api/names` returns `Name (email)`. Use a privacy-approved label, possibly `Name` plus disambiguator only when needed.

### Phase 5: Respondent token hardening and privacy improvements

1. Add hashed-token storage and migrate existing `Respondent.uuid` values:
   - For existing links, either keep legacy `uuid` until completion or store a hash of existing uuid and support lookup during transition.
   - New links should generate a high-entropy token, store only hash, and email raw token.
2. Add token expiry/revocation policy, likely per survey wave.
3. Add response timestamps and completion status columns rather than inferring only from `response IS NULL`.
4. Split PII from responses if needed:
   - `respondents` for identity/contact/delivery.
   - `survey_responses` for answers and timestamps.
   - This enables stricter access controls and easier retention/deletion.
5. Add data retention/anonymization workflows:
   - Delete/anonymize respondent `contact_info` after project close when business permits.
   - Preserve aggregate/network outputs without direct contact info where possible.

### Phase 6: Account management and auditability

1. Implement invitation flow:
   - Org owner/admin invites by email and role.
   - Invite tokens are hashed, expire, and are single-use.
2. Implement password reset and password change.
3. Add audit log table:
   - `audit_events(id, actor_user_id, organization_id, survey_id, action, target_type, target_id, metadata JSONB, created_at)`.
   - Log create/update/delete/start survey/email-send/import/export/member changes.
4. Add member management UI under Settings.
5. Add export/download controls with role checks and audit events.

## Concrete DB migration sketch

Example foundation migration contents, to be refined after production data inventory:

```sql
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS citext;

CREATE TABLE organizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT UNIQUE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  archived_at TIMESTAMP
);

ALTER TABLE users
  ADD COLUMN email CITEXT UNIQUE,
  ADD COLUMN display_name TEXT,
  ADD COLUMN status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('invited','active','disabled')),
  ADD COLUMN is_platform_admin BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN last_login_at TIMESTAMP,
  ADD COLUMN password_changed_at TIMESTAMP;

CREATE TABLE organization_memberships (
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('owner','admin','editor','analyst','viewer')),
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by_user_id INT REFERENCES users(id),
  PRIMARY KEY (organization_id, user_id)
);

ALTER TABLE Survey
  ADD COLUMN id UUID DEFAULT gen_random_uuid(),
  ADD COLUMN organization_id UUID REFERENCES organizations(id),
  ADD COLUMN created_by_user_id INT REFERENCES users(id);

ALTER TABLE Respondent ADD COLUMN survey_id UUID;
ALTER TABLE EMAIL ADD COLUMN survey_id UUID;

CREATE INDEX idx_survey_org_name ON Survey(organization_id, name);
CREATE INDEX idx_respondent_survey_id ON Respondent(survey_id);
CREATE INDEX idx_respondent_survey_uuid ON Respondent(survey_id, uuid);
CREATE INDEX idx_email_survey_lang ON EMAIL(survey_id, lang);
CREATE INDEX idx_org_memberships_user ON organization_memberships(user_id);
```

Later migrations should make new IDs/foreign keys `NOT NULL`, add `UNIQUE(organization_id, name)`, move foreign keys from `survey_name` to `survey_id`, and eventually rename tables/columns to lowercase if desired.

## Security and privacy considerations

- Treat dashboard session cookies as privileged; add CSRF protection or double-submit tokens before relying on cookie auth for all mutations.
- Set production cookie security from explicit env (`SESSION_COOKIE_SECURE=true`) rather than `NODE_ENV === 'prod'` only, and verify staging/prod cookie domain isolation.
- Do not log passwords, raw respondent tokens, full response bodies, or respondent CSV content.
- Return 404 or generic 403 for unauthorized survey access to avoid survey-name enumeration.
- Use parameterized SQL everywhere. Most current queries are parameterized, but `insertSurvey()` currently interpolates `name` and `title`; replace with parameters in implementation.
- Rate-limit login, signup/invite acceptance, respondent token checks, email sending, and CSV upload endpoints.
- Add payload size limits for CSV/questions/uploads and validate CSV with a real parser consistently.
- Minimize PII in respondent choices. Current `Name (email)` display exposes email addresses to every respondent in the survey.
- Add audit events for access to results/exports and destructive changes.
- Define retention rules for respondent contact info and responses, especially because network survey answers can reveal sensitive workplace relationships.
- Ensure backups/snapshots are covered by retention and deletion policies; product-level deletion may not immediately remove data from backups.

## Open questions

1. What are the real product tenants: CLA internal only, external client organizations, individual consultants, or per-survey projects?
2. Who should own the existing production/demo surveys after backfill?
3. Should public self-signup exist at all, or should all dashboard users be invited?
4. Is a respondent allowed to resubmit indefinitely? Should survey owners configure one-time vs editable responses?
5. Should respondent links expire, and if so when: fixed days after send, survey close date, or never for legacy surveys?
6. Do survey respondents need anonymity from dashboard users, or are named responses expected for this product?
7. Should results be separated into identifiable and anonymized views by role?
8. Is `Survey.name` intended to be public/stable, or can links move to opaque `surveyId`/slug values?
9. What roles are actually needed for the near-term UI: owner/admin/editor/analyst/viewer, or a simpler admin/editor/viewer split?
10. Are there legal/privacy requirements for data retention, deletion requests, or client-specific data residency?
11. Should production use local username/password long-term, or should SSO/OIDC be planned for dashboard users?
12. Should survey deletion remain hard delete, become archive/soft delete, or require a separate purge flow?
