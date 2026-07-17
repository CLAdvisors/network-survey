--liquibase formatted sql

--changeset cladvisors:product-iam-remaining-1 splitStatements:false
--comment Additive IAM/account management, audit, invite/reset, and survey identifier foundation.
ALTER TABLE Survey ADD COLUMN IF NOT EXISTS display_name TEXT;
ALTER TABLE Survey ADD COLUMN IF NOT EXISTS slug TEXT;
UPDATE Survey SET display_name = name WHERE display_name IS NULL;
UPDATE Survey SET slug = lower(regexp_replace(name, '[^a-zA-Z0-9]+', '-', 'g')) WHERE slug IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_survey_org_slug_active ON Survey (organization_id, slug) WHERE archived_at IS NULL AND organization_id IS NOT NULL AND slug IS NOT NULL;

CREATE TABLE IF NOT EXISTS audit_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NULL REFERENCES organizations(id),
    actor_user_id INT NULL REFERENCES users(id),
    target_user_id INT NULL REFERENCES users(id),
    survey_id UUID NULL,
    event_type TEXT NOT NULL,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_audit_events_org_created ON audit_events (organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_events_actor_created ON audit_events (actor_user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS organization_invites (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id),
    email CITEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'editor', 'analyst', 'viewer')),
    token_hash TEXT NOT NULL UNIQUE,
    expires_at TIMESTAMP NOT NULL,
    accepted_at TIMESTAMP NULL,
    accepted_by_user_id INT NULL REFERENCES users(id),
    created_by_user_id INT NOT NULL REFERENCES users(id),
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_org_invites_org_email ON organization_invites (organization_id, email);

CREATE TABLE IF NOT EXISTS password_reset_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id INT NOT NULL REFERENCES users(id),
    token_hash TEXT NOT NULL UNIQUE,
    expires_at TIMESTAMP NOT NULL,
    used_at TIMESTAMP NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_password_reset_user_created ON password_reset_tokens (user_id, created_at DESC);
