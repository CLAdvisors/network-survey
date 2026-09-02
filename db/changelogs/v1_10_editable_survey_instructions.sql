--liquibase formatted sql

--changeset network-survey:editable-survey-instructions-reconciliation-1 splitStatements:false
--comment Add nullable survey instruction overrides and safely reconcile only the exact abandoned PR27 migration default when its recorded changeset is present. Obsolete EMAIL.subject and respondent invitation-claim columns are intentionally left for separate cleanup.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '5min';

ALTER TABLE Survey ADD COLUMN IF NOT EXISTS instructions TEXT;

DO $$
DECLARE
  abandoned_changeset_applied BOOLEAN;
  legacy_default CONSTANT TEXT := 'For each question below, indicate the people you interact with at work. The survey will take 10-15 minutes to complete; please plan to finish in one session.';
BEGIN
  SELECT EXISTS (
    SELECT 1
    FROM databasechangelog
    WHERE id = 'editable-survey-content-1'
      AND author = 'cladvisors'
      AND filename = 'changelogs/v1_5_editable_survey_content.sql'
  ) INTO abandoned_changeset_applied;

  IF abandoned_changeset_applied THEN
    -- PR27's blanket backfill made its exact generated default indistinguishable
    -- from an untouched row. Normalize only that exact value; empty and every
    -- other value are administrator intent and must be preserved.
    UPDATE Survey
    SET instructions = NULL
    WHERE instructions = legacy_default;
  END IF;
END $$;

-- Clean installs and reconciled staging both use application-derived defaults.
-- This is safe even when the abandoned column was never present.
ALTER TABLE Survey ALTER COLUMN instructions DROP DEFAULT;
