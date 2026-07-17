--liquibase formatted sql

--changeset cladvisors:product-iam-survey-archive-1 splitStatements:false
--comment Add additive soft-archive fields for org-scoped survey lifecycle authorization.
ALTER TABLE Survey ADD COLUMN IF NOT EXISTS archived_at TIMESTAMP NULL;
ALTER TABLE Survey ADD COLUMN IF NOT EXISTS archived_by_user_id INTEGER NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'survey_archived_by_user_id_fkey'
      AND conrelid = 'survey'::regclass
  ) THEN
    ALTER TABLE Survey
      ADD CONSTRAINT survey_archived_by_user_id_fkey
      FOREIGN KEY (archived_by_user_id) REFERENCES users(id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_survey_active_org ON Survey (organization_id, archived_at);
