--liquibase formatted sql

--changeset cladvisors:bulk-survey-reminder-templates-1 splitStatements:false
--comment Add survey-scoped mutable reminder configuration; launch snapshots remain immutable.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '5min';
CREATE TABLE survey_reminder_templates (
  survey_id UUID NOT NULL REFERENCES survey(id) ON DELETE RESTRICT,
  language TEXT NOT NULL,
  subject TEXT NOT NULL,
  body_text TEXT NOT NULL,
  configuration_version BIGINT NOT NULL DEFAULT 1 CHECK (configuration_version > 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  PRIMARY KEY (survey_id, language),
  CHECK (language = lower(btrim(language)) AND language <> ''),
  CHECK (btrim(subject) <> '' AND char_length(subject) <= 255),
  CHECK (btrim(body_text) <> '' AND char_length(body_text) <= 2555)
);
CREATE INDEX survey_reminder_template_updated ON survey_reminder_templates(survey_id, updated_at DESC);
ALTER TABLE email_worker_heartbeats ADD COLUMN IF NOT EXISTS reminder_capable BOOLEAN NOT NULL DEFAULT false;
COMMENT ON COLUMN email_worker_heartbeats.reminder_capable IS 'True only for workers that recheck reminder lifecycle, eligibility, completion, and suppression at the provider boundary.';
COMMENT ON TABLE survey_reminder_templates IS 'Mutable active-survey reminder configuration. Initial invitation templates and immutable launch snapshots are separate.';

--changeset cladvisors:bulk-survey-reminder-delivery-index-1 runInTransaction:false
--comment Accelerate provider-boundary respondent eligibility checks without changing delivery truth.
SET lock_timeout = '5s';
SET statement_timeout = '5min';
DROP INDEX CONCURRENTLY IF EXISTS respondent_reminder_eligibility;
CREATE INDEX CONCURRENTLY respondent_reminder_eligibility
  ON respondent(survey_id, respondent_id)
  WHERE can_respond IS TRUE AND response IS NULL;
RESET lock_timeout;
RESET statement_timeout;

--changeset cladvisors:bulk-survey-reminder-isolated-queue-1 splitStatements:false
--comment Isolate reminder claims from invitation-only workers and bind capability to suppression scope.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '5min';
ALTER TABLE email_worker_heartbeats ADD COLUMN IF NOT EXISTS provider_account_scope VARCHAR(128);
ALTER TABLE email_worker_heartbeats DROP CONSTRAINT IF EXISTS email_worker_heartbeats_provider_account_scope_check;
ALTER TABLE email_worker_heartbeats ADD CONSTRAINT email_worker_heartbeats_provider_account_scope_check
  CHECK (provider_account_scope IS NULL OR (provider_account_scope = btrim(provider_account_scope) AND provider_account_scope <> ''));
ALTER TABLE survey_email_deliveries DROP CONSTRAINT IF EXISTS survey_email_deliveries_status_check;
ALTER TABLE survey_email_deliveries ADD CONSTRAINT survey_email_deliveries_status_check CHECK(status IN (
  'pending','leased','retry_wait','reminder_pending','reminder_leased','reminder_retry_wait',
  'accepted','failed','uncertain','cancelled'
));
UPDATE survey_email_deliveries d SET status=CASE d.status
  WHEN 'pending' THEN 'reminder_pending'
  WHEN 'leased' THEN 'reminder_leased'
  WHEN 'retry_wait' THEN 'reminder_retry_wait'
END
FROM survey_launches l
WHERE l.id=d.launch_id AND l.kind='reminder' AND d.status IN ('pending','leased','retry_wait');
COMMENT ON COLUMN email_worker_heartbeats.reminder_capable IS 'True only for workers that use reminder-only queue states and recheck lifecycle, eligibility, completion, and suppression at the provider boundary.';
COMMENT ON COLUMN email_worker_heartbeats.provider_account_scope IS 'Provider account whose suppressions this worker enforces; required when reminder_capable is true.';

--changeset cladvisors:bulk-survey-reminder-isolated-queue-index-1 runInTransaction:false
--comment Accelerate isolated reminder claims without changing initial invitation work.
SET lock_timeout = '5s';
SET statement_timeout = '5min';
DROP INDEX CONCURRENTLY IF EXISTS reminder_delivery_due_work;
CREATE INDEX CONCURRENTLY reminder_delivery_due_work
  ON survey_email_deliveries(next_attempt_at, created_at)
  WHERE status IN ('reminder_pending','reminder_retry_wait','reminder_leased');
RESET lock_timeout;
RESET statement_timeout;
