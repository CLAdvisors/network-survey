# CLA production survey-data migration runbook

Target application baseline: `a379f101aa4a722d6fc6fab7cdbb092547b0c717`

Recorded pre-cutover API release: `c22e3031787c2403b5e9174bdd9a71385c481dde`

This cutover moves the complete legacy survey data space into organization `CLA`
(slug `cla`) while preserving survey/respondent identities, bearer tokens,
responses, invitation bodies/subjects, archive state, and email-send state.
Legacy dashboard users are retained as disabled rows after cutover but lose
memberships and active sessions.

## Recorded production preflight

- RDS: `network-survey-prod-postgres-v2`, PostgreSQL 15.18, encrypted and deletion-protected
- Final snapshot: `network-survey-prod-postgres-v2-pre-cla-20260804191658`
- Snapshot status at creation: `available`
- Database: `ONA`
- Surveys: 11
- Respondents: 113
- Stored responses: 21
- Respondents marked emailed: 80
- Email templates: 111
- Legacy users: IDs `1,2` (`Admin`, `Admin1`)
- Sessions: one for each legacy user at preflight
- Null survey names/tokens: 0
- Duplicate non-null respondent tokens: 0
- Legacy respondent/email orphans: 0
- Pre-migration digests:
  - Survey: `ad95ee6ecd6e4d201dcb69f2d7ede646`
  - Respondent/response: `4f68353e26d6cc383b3680cb03a31ad4`
  - Email: `40ca155d5df7c78dc1ef2b005318ad99`

The survey digest is expected to change because v1.4–v1.6 add/backfill survey
slugs/display names, materialize SurveyJS `isRequired:false`, and add invitation
subjects. Respondent/response payloads and legacy email bodies must reconcile.

## Execution order

1. Confirm application downtime and no active database writers.
2. Confirm the final snapshot above is still `available`.
3. Confirm `/network-survey/prod/api/bootstrap-admin-password` exists as a
   SecureString and the production API instance can decrypt it without printing it.
4. Apply the reviewed production Terraform plan with
   `enable_cla_production_cutover=true` and `enable_cla_owner_bootstrap=true`.
   It must contain only in-place runtime IAM policy and config-object changes; no
   destroys or replacements. This one-time apply was completed before cutover.
5. Deploy the reviewed release with `CLA_PRODUCTION_CUTOVER=true`. This selects
   `cla-production-cutover.xml`; the universal local/CI/staging master changelog
   cannot execute `v1_7`. Liquibase aborts on null/orphaned/disagreeing child
   relationships, active slug collisions, orphaned audit survey IDs, or an empty
   survey set. Bootstrap `create-or-verify` mode is retry-safe: it creates the
   approved owner once and subsequently requires exact identity and credential.
6. Confirm external API health, then authenticate as the new CLA owner and verify
   survey listing/results. Login updates `users.last_login_at` and is required by
   cleanup.
7. Run `finalize-legacy-accounts.js` in `dry-run` mode with the exact snapshot ID,
   counts, and legacy user IDs above. Review output.
8. Repeat in `apply` mode with `CONFIRM_FINAL_SNAPSHOT_ID` exactly matching the
   recorded snapshot.
9. Run post-migration reconciliation and respondent-link smoke tests.
10. Remove the one-time production bootstrap config/IAM access and rotate/delete
    the bootstrap SecureString after the owner password is rotated.

## Cleanup invocation environment

Run on the production API instance from the active release with DB variables loaded
from runtime config. Required non-secret controls:

```text
CLA_OWNER_USERNAME=sgarcia@cladvisors.com
CLA_ORGANIZATION_SLUG=cla
EXPECTED_DB_NAME=ONA
EXPECTED_SURVEY_COUNT=11
EXPECTED_RESPONDENT_COUNT=113
EXPECTED_EMAIL_COUNT=111
EXPECTED_LEGACY_USER_IDS=1,2
FINAL_SNAPSHOT_ID=network-survey-prod-postgres-v2-pre-cla-20260804191658
CLA_CUTOVER_STARTED_AT=<ISO timestamp before owner login>
CLEANUP_MODE=dry-run|apply
CONFIRM_FINAL_SNAPSHOT_ID=<required in apply mode>
```

Never place the owner password or decrypted database password in this runbook,
command logs, Terraform variables, or repository files.

## Post-migration acceptance

- Exactly 11 surveys belong to CLA, including archived/demo surveys.
- Exactly 113 respondents and 21 non-null responses remain.
- Exactly 80 respondents remain marked emailed.
- Exactly 111 templates have stable survey IDs and non-null invitation subjects.
- No null/orphaned/disagreeing respondent or email survey relationships exist.
- Respondent IDs, tokens, response JSON, contact data, and legacy email bodies are unchanged.
- `sgarcia@cladvisors.com` is active CLA owner and not platform admin.
- Legacy users 1 and 2 are disabled, have no memberships, and have no sessions.

## Rollback

Application artifact rollback does not reverse this data migration. If validation
fails after commit:

1. Restore snapshot `network-survey-prod-postgres-v2-pre-cla-20260804191658` to a
   unique RDS identifier in subnet group `db-subnet-group`, attaching security
   group `sg-00d61e181de4cfb48`, with public access disabled.
2. Wait for `available`, record the restored endpoint, and verify TLS/connectivity
   from production instance `i-065f1e1f497ab1481`.
3. Set Terraform variable `api_config_db_host_override` to that endpoint; leave
   `enable_cla_production_cutover=false` and `enable_cla_owner_bootstrap=false`.
   Apply only the reviewed runtime config/IAM changes.
4. Redeploy recorded pre-cutover artifact
   `c22e3031787c2403b5e9174bdd9a71385c481dde`; its historical changelog must not
   execute the CLA cutover.
5. Verify health plus the recorded 11/113/111 counts and pre-migration digests.
6. Preserve the migrated database for forensic comparison. To return, clear
   `api_config_db_host_override`, review the plan, apply, and redeploy the intended
   migrated artifact.

Do not overwrite either database.
