-- Purpose: Add a column to the Respondent table to track if an email has been sent to the respondent.
ALTER TABLE Respondent ADD COLUMN email_sent BOOLEAN DEFAULT FALSE;