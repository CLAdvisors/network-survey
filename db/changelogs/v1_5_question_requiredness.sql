--liquibase formatted sql

--changeset cladvisors:question-requiredness-1 splitStatements:false
--validCheckSum: 9:7db1c249349801ca94d85209857e7364
--comment Materialize SurveyJS's existing false default for legacy elements without isRequired. Briefly block Survey writes to avoid overwriting concurrent question edits; fail after 10 seconds rather than wait indefinitely. No responses or question definitions are removed.
SET LOCAL lock_timeout = '10s';
LOCK TABLE Survey IN SHARE ROW EXCLUSIVE MODE;

WITH normalized AS (
  SELECT
    s.name,
    jsonb_agg(
      CASE
        WHEN jsonb_exists(element, 'isRequired') THEN element
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
    WHERE NOT jsonb_exists(element, 'isRequired')
  );
