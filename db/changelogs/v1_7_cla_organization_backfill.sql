--liquibase formatted sql

--changeset cladvisors:cla-organization-backfill-1 splitStatements:false
--comment Reconcile legacy survey relationships and place the complete survey data space under the CLA organization without changing survey, respondent, token, response, or template identities.

SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '10min';
LOCK TABLE Survey, Respondent, EMAIL, audit_events, organization_memberships IN SHARE ROW EXCLUSIVE MODE;

-- Create the explicitly approved production organization. Reusing the slug on a
-- partially applied environment preserves its UUID and all references.
INSERT INTO organizations (name, slug)
VALUES ('CLA', 'cla')
ON CONFLICT (slug) DO UPDATE
SET name = EXCLUDED.name,
    updated_at = CURRENT_TIMESTAMP,
    archived_at = NULL;

-- v1_2 normally supplies IDs. This defensive pass only assigns identities where
-- none exist; existing IDs are never rewritten.
UPDATE Survey
SET id = gen_random_uuid()
WHERE id IS NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM Survey) THEN
    RAISE EXCEPTION 'CLA backfill refused: no surveys found in the target database';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM Respondent r
    LEFT JOIN Survey by_name ON by_name.name = r.survey_name
    LEFT JOIN Survey by_id ON by_id.id = r.survey_id
    WHERE r.survey_name IS NULL
       OR by_name.id IS NULL
       OR (r.survey_id IS NOT NULL AND by_id.id IS NULL)
       OR (r.survey_id IS NOT NULL AND by_id.id <> by_name.id)
  ) THEN
    RAISE EXCEPTION 'CLA backfill refused: Respondent contains null, orphaned, or disagreeing survey relationships';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM EMAIL e
    LEFT JOIN Survey by_name ON by_name.name = e.survey_name
    LEFT JOIN Survey by_id ON by_id.id = e.survey_id
    WHERE e.survey_name IS NULL
       OR by_name.id IS NULL
       OR (e.survey_id IS NOT NULL AND by_id.id IS NULL)
       OR (e.survey_id IS NOT NULL AND by_id.id <> by_name.id)
  ) THEN
    RAISE EXCEPTION 'CLA backfill refused: EMAIL contains null, orphaned, or disagreeing survey relationships';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM Survey
    WHERE archived_at IS NULL AND slug IS NOT NULL
    GROUP BY slug
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'CLA backfill refused: active survey slugs would collide in the CLA organization';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM audit_events ae
    LEFT JOIN Survey s ON s.id = ae.survey_id
    WHERE ae.survey_id IS NOT NULL AND s.id IS NULL
  ) THEN
    RAISE EXCEPTION 'CLA backfill refused: audit event contains an orphaned survey_id';
  END IF;
END $$;

-- Fill only missing stable child references from the still-globally-unique
-- legacy name relationship. Responses, respondent IDs/tokens, email state, and
-- invitation contents are untouched.
UPDATE Respondent r
SET survey_id = s.id
FROM Survey s
WHERE r.survey_id IS NULL
  AND r.survey_name = s.name;

UPDATE EMAIL e
SET survey_id = s.id
FROM Survey s
WHERE e.survey_id IS NULL
  AND e.survey_name = s.name;

-- Move active, archived, and demo surveys. Legacy creator fields deliberately
-- remain unchanged/null because the old schema did not record ownership.
UPDATE Survey
SET organization_id = (SELECT id FROM organizations WHERE slug = 'cla')
WHERE organization_id IS DISTINCT FROM (SELECT id FROM organizations WHERE slug = 'cla');

-- Maintain access between the committed data move and deploy-time creation of the
-- explicitly approved CLA owner. These transitional memberships are removed only
-- by the separately gated post-login cleanup.
INSERT INTO organization_memberships (organization_id, user_id, role)
SELECT o.id, u.id, 'owner'
FROM organizations o
CROSS JOIN users u
WHERE o.slug = 'cla'
ON CONFLICT (organization_id, user_id) DO NOTHING;

-- Keep survey-scoped audit records internally consistent without changing their
-- IDs, actors, event types, metadata, or timestamps.
UPDATE audit_events ae
SET organization_id = s.organization_id
FROM Survey s
WHERE ae.survey_id = s.id
  AND ae.organization_id IS DISTINCT FROM s.organization_id;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM Survey s
    CROSS JOIN organizations o
    WHERE o.slug = 'cla'
      AND (s.id IS NULL OR s.organization_id IS DISTINCT FROM o.id)
  ) THEN
    RAISE EXCEPTION 'CLA backfill refused: Survey stable identity or CLA organization assignment is incomplete';
  END IF;
  IF EXISTS (
    SELECT 1 FROM Respondent r
    LEFT JOIN Survey s ON s.id = r.survey_id
    WHERE r.survey_id IS NULL OR s.id IS NULL OR r.survey_name IS DISTINCT FROM s.name
  ) THEN
    RAISE EXCEPTION 'CLA backfill refused: Respondent stable and legacy survey relationships do not reconcile';
  END IF;
  IF EXISTS (
    SELECT 1 FROM EMAIL e
    LEFT JOIN Survey s ON s.id = e.survey_id
    WHERE e.survey_id IS NULL OR s.id IS NULL OR e.survey_name IS DISTINCT FROM s.name
  ) THEN
    RAISE EXCEPTION 'CLA backfill refused: EMAIL stable and legacy survey relationships do not reconcile';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'survey_id_key' AND conrelid = 'survey'::regclass
  ) THEN
    ALTER TABLE Survey ADD CONSTRAINT survey_id_key UNIQUE (id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'respondent_survey_id_fkey' AND conrelid = 'respondent'::regclass
  ) THEN
    ALTER TABLE Respondent
      ADD CONSTRAINT respondent_survey_id_fkey
      FOREIGN KEY (survey_id) REFERENCES Survey(id) NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'email_survey_id_fkey' AND conrelid = 'email'::regclass
  ) THEN
    ALTER TABLE EMAIL
      ADD CONSTRAINT email_survey_id_fkey
      FOREIGN KEY (survey_id) REFERENCES Survey(id) NOT VALID;
  END IF;
END $$;

ALTER TABLE Survey ALTER COLUMN id SET NOT NULL;
ALTER TABLE Survey ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE Respondent ALTER COLUMN survey_id SET NOT NULL;
ALTER TABLE EMAIL ALTER COLUMN survey_id SET NOT NULL;

ALTER TABLE Respondent VALIDATE CONSTRAINT respondent_survey_id_fkey;
ALTER TABLE EMAIL VALIDATE CONSTRAINT email_survey_id_fkey;
