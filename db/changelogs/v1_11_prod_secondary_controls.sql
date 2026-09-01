--liquibase formatted sql

--changeset cladvisors:prod-secondary-disabled-controls-1 splitStatements:false
--comment Add the secondary production namespace without changing any existing environment controls. Every outbound processing control starts disabled.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '5min';

INSERT INTO email_worker_control(environment, claiming_enabled, minimum_release)
VALUES ('prod-secondary', false, '')
ON CONFLICT (environment) DO NOTHING;

INSERT INTO email_webhook_worker_control(environment, claiming_enabled, processing_enabled)
VALUES ('prod-secondary', false, false)
ON CONFLICT (environment) DO NOTHING;

INSERT INTO email_suppression_control(environment, enforcement_enabled)
VALUES ('prod-secondary', false)
ON CONFLICT (environment) DO NOTHING;

INSERT INTO email_sending_control(environment, sending_enabled)
VALUES ('prod-secondary', false)
ON CONFLICT (environment) DO NOTHING;
