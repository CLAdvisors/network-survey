--liquibase formatted sql

--changeset cladvisors:question-requiredness-1 splitStatements:false
--comment Materialize SurveyJS's existing false default for legacy elements without isRequired. No responses or question definitions are removed.
WITH normalized AS (
  SELECT
    s.name,
    jsonb_agg(
      CASE
        WHEN element ? 'isRequired' THEN element
        ELSE jsonb_set(element, '{isRequired}', 'false'::jsonb)
      END
      ORDER BY ordinal
    ) AS elements
  FROM Survey s
  CROSS JOIN LATERAL jsonb_array_elements(COALESCE(s.questions->'elements', '[]'::jsonb)) WITH ORDINALITY AS item(element, ordinal)
  WHERE s.questions IS NOT NULL
    AND jsonb_typeof(s.questions->'elements') = 'array'
  GROUP BY s.name
)
UPDATE Survey s
SET questions = jsonb_set(s.questions, '{elements}', normalized.elements)
FROM normalized
WHERE s.name = normalized.name
  AND EXISTS (
    SELECT 1
    FROM jsonb_array_elements(COALESCE(s.questions->'elements', '[]'::jsonb)) element
    WHERE NOT (element ? 'isRequired')
  );
