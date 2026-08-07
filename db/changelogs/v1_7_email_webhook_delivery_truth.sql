--liquibase formatted sql

--changeset cladvisors:email-webhook-delivery-truth-preflight-1 splitStatements:false
--comment Refuse a partial Phase 1 foundation before installing the additive webhook schema.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '5min';
DO $$
DECLARE
  required_column TEXT;
BEGIN
  IF current_setting('server_version_num')::INTEGER < 120000 THEN
    RAISE EXCEPTION 'Phase 2 email webhook schema requires PostgreSQL 12 or newer';
  END IF;

  IF to_regclass('survey_email_deliveries') IS NULL
     OR to_regclass('survey_email_attempts') IS NULL
     OR to_regclass('email_worker_control') IS NULL THEN
    RAISE EXCEPTION 'Phase 2 email webhook schema requires the Phase 1 email delivery schema';
  END IF;

  FOREACH required_column IN ARRAY ARRAY[
    'id', 'launch_id', 'to_address', 'status', 'provider_message_id',
    'provider_delivered_at', 'provider_delayed_at', 'provider_bounced_at',
    'provider_complained_at', 'provider_suppressed_at', 'provider_failed_at'
  ] LOOP
    IF NOT EXISTS (
      SELECT 1
      FROM pg_attribute
      WHERE attrelid = 'survey_email_deliveries'::regclass
        AND attname = required_column
        AND attnum > 0
        AND NOT attisdropped
    ) THEN
      RAISE EXCEPTION 'Phase 2 preflight failed: survey_email_deliveries.% is missing', required_column;
    END IF;
  END LOOP;

  IF EXISTS (
    SELECT provider_message_id
    FROM survey_email_deliveries
    WHERE provider_message_id IS NOT NULL
    GROUP BY provider_message_id
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Phase 2 preflight failed: duplicate provider message IDs prevent deterministic correlation';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_index
    WHERE indexrelid = to_regclass('delivery_provider_message_unique')
      AND indrelid = 'survey_email_deliveries'::regclass
      AND indisunique AND indisvalid AND indisready
  ) THEN
    RAISE EXCEPTION 'Phase 2 preflight failed: the valid Phase 1 provider-message unique index is missing';
  END IF;
END $$;

--changeset cladvisors:email-webhook-delivery-projection-1 splitStatements:false
--comment Add only the missing independent provider occurrence used by the Phase 2 projection.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '5min';
ALTER TABLE survey_email_deliveries ADD COLUMN IF NOT EXISTS provider_sent_at TIMESTAMPTZ;

--changeset cladvisors:email-webhook-delivery-projection-indexes-1 runInTransaction:false
--comment Concurrent builds avoid blocking the existing Phase 1 delivery table and self-heal an invalid interrupted build.
SET lock_timeout = '5s';
SET statement_timeout = '5min';
DROP INDEX CONCURRENTLY IF EXISTS delivery_launch_provider_sent;
CREATE INDEX CONCURRENTLY delivery_launch_provider_sent
  ON survey_email_deliveries(launch_id, provider_sent_at)
  WHERE provider_sent_at IS NOT NULL;
DROP INDEX CONCURRENTLY IF EXISTS delivery_launch_provider_delivered;
CREATE INDEX CONCURRENTLY delivery_launch_provider_delivered
  ON survey_email_deliveries(launch_id, provider_delivered_at)
  WHERE provider_delivered_at IS NOT NULL;
DROP INDEX CONCURRENTLY IF EXISTS delivery_launch_provider_delayed;
CREATE INDEX CONCURRENTLY delivery_launch_provider_delayed
  ON survey_email_deliveries(launch_id, provider_delayed_at)
  WHERE provider_delayed_at IS NOT NULL;
DROP INDEX CONCURRENTLY IF EXISTS delivery_launch_provider_bounced;
CREATE INDEX CONCURRENTLY delivery_launch_provider_bounced
  ON survey_email_deliveries(launch_id, provider_bounced_at)
  WHERE provider_bounced_at IS NOT NULL;
DROP INDEX CONCURRENTLY IF EXISTS delivery_launch_provider_complained;
CREATE INDEX CONCURRENTLY delivery_launch_provider_complained
  ON survey_email_deliveries(launch_id, provider_complained_at)
  WHERE provider_complained_at IS NOT NULL;
DROP INDEX CONCURRENTLY IF EXISTS delivery_launch_provider_suppressed;
CREATE INDEX CONCURRENTLY delivery_launch_provider_suppressed
  ON survey_email_deliveries(launch_id, provider_suppressed_at)
  WHERE provider_suppressed_at IS NOT NULL;
DROP INDEX CONCURRENTLY IF EXISTS delivery_launch_provider_failed;
CREATE INDEX CONCURRENTLY delivery_launch_provider_failed
  ON survey_email_deliveries(launch_id, provider_failed_at)
  WHERE provider_failed_at IS NOT NULL;
RESET lock_timeout;
RESET statement_timeout;

--changeset cladvisors:email-webhook-fenced-inbox-1 splitStatements:false
--comment Store verified raw events before acknowledgement; lease fields fence every projector finalization.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '5min';
CREATE TABLE IF NOT EXISTS email_webhook_events (
  id BIGSERIAL PRIMARY KEY,
  provider_account_scope VARCHAR(128) NOT NULL,
  receiving_environment VARCHAR(64) NOT NULL,
  svix_id VARCHAR(255) NOT NULL,
  event_type VARCHAR(128) NOT NULL,
  event_created_at TIMESTAMPTZ NOT NULL,
  provider_message_id VARCHAR(255),
  delivery_tag VARCHAR(256),
  app_tag VARCHAR(256),
  environment_tag VARCHAR(256),
  raw_payload JSONB,
  payload_size_bytes INTEGER NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  payload_expires_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  processing_attempt_count INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TIMESTAMPTZ DEFAULT now(),
  unmatched_since_at TIMESTAMPTZ,
  lease_owner VARCHAR(255),
  lease_token UUID,
  lease_expires_at TIMESTAMPTZ,
  last_error_code VARCHAR(64),
  last_error_message VARCHAR(500),
  correlated_delivery_id UUID REFERENCES survey_email_deliveries(id) ON DELETE RESTRICT,
  processed_at TIMESTAMPTZ,
  dead_lettered_at TIMESTAMPTZ,
  replay_count INTEGER NOT NULL DEFAULT 0,
  last_replayed_at TIMESTAMPTZ,
  last_replayed_by_actor VARCHAR(255),
  last_replay_reason VARCHAR(500),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT email_webhook_event_provider_svix_unique UNIQUE(provider_account_scope, svix_id),
  CONSTRAINT email_webhook_event_status_check CHECK (
    status IN ('pending','leased','retry_wait','processed','unmatched','ignored','dead_letter')
  ),
  CONSTRAINT email_webhook_event_scope_check CHECK (
    provider_account_scope = btrim(provider_account_scope) AND provider_account_scope <> ''
  ),
  CONSTRAINT email_webhook_event_environment_check CHECK (
    receiving_environment = btrim(receiving_environment) AND receiving_environment <> ''
  ),
  CONSTRAINT email_webhook_event_type_check CHECK (event_type = btrim(event_type) AND event_type <> ''),
  CONSTRAINT email_webhook_event_payload_check CHECK (
    payload_size_bytes BETWEEN 2 AND 262144
    AND payload_expires_at >= received_at
  ),
  CONSTRAINT email_webhook_event_attempt_check CHECK (processing_attempt_count >= 0 AND replay_count >= 0),
  CONSTRAINT email_webhook_event_lease_check CHECK (
    (status = 'leased' AND lease_owner IS NOT NULL AND lease_token IS NOT NULL AND lease_expires_at IS NOT NULL)
    OR
    (status <> 'leased' AND lease_owner IS NULL AND lease_token IS NULL AND lease_expires_at IS NULL)
  ),
  CONSTRAINT email_webhook_event_schedule_check CHECK (
    (status IN ('pending','retry_wait','unmatched') AND next_attempt_at IS NOT NULL)
    OR
    (status NOT IN ('pending','retry_wait','unmatched') AND next_attempt_at IS NULL)
  ),
  CONSTRAINT email_webhook_event_terminal_check CHECK (
    (status IN ('processed','ignored') AND processed_at IS NOT NULL AND dead_lettered_at IS NULL)
    OR (status = 'dead_letter' AND dead_lettered_at IS NOT NULL)
    OR (status NOT IN ('processed','ignored','dead_letter') AND processed_at IS NULL AND dead_lettered_at IS NULL)
  ),
  CONSTRAINT email_webhook_event_unmatched_check CHECK (
    (status = 'unmatched' AND unmatched_since_at IS NOT NULL)
    OR status <> 'unmatched'
  ),
  CONSTRAINT email_webhook_event_replay_audit_check CHECK (
    (replay_count = 0 AND last_replayed_at IS NULL AND last_replayed_by_actor IS NULL AND last_replay_reason IS NULL)
    OR (replay_count > 0 AND last_replayed_at IS NOT NULL AND last_replayed_by_actor IS NOT NULL AND last_replay_reason IS NOT NULL)
  )
);
COMMENT ON COLUMN email_webhook_events.raw_payload IS
  'Verified JSON payload, limited to a 256 KiB request; set to NULL after payload_expires_at without deleting deduplication metadata.';
COMMENT ON COLUMN email_webhook_events.delivery_tag IS
  'Bounded untrusted tag text; cast to UUID only after projector validation.';

CREATE INDEX IF NOT EXISTS email_webhook_event_due_work
  ON email_webhook_events(next_attempt_at, id)
  WHERE status IN ('pending','retry_wait','unmatched');
CREATE INDEX IF NOT EXISTS email_webhook_event_expired_lease
  ON email_webhook_events(lease_expires_at, id)
  WHERE status = 'leased';
CREATE INDEX IF NOT EXISTS email_webhook_event_provider_message
  ON email_webhook_events(provider_account_scope, provider_message_id, event_created_at)
  WHERE provider_message_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS email_webhook_event_delivery_tag
  ON email_webhook_events(delivery_tag, event_created_at)
  WHERE delivery_tag IS NOT NULL;
CREATE INDEX IF NOT EXISTS email_webhook_event_correlated_delivery
  ON email_webhook_events(correlated_delivery_id, event_created_at)
  WHERE correlated_delivery_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS email_webhook_event_payload_retention
  ON email_webhook_events(payload_expires_at, id)
  WHERE raw_payload IS NOT NULL;
CREATE INDEX IF NOT EXISTS email_webhook_event_dead_letter
  ON email_webhook_events(dead_lettered_at DESC)
  WHERE status = 'dead_letter';

--changeset cladvisors:email-reason-keyed-suppression-1 splitStatements:false
--comment Keep each suppression cause independent and fail closed after provider removal until the exact cause version is overridden.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '5min';
CREATE TABLE IF NOT EXISTS email_suppressions (
  provider_account_scope VARCHAR(128) NOT NULL,
  normalized_address VARCHAR(320) NOT NULL,
  reason TEXT NOT NULL,
  receiving_environment VARCHAR(64) NOT NULL,
  provider_active BOOLEAN NOT NULL DEFAULT true,
  provider_suppression_id VARCHAR(255),
  source_webhook_event_id BIGINT NOT NULL REFERENCES email_webhook_events(id) ON DELETE RESTRICT,
  source_occurred_at TIMESTAMPTZ NOT NULL,
  state_occurrence_at TIMESTAMPTZ NOT NULL,
  state_event_svix_id VARCHAR(255) NOT NULL,
  state_is_adverse BOOLEAN NOT NULL,
  last_add_occurrence_at TIMESTAMPTZ,
  last_add_event_svix_id VARCHAR(255),
  last_remove_occurrence_at TIMESTAMPTZ,
  last_remove_event_svix_id VARCHAR(255),
  cause_version BIGINT NOT NULL DEFAULT 1,
  locally_overridden_at TIMESTAMPTZ,
  override_cause_version BIGINT,
  locally_overridden_by_actor VARCHAR(255),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY(provider_account_scope, normalized_address, reason),
  CONSTRAINT email_suppression_reason_check CHECK (
    reason IN ('permanent_bounce','complaint','provider_suppression')
  ),
  CONSTRAINT email_suppression_scope_check CHECK (
    provider_account_scope = btrim(provider_account_scope) AND provider_account_scope <> ''
  ),
  CONSTRAINT email_suppression_environment_check CHECK (
    receiving_environment = btrim(receiving_environment) AND receiving_environment <> ''
  ),
  CONSTRAINT email_suppression_address_check CHECK (
    normalized_address = lower(btrim(normalized_address))
    AND normalized_address <> ''
    AND position('@' IN normalized_address) > 1
  ),
  CONSTRAINT email_suppression_version_check CHECK (cause_version > 0),
  CONSTRAINT email_suppression_state_check CHECK (provider_active = state_is_adverse),
  CONSTRAINT email_suppression_add_check CHECK (
    (last_add_occurrence_at IS NULL) = (last_add_event_svix_id IS NULL)
    AND (NOT provider_active OR last_add_occurrence_at IS NOT NULL)
  ),
  CONSTRAINT email_suppression_remove_check CHECK (
    (last_remove_occurrence_at IS NULL) = (last_remove_event_svix_id IS NULL)
  ),
  CONSTRAINT email_suppression_override_check CHECK (
    (locally_overridden_at IS NULL AND override_cause_version IS NULL AND locally_overridden_by_actor IS NULL)
    OR
    (locally_overridden_at IS NOT NULL AND override_cause_version = cause_version
      AND locally_overridden_by_actor IS NOT NULL AND provider_active = false)
  )
);
COMMENT ON TABLE email_suppressions IS
  'One independently versioned cause per provider account and normalized address; effective blocking is provider_active OR no exact-version local override.';

CREATE INDEX IF NOT EXISTS email_suppression_effective_lookup
  ON email_suppressions(provider_account_scope, normalized_address)
  WHERE provider_active OR locally_overridden_at IS NULL;
CREATE INDEX IF NOT EXISTS email_suppression_source_event
  ON email_suppressions(source_webhook_event_id);
CREATE INDEX IF NOT EXISTS email_suppression_updated
  ON email_suppressions(updated_at DESC);

CREATE TABLE IF NOT EXISTS email_suppression_audit (
  id BIGSERIAL PRIMARY KEY,
  provider_account_scope VARCHAR(128) NOT NULL,
  normalized_address VARCHAR(320) NOT NULL,
  reason TEXT NOT NULL,
  receiving_environment VARCHAR(64) NOT NULL,
  action TEXT NOT NULL,
  cause_version BIGINT NOT NULL,
  provider_active BOOLEAN NOT NULL,
  occurrence_at TIMESTAMPTZ NOT NULL,
  source_webhook_event_id BIGINT REFERENCES email_webhook_events(id) ON DELETE RESTRICT,
  source_event_svix_id VARCHAR(255),
  provider_suppression_id VARCHAR(255),
  actor VARCHAR(255),
  detail JSONB NOT NULL DEFAULT '{}'::jsonb,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT email_suppression_audit_reason_check CHECK (
    reason IN ('permanent_bounce','complaint','provider_suppression')
  ),
  CONSTRAINT email_suppression_audit_action_check CHECK (
    action IN ('adverse_add','provider_remove','local_override','stale_event_ignored')
  ),
  CONSTRAINT email_suppression_audit_address_check CHECK (
    normalized_address = lower(btrim(normalized_address)) AND normalized_address <> ''
  ),
  CONSTRAINT email_suppression_audit_environment_check CHECK (
    receiving_environment = btrim(receiving_environment) AND receiving_environment <> ''
  ),
  CONSTRAINT email_suppression_audit_version_check CHECK (cause_version > 0),
  CONSTRAINT email_suppression_audit_actor_check CHECK (
    action <> 'local_override' OR actor IS NOT NULL
  )
);
CREATE INDEX IF NOT EXISTS email_suppression_audit_cause
  ON email_suppression_audit(provider_account_scope, normalized_address, reason, recorded_at DESC);
CREATE INDEX IF NOT EXISTS email_suppression_audit_source
  ON email_suppression_audit(source_webhook_event_id)
  WHERE source_webhook_event_id IS NOT NULL;

--changeset cladvisors:email-webhook-operational-controls-1 splitStatements:false
--comment Add revision-fenced processing, suppression, registration, and global sending controls plus exact-release heartbeats.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '5min';
CREATE TABLE IF NOT EXISTS email_webhook_worker_control (
  environment VARCHAR(64) PRIMARY KEY,
  claiming_enabled BOOLEAN NOT NULL DEFAULT false,
  processing_enabled BOOLEAN NOT NULL DEFAULT false,
  minimum_release VARCHAR(255) NOT NULL DEFAULT '',
  release_revision VARCHAR(255) NOT NULL DEFAULT '',
  control_revision BIGINT NOT NULL DEFAULT 0 CHECK (control_revision >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by_actor VARCHAR(255),
  reason VARCHAR(500),
  CHECK (environment = btrim(environment) AND environment <> '')
);

CREATE TABLE IF NOT EXISTS email_webhook_worker_heartbeats (
  environment VARCHAR(64) NOT NULL,
  worker_instance VARCHAR(255) NOT NULL,
  release_revision VARCHAR(255) NOT NULL,
  enabled BOOLEAN NOT NULL,
  claiming BOOLEAN NOT NULL,
  processing BOOLEAN NOT NULL,
  heartbeat_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_error_code VARCHAR(64),
  last_error VARCHAR(500),
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY(environment, worker_instance),
  CHECK (environment = btrim(environment) AND environment <> ''),
  CHECK (worker_instance = btrim(worker_instance) AND worker_instance <> ''),
  CHECK (release_revision = btrim(release_revision) AND release_revision <> ''),
  CHECK (heartbeat_at >= started_at)
);
CREATE INDEX IF NOT EXISTS email_webhook_worker_heartbeat_fresh
  ON email_webhook_worker_heartbeats(environment, heartbeat_at DESC);
CREATE INDEX IF NOT EXISTS email_webhook_worker_release_fresh
  ON email_webhook_worker_heartbeats(environment, release_revision, heartbeat_at DESC);

CREATE TABLE IF NOT EXISTS email_suppression_control (
  environment VARCHAR(64) PRIMARY KEY,
  enforcement_enabled BOOLEAN NOT NULL DEFAULT false,
  activated_at TIMESTAMPTZ,
  activated_by_actor VARCHAR(255),
  activation_release VARCHAR(255),
  minimum_release VARCHAR(255) NOT NULL DEFAULT '',
  control_revision BIGINT NOT NULL DEFAULT 0 CHECK (control_revision >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by_actor VARCHAR(255),
  reason VARCHAR(500),
  CHECK (environment = btrim(environment) AND environment <> ''),
  CHECK (
    (activated_at IS NULL AND activated_by_actor IS NULL AND activation_release IS NULL AND enforcement_enabled = false)
    OR
    (activated_at IS NOT NULL AND activated_by_actor IS NOT NULL AND activation_release IS NOT NULL)
  )
);

CREATE TABLE IF NOT EXISTS email_sending_control (
  environment VARCHAR(64) PRIMARY KEY,
  sending_enabled BOOLEAN NOT NULL DEFAULT false,
  minimum_release VARCHAR(255) NOT NULL DEFAULT '',
  control_revision BIGINT NOT NULL DEFAULT 0 CHECK (control_revision >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by_actor VARCHAR(255),
  reason VARCHAR(500),
  CHECK (environment = btrim(environment) AND environment <> '')
);

CREATE TABLE IF NOT EXISTS email_webhook_registration_control (
  environment VARCHAR(64) PRIMARY KEY,
  provider_account_scope VARCHAR(128) NOT NULL,
  endpoint_id VARCHAR(255),
  endpoint_state TEXT NOT NULL DEFAULT 'unregistered',
  previous_endpoint_id VARCHAR(255),
  previous_endpoint_state TEXT,
  previous_secret_parameter_version BIGINT,
  endpoint_url_hash VARCHAR(128),
  event_set_hash VARCHAR(128) NOT NULL,
  operation_id UUID NOT NULL,
  pre_operation_endpoint_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  secret_parameter_version BIGINT,
  ingestion_required BOOLEAN NOT NULL DEFAULT false,
  minimum_ingest_release VARCHAR(255) NOT NULL DEFAULT '',
  control_revision BIGINT NOT NULL DEFAULT 0 CHECK (control_revision >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by_actor VARCHAR(255) NOT NULL,
  reason VARCHAR(500),
  CHECK (environment = btrim(environment) AND environment <> ''),
  CHECK (provider_account_scope = btrim(provider_account_scope) AND provider_account_scope <> ''),
  CHECK (endpoint_state IN ('unregistered','bootstrap_disabled','enable_pending','enabled','disabled','deleted','recovery_required','rotation_required','rotation_disabled')),
  CHECK (previous_endpoint_state IS NULL OR previous_endpoint_state IN ('enabled','disabled')),
  CHECK (jsonb_typeof(pre_operation_endpoint_ids) = 'array'),
  CHECK (secret_parameter_version IS NULL OR secret_parameter_version > 0),
  CHECK (previous_secret_parameter_version IS NULL OR previous_secret_parameter_version > 0),
  CHECK (endpoint_state IN ('unregistered','deleted','recovery_required') OR endpoint_id IS NOT NULL),
  CHECK (NOT ingestion_required OR endpoint_state IN ('bootstrap_disabled','enable_pending','enabled','disabled','rotation_required','rotation_disabled'))
);

CREATE TABLE IF NOT EXISTS email_control_audit (
  id BIGSERIAL PRIMARY KEY,
  environment VARCHAR(64) NOT NULL,
  control_name TEXT NOT NULL,
  control_revision BIGINT NOT NULL CHECK (control_revision >= 0),
  operation_id UUID,
  previous_value JSONB,
  new_value JSONB NOT NULL,
  actor VARCHAR(255) NOT NULL,
  reason VARCHAR(500) NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (environment = btrim(environment) AND environment <> ''),
  CHECK (control_name IN ('webhook_processing','suppression_enforcement','email_sending','webhook_registration')),
  CHECK (previous_value IS NULL OR jsonb_typeof(previous_value) = 'object'),
  CHECK (jsonb_typeof(new_value) = 'object'),
  UNIQUE(environment, control_name, control_revision)
);
CREATE INDEX IF NOT EXISTS email_control_audit_recorded
  ON email_control_audit(environment, recorded_at DESC);

INSERT INTO email_webhook_worker_control(environment, claiming_enabled, processing_enabled)
VALUES ('local',false,false),('test',false,false),('staging',false,false),('prod',false,false)
ON CONFLICT (environment) DO NOTHING;
INSERT INTO email_suppression_control(environment, enforcement_enabled)
VALUES ('local',false),('test',false),('staging',false),('prod',false)
ON CONFLICT (environment) DO NOTHING;
INSERT INTO email_sending_control(environment, sending_enabled)
VALUES ('local',true),('test',true),('staging',false),('prod',false)
ON CONFLICT (environment) DO NOTHING;

--changeset cladvisors:email-webhook-canary-state-1 splitStatements:false
--comment A singleton per environment schedules and fences the six-hour real-provider webhook canary.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '5min';
CREATE TABLE IF NOT EXISTS email_webhook_canary_state (
  environment VARCHAR(64) PRIMARY KEY,
  provider_account_scope VARCHAR(128) NOT NULL,
  status TEXT NOT NULL DEFAULT 'idle',
  canary_token UUID,
  scheduled_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  next_run_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  attempt_count INTEGER NOT NULL DEFAULT 0,
  lease_owner VARCHAR(255),
  lease_token UUID,
  lease_expires_at TIMESTAMPTZ,
  provider_started_at TIMESTAMPTZ,
  provider_message_id VARCHAR(255),
  sent_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  correlated_webhook_event_id BIGINT REFERENCES email_webhook_events(id) ON DELETE RESTRICT,
  completed_at TIMESTAMPTZ,
  last_success_at TIMESTAMPTZ,
  last_error_code VARCHAR(64),
  last_error_message VARCHAR(500),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (environment = btrim(environment) AND environment <> ''),
  CHECK (provider_account_scope = btrim(provider_account_scope) AND provider_account_scope <> ''),
  CHECK (status IN ('idle','leased','sending','awaiting_webhook','retry_wait','failed')),
  CHECK (attempt_count >= 0),
  CHECK (
    (status IN ('leased','sending') AND lease_owner IS NOT NULL AND lease_token IS NOT NULL AND lease_expires_at IS NOT NULL)
    OR
    (status NOT IN ('leased','sending') AND lease_owner IS NULL AND lease_token IS NULL AND lease_expires_at IS NULL)
  ),
  CHECK (provider_started_at IS NULL OR status IN ('sending','awaiting_webhook','retry_wait','failed','idle')),
  CHECK (delivered_at IS NULL OR sent_at IS NOT NULL),
  CHECK (completed_at IS NULL OR delivered_at IS NOT NULL),
  CHECK (correlated_webhook_event_id IS NULL OR canary_token IS NOT NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS email_webhook_canary_token_unique
  ON email_webhook_canary_state(canary_token)
  WHERE canary_token IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS email_webhook_canary_provider_message_unique
  ON email_webhook_canary_state(provider_message_id)
  WHERE provider_message_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS email_webhook_canary_due
  ON email_webhook_canary_state(next_run_at, environment)
  WHERE status IN ('idle','retry_wait');
CREATE INDEX IF NOT EXISTS email_webhook_canary_expired_lease
  ON email_webhook_canary_state(lease_expires_at, environment)
  WHERE status IN ('leased','sending');
CREATE INDEX IF NOT EXISTS email_webhook_canary_last_success
  ON email_webhook_canary_state(environment, last_success_at DESC);

--changeset cladvisors:email-phase2-append-only-guards-1 splitStatements:false
--comment Enforce immutable operator and suppression history at the database boundary.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '5min';
CREATE OR REPLACE FUNCTION reject_email_phase2_audit_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION '% is append-only; % is not permitted', TG_TABLE_NAME, TG_OP;
END;
$$;

DROP TRIGGER IF EXISTS email_suppression_audit_append_only ON email_suppression_audit;
CREATE TRIGGER email_suppression_audit_append_only
BEFORE UPDATE OR DELETE ON email_suppression_audit
FOR EACH ROW EXECUTE FUNCTION reject_email_phase2_audit_mutation();

DROP TRIGGER IF EXISTS email_control_audit_append_only ON email_control_audit;
CREATE TRIGGER email_control_audit_append_only
BEFORE UPDATE OR DELETE ON email_control_audit
FOR EACH ROW EXECUTE FUNCTION reject_email_phase2_audit_mutation();

CREATE OR REPLACE FUNCTION enforce_suppression_control_latch()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.enforcement_enabled
     AND NOT NEW.enforcement_enabled
     AND EXISTS (
       SELECT 1 FROM email_sending_control
       WHERE environment = OLD.environment AND sending_enabled
     ) THEN
    RAISE EXCEPTION 'cannot disable suppression enforcement while email sending is enabled for %', OLD.environment;
  END IF;

  IF OLD.activated_at IS NOT NULL AND (
       NEW.activated_at IS DISTINCT FROM OLD.activated_at
       OR NEW.activated_by_actor IS DISTINCT FROM OLD.activated_by_actor
       OR NEW.activation_release IS DISTINCT FROM OLD.activation_release
     ) THEN
    RAISE EXCEPTION 'suppression activation evidence is immutable for %', OLD.environment;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS email_suppression_control_latch ON email_suppression_control;
CREATE TRIGGER email_suppression_control_latch
BEFORE UPDATE ON email_suppression_control
FOR EACH ROW EXECUTE FUNCTION enforce_suppression_control_latch();

CREATE OR REPLACE FUNCTION enforce_email_sending_suppression_latch()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.sending_enabled
     AND NOT OLD.sending_enabled
     AND EXISTS (
       SELECT 1
       FROM email_suppression_control
       WHERE environment = NEW.environment
         AND activated_at IS NOT NULL
         AND NOT enforcement_enabled
     ) THEN
    RAISE EXCEPTION 'cannot enable email sending without activated suppression enforcement for %', NEW.environment;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS email_sending_suppression_latch ON email_sending_control;
CREATE TRIGGER email_sending_suppression_latch
BEFORE UPDATE ON email_sending_control
FOR EACH ROW EXECUTE FUNCTION enforce_email_sending_suppression_latch();
