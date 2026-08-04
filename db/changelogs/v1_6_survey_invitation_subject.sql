--liquibase formatted sql

--changeset cladvisors:survey-invitation-subject-1
--comment Store each localized survey invitation subject with its body so copies preserve the complete invitation template.
ALTER TABLE EMAIL
  ADD COLUMN IF NOT EXISTS invitation_subject TEXT NOT NULL DEFAULT 'CLA Network Survey';
