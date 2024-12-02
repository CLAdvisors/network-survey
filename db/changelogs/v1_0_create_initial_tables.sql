-- Create Survey table
CREATE TABLE Survey (
    name VARCHAR(255) PRIMARY KEY,
    title VARCHAR(255),
    creation_date TIMESTAMP,
	questions JSONB
);

-- Create Respondent table
CREATE TABLE Respondent (
    respondent_id SERIAL PRIMARY KEY,
    name VARCHAR(100),
    contact_info VARCHAR(255),
    survey_name VARCHAR(255) REFERENCES Survey(name),
	can_respond BOOL,
	uuid VARCHAR(50) UNIQUE,
	lang VARCHAR(255),
	response JSONB
);

CREATE TABLE EMAIL (
	survey_name VARCHAR(255) REFERENCES Survey(name),
	lang VARCHAR(255),
	text VARCHAR(2555)
);

ALTER TABLE EMAIL
ADD CONSTRAINT name_lang UNIQUE (survey_name, lang);

