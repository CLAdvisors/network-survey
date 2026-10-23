--liquibase formatted sql
--changeset cladvisors:delivery-schedules-1
CREATE TABLE survey_delivery_schedules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  survey_id UUID NOT NULL UNIQUE,
  organization_id UUID NOT NULL,
  timezone TEXT NOT NULL,
  start_local TEXT NOT NULL,
  close_local TEXT NOT NULL,
  start_at TIMESTAMPTZ NOT NULL,
  close_at TIMESTAMPTZ NOT NULL,
  reminder_every_days INTEGER NOT NULL CHECK (reminder_every_days BETWEEN 1 AND 30),
  next_local TEXT NOT NULL,
  next_due_at TIMESTAMPTZ NOT NULL,
  next_kind TEXT NOT NULL CHECK (next_kind IN ('initial','reminder','close')),
  occurrence INTEGER NOT NULL DEFAULT 0 CHECK (occurrence >= 0),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','cancelled','completed')),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  lease_token UUID,
  lease_expires_at TIMESTAMPTZ,
  updated_by_user_id INTEGER NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT schedule_survey_scope_fk FOREIGN KEY(survey_id,organization_id) REFERENCES survey(id,organization_id),
  CHECK(close_at > start_at)
);
CREATE INDEX schedule_due_work ON survey_delivery_schedules(next_due_at) WHERE status='active';
ALTER TABLE survey_launches ADD COLUMN schedule_id UUID REFERENCES survey_delivery_schedules(id) ON DELETE RESTRICT;
CREATE INDEX survey_launch_schedule_idx ON survey_launches(schedule_id,created_at DESC) WHERE schedule_id IS NOT NULL;
