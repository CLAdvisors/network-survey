--liquibase formatted sql

--changeset cladvisors:reminder-provider-account-binding-1 splitStatements:false
--comment Snapshot reminder provider account scope, keep legacy null rows safely inert, and support scope-bound claims and webhook correlation.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '5min';
ALTER TABLE survey_launches ADD COLUMN provider_account_scope VARCHAR(128);
ALTER TABLE survey_launches ADD CONSTRAINT survey_launches_provider_account_scope_check CHECK (
  provider_account_scope IS NULL OR
  (provider_account_scope = btrim(provider_account_scope) AND provider_account_scope <> '')
);
ALTER TABLE survey_launches ADD CONSTRAINT survey_launches_initial_provider_account_scope_check CHECK (
  kind <> 'initial' OR provider_account_scope IS NULL
);
CREATE INDEX survey_launches_reminder_provider_scope
  ON survey_launches(provider_account_scope, id)
  WHERE kind = 'reminder';
COMMENT ON COLUMN survey_launches.provider_account_scope IS 'Immutable provider account snapshot for reminder sends. Null is reserved for initial launches and reminders created before provider binding.';
CREATE FUNCTION prevent_survey_launch_provider_scope_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.provider_account_scope IS DISTINCT FROM OLD.provider_account_scope THEN
    RAISE EXCEPTION 'survey launch provider_account_scope is immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER survey_launch_provider_scope_immutable
  BEFORE UPDATE OF provider_account_scope ON survey_launches
  FOR EACH ROW EXECUTE FUNCTION prevent_survey_launch_provider_scope_change();
CREATE FUNCTION require_reminder_launch_provider_scope() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.kind = 'reminder' AND NEW.provider_account_scope IS NULL THEN
    RAISE EXCEPTION 'new reminder launches require provider_account_scope' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER survey_launch_provider_scope_required
  BEFORE INSERT OR UPDATE OF kind ON survey_launches
  FOR EACH ROW EXECUTE FUNCTION require_reminder_launch_provider_scope();
