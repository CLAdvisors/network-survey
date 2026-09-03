--liquibase formatted sql

--changeset cladvisors:survey-email-history-pagination-index-1 runInTransaction:false
--comment Support bounded deterministic per-survey keyset pagination; interrupted concurrent builds self-heal on retry.
SET lock_timeout = '5s';
SET statement_timeout = '5min';
DROP INDEX CONCURRENTLY IF EXISTS delivery_survey_history_page;
CREATE INDEX CONCURRENTLY delivery_survey_history_page
  ON survey_email_deliveries(survey_id, organization_id, created_at DESC, id DESC);
RESET lock_timeout;
RESET statement_timeout;
