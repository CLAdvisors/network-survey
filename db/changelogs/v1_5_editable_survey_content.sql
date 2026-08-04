--liquibase formatted sql

--changeset cladvisors:editable-survey-content-1
--comment Add editable respondent instructions and localized email subjects, preserving legacy content.
ALTER TABLE Survey
    ADD COLUMN IF NOT EXISTS instructions TEXT
    DEFAULT 'For each question below, indicate the people you interact with at work. The survey will take 10-15 minutes to complete; please plan to finish in one session.';

UPDATE Survey
SET instructions = 'For each question below, indicate the people you interact with at work. The survey will take 10-15 minutes to complete; please plan to finish in one session.'
WHERE instructions IS NULL;

ALTER TABLE EMAIL
    ADD COLUMN IF NOT EXISTS subject VARCHAR(255)
    DEFAULT 'CLA Network Survey';

UPDATE EMAIL
SET subject = 'CLA Network Survey'
WHERE subject IS NULL;

-- The legacy column was length-limited; editable templates use a bounded API
-- limit while the database safely stores existing and future content.
ALTER TABLE EMAIL ALTER COLUMN text TYPE TEXT;
