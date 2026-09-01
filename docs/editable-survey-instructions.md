# Editable survey instructions

## Data and API semantics

`Survey.instructions` is a nullable `TEXT` override:

- `NULL` uses the current application-derived default. TeamEVAL surveys continue to use the approved TeamEVAL wording.
- `''` explicitly hides the respondent instruction block.
- Any nonempty string is an administrator override rendered as plain text.

The database has no content default and no blanket backfill. Authenticated dashboard clients use stable survey UUID routes `GET/PUT /api/surveys/:surveyId/instructions`. PUT accepts only an explicit `instructions` property containing `null` or a string, is editor-only and draft-only, and runs under the shared Survey lifecycle row lock. It permits tabs and line breaks, rejects other C0/C1 controls, and enforces 5,000 Unicode code points plus 16,000 UTF-8 bytes.

Each successful update writes `survey.instructions_updated` in the same transaction. Audit metadata contains only derived/hidden/override presence, character/byte lengths, and whether the value changed; instruction text is never copied into audit metadata.

After respondent or demo-token authorization, `/api/questions` returns the resolved effective text. The respondent React runtime interpolates it as text with `white-space: pre-wrap`; it never treats it as HTML. Empty effective text omits the entire instruction block.

Survey copy stores the source's raw override in the new draft. It does not materialize a derived default and continues to exclude participants, bearer tokens, responses, launches, attempts, and delivery history.

## Abandoned PR27 staging reconciliation

PR27 was not merged, but staging recorded these abandoned identities from `changelogs/v1_5_editable_survey_content.sql`:

- `cladvisors:editable-survey-content-1`
- `cladvisors:editable-survey-invitation-delivery-1`

`v1_10_editable_survey_instructions.sql` has a new path, author, and ID. It adds the nullable column for clean/current databases. Only when `DATABASECHANGELOG` contains the exact abandoned content identity and path does it convert PR27's exact migration-generated generic default (`10-15` with an ASCII hyphen) to `NULL`. Empty and all non-default values are preserved. It then drops any column default.

The obsolete `EMAIL.subject` and four abandoned respondent invitation-claim columns are intentionally untouched. They require separately reviewed cleanup because this migration does not need them and staging history may still describe them.

## Rollout prerequisites

1. Use a final approved snapshot and quiesced writers for the production cutover-to-master transition described in `docs/runbooks/cla-production-migration.md`.
2. Rehearse clean, pre-feature, abandoned-PR27-shaped, CLA-cutover-to-master, and rerun paths in disposable databases.
3. Confirm the abandoned staging changeset path/author/ID exactly before relying on normalization; never normalize non-default values manually.
4. Deploy schema before code and do not use a binary that selects `Survey.instructions` before the migration is complete.
