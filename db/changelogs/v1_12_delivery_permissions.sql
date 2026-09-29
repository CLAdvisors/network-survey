--liquibase formatted sql
--changeset cladvisors:delivery-link-permissions-1
-- Default owner/admin; only an owner may expand access for their organization.
ALTER TABLE organizations ADD COLUMN personal_link_minimum_role TEXT NOT NULL DEFAULT 'admin'
  CHECK (personal_link_minimum_role IN ('owner','admin','editor','analyst','viewer'));
