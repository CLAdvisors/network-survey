-- Create Survey table
CREATE TABLE Survey (
    name VARCHAR(255) PRIMARY KEY,
    title VARCHAR(255),
    creation_date TIMESTAMP,
    questions JSONB
);

-- Create Respondent table with unique constraint on name+survey_name
CREATE TABLE Respondent (
    respondent_id SERIAL PRIMARY KEY,
    name VARCHAR(100),
    contact_info VARCHAR(255),
    survey_name VARCHAR(255) REFERENCES Survey(name),
    can_respond BOOL,
    uuid VARCHAR(50) UNIQUE,
    lang VARCHAR(255),
    response JSONB,
    UNIQUE(name, survey_name)
);

-- Create Email table
CREATE TABLE EMAIL (
    survey_name VARCHAR(255) REFERENCES Survey(name),
    lang VARCHAR(255),
    text VARCHAR(2555)
);

-- Create User table
CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    username VARCHAR(255) UNIQUE NOT NULL,
    password VARCHAR(255) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create Session table
CREATE TABLE sessions (
    sid varchar NOT NULL COLLATE "default",
    sess json NOT NULL,
    expire timestamp(6) NOT NULL,
    CONSTRAINT "session_pkey" PRIMARY KEY ("sid")
);

CREATE INDEX "IDX_session_expire" ON sessions ("expire");

ALTER TABLE EMAIL
ADD CONSTRAINT name_lang UNIQUE (survey_name, lang);