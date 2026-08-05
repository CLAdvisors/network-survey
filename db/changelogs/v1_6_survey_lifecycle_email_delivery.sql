--liquibase formatted sql

--changeset cladvisors:survey-lifecycle-preflight-1 splitStatements:false
--comment Preflight stable IDs and tenant ownership before adding durable lifecycle history.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '5min';
DO $$
BEGIN
  IF EXISTS (SELECT id FROM survey GROUP BY id HAVING id IS NULL OR count(*) > 1) THEN
    RAISE EXCEPTION 'Survey.id preflight failed: null or duplicate IDs';
  END IF;
  IF EXISTS (SELECT 1 FROM survey WHERE organization_id IS NULL) THEN
    RAISE EXCEPTION 'Survey.organization_id preflight failed: null tenant';
  END IF;
  IF EXISTS (SELECT 1 FROM respondent r LEFT JOIN survey s ON s.id = r.survey_id WHERE r.survey_id IS NULL OR s.id IS NULL) THEN
    RAISE EXCEPTION 'Respondent.survey_id preflight failed: null/orphan rows';
  END IF;
  IF EXISTS (SELECT 1 FROM email e LEFT JOIN survey s ON s.id = e.survey_id WHERE e.survey_id IS NULL OR s.id IS NULL) THEN
    RAISE EXCEPTION 'Email.survey_id preflight failed: null/orphan rows';
  END IF;
  IF EXISTS (SELECT 1 FROM respondent r JOIN survey s ON s.id=r.survey_id WHERE r.survey_name IS DISTINCT FROM s.name) THEN
    RAISE WARNING 'Legacy respondent survey names differ from authoritative stable IDs';
  END IF;
  IF EXISTS (SELECT 1 FROM email e JOIN survey s ON s.id=e.survey_id WHERE e.survey_name IS DISTINCT FROM s.name) THEN
    RAISE WARNING 'Legacy email survey names differ from authoritative stable IDs';
  END IF;
END $$;
ALTER TABLE survey ADD CONSTRAINT survey_id_not_null_check CHECK (id IS NOT NULL) NOT VALID;
ALTER TABLE survey VALIDATE CONSTRAINT survey_id_not_null_check;
ALTER TABLE survey ADD CONSTRAINT survey_organization_not_null_check CHECK (organization_id IS NOT NULL) NOT VALID;
ALTER TABLE survey VALIDATE CONSTRAINT survey_organization_not_null_check;
ALTER TABLE respondent ADD CONSTRAINT respondent_survey_not_null_check CHECK (survey_id IS NOT NULL) NOT VALID;
ALTER TABLE respondent VALIDATE CONSTRAINT respondent_survey_not_null_check;

--changeset cladvisors:survey-stable-id-index-1 runInTransaction:false
--comment Drop any valid or invalid leftover build before recreating the stable-ID index; reruns after a failed concurrent build are self-healing.
SET lock_timeout = '5s';
SET statement_timeout = '5min';
DROP INDEX CONCURRENTLY IF EXISTS idx_survey_id_full;
CREATE UNIQUE INDEX CONCURRENTLY idx_survey_id_full ON survey(id);
RESET lock_timeout;
RESET statement_timeout;

--changeset cladvisors:survey-tenant-key-index-1 runInTransaction:false
SET lock_timeout = '5s';
SET statement_timeout = '5min';
DROP INDEX CONCURRENTLY IF EXISTS idx_survey_id_org_unique;
CREATE UNIQUE INDEX CONCURRENTLY idx_survey_id_org_unique ON survey(id, organization_id);
RESET lock_timeout;
RESET statement_timeout;

--changeset cladvisors:respondent-survey-key-index-1 runInTransaction:false
SET lock_timeout = '5s';
SET statement_timeout = '5min';
DROP INDEX CONCURRENTLY IF EXISTS idx_respondent_id_survey_unique;
CREATE UNIQUE INDEX CONCURRENTLY idx_respondent_id_survey_unique ON respondent(respondent_id, survey_id);
RESET lock_timeout;
RESET statement_timeout;

--changeset cladvisors:survey-stable-id-constraints-1 splitStatements:false
--comment Brief-lock promotion of stable IDs and tenant candidate keys.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
ALTER TABLE survey ALTER COLUMN id SET NOT NULL;
ALTER TABLE survey ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE respondent ALTER COLUMN survey_id SET NOT NULL;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='survey_id_key' AND conrelid='survey'::regclass) THEN
    ALTER TABLE survey ADD CONSTRAINT survey_id_key UNIQUE USING INDEX idx_survey_id_full;
  END IF;
END $$;
ALTER TABLE survey DROP CONSTRAINT IF EXISTS survey_id_not_null_check;
ALTER TABLE survey DROP CONSTRAINT IF EXISTS survey_organization_not_null_check;
ALTER TABLE respondent DROP CONSTRAINT IF EXISTS respondent_survey_not_null_check;
DROP INDEX IF EXISTS idx_survey_id_unique;

--changeset cladvisors:survey-lifecycle-columns-1 splitStatements:false
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '5min';
ALTER TABLE survey ADD COLUMN IF NOT EXISTS lifecycle_status TEXT NOT NULL DEFAULT 'draft';
ALTER TABLE survey ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ;
ALTER TABLE survey ADD COLUMN IF NOT EXISTS started_by_user_id INTEGER REFERENCES users(id);
ALTER TABLE survey ADD COLUMN IF NOT EXISTS closed_at TIMESTAMPTZ;
ALTER TABLE survey ADD COLUMN IF NOT EXISTS closed_by_user_id INTEGER REFERENCES users(id);
ALTER TABLE survey ADD COLUMN IF NOT EXISTS lifecycle_version INTEGER NOT NULL DEFAULT 0;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='survey_lifecycle_status_check' AND conrelid='survey'::regclass) THEN
    ALTER TABLE survey ADD CONSTRAINT survey_lifecycle_status_check CHECK (lifecycle_status IN ('draft','active','closed'));
  END IF;
END $$;
-- Preserve known live legacy links without inventing launch history.
UPDATE survey s SET lifecycle_status = CASE
  WHEN s.archived_at IS NOT NULL THEN 'closed'
  WHEN EXISTS (SELECT 1 FROM respondent r WHERE r.survey_id=s.id AND (r.response IS NOT NULL OR r.email_sent=true)) THEN 'active'
  ELSE 'draft' END;
CREATE INDEX IF NOT EXISTS idx_survey_org_lifecycle ON survey(organization_id, lifecycle_status) WHERE archived_at IS NULL;

--changeset cladvisors:survey-delivery-tables-1 splitStatements:false
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '5min';
CREATE TABLE survey_launches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  survey_id UUID NOT NULL,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  kind TEXT NOT NULL CHECK (kind IN ('initial','reminder','retry_failed')),
  parent_launch_id UUID,
  idempotency_key TEXT NOT NULL,
  request_fingerprint TEXT NOT NULL,
  requested_by_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  cancelled_at TIMESTAMPTZ,
  CONSTRAINT survey_launch_survey_fk FOREIGN KEY (survey_id,organization_id) REFERENCES survey(id,organization_id) ON DELETE RESTRICT,
  CONSTRAINT survey_launch_id_scope_unique UNIQUE(id,survey_id,organization_id),
  CONSTRAINT survey_launch_idempotency_unique UNIQUE(organization_id,idempotency_key)
);
ALTER TABLE survey_launches ADD CONSTRAINT survey_launch_parent_fk
  FOREIGN KEY(parent_launch_id,survey_id,organization_id) REFERENCES survey_launches(id,survey_id,organization_id) ON DELETE RESTRICT;
CREATE UNIQUE INDEX survey_launch_one_initial ON survey_launches(survey_id) WHERE kind='initial';
CREATE INDEX survey_launch_survey_created ON survey_launches(survey_id,created_at DESC);
CREATE INDEX survey_launch_org_created ON survey_launches(organization_id,created_at DESC);

CREATE TABLE survey_launch_templates (
  launch_id UUID NOT NULL REFERENCES survey_launches(id) ON DELETE RESTRICT,
  language TEXT NOT NULL,
  subject TEXT NOT NULL,
  body_text TEXT NOT NULL,
  template_hash TEXT,
  PRIMARY KEY(launch_id,language),
  CHECK (language=lower(btrim(language)) AND language<>''),
  CHECK (btrim(subject)<>'' AND btrim(body_text)<>'')
);

CREATE TABLE survey_email_deliveries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  launch_id UUID NOT NULL,
  survey_id UUID NOT NULL,
  organization_id UUID NOT NULL,
  respondent_id INTEGER NOT NULL,
  to_address TEXT NOT NULL,
  recipient_display_name TEXT,
  language TEXT NOT NULL,
  sender TEXT NOT NULL,
  subject TEXT NOT NULL,
  template_hash TEXT NOT NULL,
  survey_base_url TEXT NOT NULL,
  renderer_version TEXT NOT NULL,
  render_inputs JSONB NOT NULL DEFAULT '{}'::jsonb,
  expected_payload_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','leased','retry_wait','accepted','failed','uncertain','cancelled')),
  provider_message_id TEXT,
  provider_idempotency_key TEXT NOT NULL UNIQUE,
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK(attempt_count>=0),
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  lease_owner TEXT,
  lease_token UUID,
  lease_expires_at TIMESTAMPTZ,
  cancellation_requested_at TIMESTAMPTZ,
  dispatch_accepted_at TIMESTAMPTZ,
  dispatch_failed_at TIMESTAMPTZ,
  provider_delivered_at TIMESTAMPTZ,
  provider_delayed_at TIMESTAMPTZ,
  provider_bounced_at TIMESTAMPTZ,
  provider_complained_at TIMESTAMPTZ,
  provider_suppressed_at TIMESTAMPTZ,
  provider_failed_at TIMESTAMPTZ,
  last_error_code TEXT,
  last_error_message VARCHAR(500),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT delivery_launch_scope_fk FOREIGN KEY(launch_id,survey_id,organization_id) REFERENCES survey_launches(id,survey_id,organization_id) ON DELETE RESTRICT,
  CONSTRAINT delivery_respondent_survey_fk FOREIGN KEY(respondent_id,survey_id) REFERENCES respondent(respondent_id,survey_id) ON DELETE RESTRICT,
  CONSTRAINT delivery_launch_respondent_unique UNIQUE(launch_id,respondent_id),
  CHECK(language=lower(btrim(language)) AND language<>'')
);
CREATE UNIQUE INDEX delivery_provider_message_unique ON survey_email_deliveries(provider_message_id) WHERE provider_message_id IS NOT NULL;
CREATE INDEX delivery_due_work ON survey_email_deliveries(next_attempt_at) WHERE status IN ('pending','retry_wait');
CREATE INDEX delivery_reclaim ON survey_email_deliveries(lease_expires_at) WHERE status='leased';
CREATE INDEX delivery_survey_created ON survey_email_deliveries(survey_id,created_at DESC);
CREATE INDEX delivery_respondent_created ON survey_email_deliveries(respondent_id,created_at DESC);

CREATE TABLE survey_email_attempts (
  id BIGSERIAL PRIMARY KEY,
  delivery_id UUID NOT NULL REFERENCES survey_email_deliveries(id) ON DELETE RESTRICT,
  attempt_number INTEGER NOT NULL CHECK(attempt_number>0),
  lease_token UUID NOT NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  provider_started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  outcome TEXT NOT NULL DEFAULT 'in_progress' CHECK(outcome IN ('in_progress','accepted','transient_failure','permanent_failure','uncertain','cancelled')),
  provider_code TEXT,
  error_message VARCHAR(500),
  provider_message_id TEXT,
  UNIQUE(delivery_id,attempt_number)
);
CREATE INDEX survey_email_attempt_delivery_started ON survey_email_attempts(delivery_id,started_at DESC);

CREATE TABLE email_worker_control (
  environment TEXT PRIMARY KEY,
  claiming_enabled BOOLEAN NOT NULL DEFAULT false,
  minimum_release TEXT NOT NULL DEFAULT '',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by_user_id INTEGER REFERENCES users(id),
  reason VARCHAR(500)
);
INSERT INTO email_worker_control(environment,claiming_enabled,minimum_release)
VALUES ('local',true,''),('test',true,''),('staging',false,''),('prod',false,'') ON CONFLICT DO NOTHING;

CREATE TABLE email_worker_heartbeats (
  environment TEXT NOT NULL,
  worker_instance TEXT NOT NULL,
  release_revision TEXT NOT NULL,
  enabled BOOLEAN NOT NULL,
  claiming BOOLEAN NOT NULL,
  heartbeat_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_error VARCHAR(500),
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY(environment,worker_instance)
);
CREATE INDEX email_worker_heartbeat_fresh ON email_worker_heartbeats(environment,heartbeat_at DESC);

CREATE TABLE email_rate_reservations (
  id BIGSERIAL PRIMARY KEY,
  environment TEXT NOT NULL,
  reserved_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_email_rate_reservations_budget_time ON email_rate_reservations(environment,reserved_at);
COMMENT ON COLUMN respondent.email_sent IS 'Legacy assumed-provider-accepted flag; not delivery truth. Dual-written only after provider acceptance.';
