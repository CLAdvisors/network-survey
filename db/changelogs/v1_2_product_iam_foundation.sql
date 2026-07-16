-- Product IAM Phase 2 foundation schema.
-- Additive/backward-compatible only: no table/column drops, no primary-key changes,
-- and legacy Survey.name / Respondent.survey_name / EMAIL.survey_name remain in place.

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS citext;

CREATE TABLE IF NOT EXISTS organizations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    slug TEXT UNIQUE,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    archived_at TIMESTAMP
);

ALTER TABLE users ADD COLUMN IF NOT EXISTS email CITEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS display_name TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active';
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_platform_admin BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMP;
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_changed_at TIMESTAMP;
ALTER TABLE users ADD COLUMN IF NOT EXISTS created_by_user_id INT;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'users_status_check'
          AND conrelid = 'users'::regclass
    ) THEN
        ALTER TABLE users ADD CONSTRAINT users_status_check
            CHECK (status IN ('invited', 'active', 'disabled'));
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'users_created_by_user_id_fkey'
          AND conrelid = 'users'::regclass
    ) THEN
        ALTER TABLE users ADD CONSTRAINT users_created_by_user_id_fkey
            FOREIGN KEY (created_by_user_id) REFERENCES users(id);
    END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_unique ON users(email) WHERE email IS NOT NULL;

CREATE TABLE IF NOT EXISTS organization_memberships (
    organization_id UUID NOT NULL REFERENCES organizations(id),
    user_id INT NOT NULL REFERENCES users(id),
    role TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'editor', 'analyst', 'viewer')),
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_by_user_id INT REFERENCES users(id),
    PRIMARY KEY (organization_id, user_id)
);

-- Add Survey.id in phases to avoid the table rewrite/locking risk of ADD COLUMN ... DEFAULT
-- on older PostgreSQL versions. Existing rows are backfilled before the default is attached.
ALTER TABLE Survey ADD COLUMN IF NOT EXISTS id UUID;
UPDATE Survey SET id = gen_random_uuid() WHERE id IS NULL;
ALTER TABLE Survey ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE Survey ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id);
ALTER TABLE Survey ADD COLUMN IF NOT EXISTS created_by_user_id INT REFERENCES users(id);

ALTER TABLE Respondent ADD COLUMN IF NOT EXISTS survey_id UUID;
ALTER TABLE EMAIL ADD COLUMN IF NOT EXISTS survey_id UUID;

-- Ensure future foreign keys can target the new stable Survey.id without changing the legacy primary key yet.
CREATE UNIQUE INDEX IF NOT EXISTS idx_survey_id_unique ON Survey(id) WHERE id IS NOT NULL;

-- Bootstrap all existing data into a neutral imported organization. All existing users are
-- granted owner in this default org because existing accounts previously had global access;
-- Phase 3 will introduce org-scoped authorization and role tightening.
INSERT INTO organizations (name, slug)
VALUES ('Default / Imported', 'default-imported')
ON CONFLICT (slug) DO UPDATE SET updated_at = CURRENT_TIMESTAMP;

UPDATE Survey
SET organization_id = (SELECT id FROM organizations WHERE slug = 'default-imported')
WHERE organization_id IS NULL;

-- Defensive backfill in case this migration is rerun after a partially-applied local attempt.
UPDATE Survey SET id = gen_random_uuid() WHERE id IS NULL;

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

INSERT INTO organization_memberships (organization_id, user_id, role)
SELECT o.id, u.id, 'owner'
FROM organizations o
CROSS JOIN users u
WHERE o.slug = 'default-imported'
ON CONFLICT (organization_id, user_id) DO NOTHING;

CREATE INDEX IF NOT EXISTS idx_survey_org_name ON Survey(organization_id, name);
CREATE INDEX IF NOT EXISTS idx_respondent_survey_id ON Respondent(survey_id);
CREATE INDEX IF NOT EXISTS idx_respondent_survey_uuid ON Respondent(survey_id, uuid);
CREATE INDEX IF NOT EXISTS idx_email_survey_lang ON EMAIL(survey_id, lang);
CREATE INDEX IF NOT EXISTS idx_org_memberships_user ON organization_memberships(user_id);
CREATE INDEX IF NOT EXISTS idx_org_memberships_org ON organization_memberships(organization_id);
CREATE INDEX IF NOT EXISTS idx_organizations_name ON organizations(name);
