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

--changeset cladvisors:editable-survey-invitation-delivery-1
--comment Add durable, idempotent invitation delivery claims without changing the published editable-content changeset.
-- Durable invitation claims replace the former email_sent preclaim. A worker owns
-- a recipient only while this UUID matches. Abandoned claims are automatically
-- retried after 30 minutes only while still inside Resend's idempotency retention.
-- invitation_first_attempted_at is set once immediately before provider I/O, so
-- repeated ambiguous failures cannot move the 23-hour quarantine horizon.
ALTER TABLE Respondent
    ADD COLUMN IF NOT EXISTS invitation_claim_token UUID,
    ADD COLUMN IF NOT EXISTS invitation_claimed_at TIMESTAMP,
    ADD COLUMN IF NOT EXISTS invitation_first_attempted_at TIMESTAMP,
    ADD COLUMN IF NOT EXISTS invitation_delivery_id UUID;

-- This UUID is the durable provider idempotency identity for one invitation
-- lifecycle. It survives claim expiry/process crashes and is rotated by recipient
-- upserts when delivery-relevant data changes.
UPDATE Respondent
SET invitation_delivery_id = gen_random_uuid()
WHERE invitation_delivery_id IS NULL;

ALTER TABLE Respondent
    ALTER COLUMN invitation_delivery_id SET DEFAULT gen_random_uuid(),
    ALTER COLUMN invitation_delivery_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_respondent_pending_invitation_claim
    ON Respondent (survey_id, survey_name, invitation_claimed_at)
    WHERE email_sent IS NOT TRUE;
