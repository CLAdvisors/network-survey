'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const lifecycle = require('../lifecycle');
const {
  DEFAULT_SURVEY_INSTRUCTIONS,
  TEAM_EVAL_INSTRUCTIONS,
  MAX_INSTRUCTION_CHARACTERS,
  derivedInstructions,
  effectiveInstructions,
  validateInstructionOverride,
} = require('../survey-instructions');

const surveyId = '11111111-1111-4111-8111-111111111111';
const organizationId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

function clientPool({ instructions = null, role = 'editor', auditFailure = false } = {}) {
  const calls = [];
  const client = {
    async query(sql, values) {
      calls.push({ sql, values });
      if (/SELECT s\.\*, om\.role/.test(sql)) return { rows: [{ id: surveyId, organization_id: organizationId, name: 'TeamEVAL2026', title: 'Team Eval', display_name: 'TeamEVAL', lifecycle_status: 'draft', archived_at: null, instructions, role }] };
      if (/INSERT INTO audit_events/.test(sql) && auditFailure) throw new Error('audit unavailable');
      return { rows: [], rowCount: 1 };
    },
    release() { calls.push({ sql: 'RELEASE' }); },
  };
  return { calls, pool: { connect: async () => client } };
}

test('migration uses a unique identity and evidence-gated exact reconciliation without touching obsolete columns', () => {
  const sql = fs.readFileSync(path.join(__dirname, '../../db/changelogs/v1_10_editable_survey_instructions.sql'), 'utf8');
  const master = fs.readFileSync(path.join(__dirname, '../../db/changelogs/master-changelog.xml'), 'utf8');
  assert.match(master, /v1_10_editable_survey_instructions\.sql/);
  assert.match(sql, /network-survey:editable-survey-instructions-reconciliation-1/);
  assert.match(sql, /id = 'editable-survey-content-1'[\s\S]+author = 'cladvisors'[\s\S]+filename = 'changelogs\/v1_5_editable_survey_content\.sql'/);
  assert.match(sql, /WHERE instructions = legacy_default/);
  assert.match(sql, /ALTER COLUMN instructions DROP DEFAULT/);
  assert.doesNotMatch(sql, /ALTER TABLE (EMAIL|Respondent)/i);
  assert.doesNotMatch(sql, /SET instructions = legacy_default|instructions TEXT\s+DEFAULT/i);
});

test('NULL derives approved TeamEVAL/default instructions while empty hides exactly', () => {
  assert.equal(derivedInstructions('TeamEVAL 2026'), TEAM_EVAL_INSTRUCTIONS);
  assert.equal(derivedInstructions('Network Analysis'), DEFAULT_SURVEY_INSTRUCTIONS);
  assert.equal(effectiveInstructions(null, 'Team Eval'), TEAM_EVAL_INSTRUCTIONS);
  assert.equal(effectiveInstructions('', 'Team Eval'), '');
  assert.equal(effectiveInstructions('Explicit', 'Team Eval'), 'Explicit');
});

test('instruction validation enforces explicit type, character, byte, and control policies', () => {
  assert.equal(validateInstructionOverride(null), null);
  assert.equal(validateInstructionOverride('line one\nline two\tvalue'), 'line one\nline two\tvalue');
  assert.throws(() => validateInstructionOverride(undefined), /string or null/);
  assert.throws(() => validateInstructionOverride({}), /string or null/);
  assert.throws(() => validateInstructionOverride('bad\u0000value'), /control characters/);
  assert.throws(() => validateInstructionOverride('x'.repeat(MAX_INSTRUCTION_CHARACTERS + 1)), /at most/);
  assert.throws(() => validateInstructionOverride('😀'.repeat(MAX_INSTRUCTION_CHARACTERS)), /UTF-8 bytes/);
});

test('tenant-safe role authorization is non-enumerating', async () => {
  for (const role of [null, 'analyst']) {
    const { pool } = clientPool({ role });
    await assert.rejects(
      lifecycle.updateSurveyInstructions(pool, { id: 9 }, surveyId, 'private', null),
      (error) => error.status === 404 && error.code === 'survey_not_found'
    );
  }
});

test('draft update and strict audit commit atomically without instruction content in audit metadata', async () => {
  const privateValue = 'Private <script>literal</script>\nsecond line';
  const { pool, calls } = clientPool({ instructions: null });
  const result = await lifecycle.updateSurveyInstructions(pool, { id: 9 }, surveyId, privateValue, null);
  assert.equal(result.instructions, privateValue);
  assert.equal(calls.some(({ sql }) => sql === 'COMMIT'), true);
  const audit = calls.find(({ sql }) => /INSERT INTO audit_events/.test(sql));
  assert.ok(audit);
  assert.equal(audit.values[3], 'survey.instructions_updated');
  assert.doesNotMatch(audit.values[4], /Private|script|second line/);
  assert.deepEqual(Object.keys(JSON.parse(audit.values[4])).sort(), [
    'changed', 'nextByteLength', 'nextCharacterLength', 'nextPresence',
    'previousByteLength', 'previousCharacterLength', 'previousPresence',
  ]);
});

test('oversized preserved legacy content can be replaced using exact expected-state comparison', async () => {
  const legacyValue = 'x'.repeat(MAX_INSTRUCTION_CHARACTERS + 2000);
  const { pool, calls } = clientPool({ instructions: legacyValue });
  const result = await lifecycle.updateSurveyInstructions(pool, { id: 9 }, surveyId, null, legacyValue);
  assert.equal(result.instructions, null);
  assert.equal(calls.some(({ sql, values }) => /UPDATE survey SET instructions/.test(sql) && values[0] === null), true);
  assert.equal(calls.some(({ sql }) => sql === 'COMMIT'), true);
});

test('stale instruction updates fail without overwriting or auditing a newer value', async () => {
  const { pool, calls } = clientPool({ instructions: 'newer value' });
  await assert.rejects(
    lifecycle.updateSurveyInstructions(pool, { id: 9 }, surveyId, 'stale draft', 'older value'),
    (error) => error.status === 409 && error.code === 'instructions_conflict'
  );
  assert.equal(calls.some(({ sql }) => /UPDATE survey SET instructions/.test(sql)), false);
  assert.equal(calls.some(({ sql }) => /INSERT INTO audit_events/.test(sql)), false);
  assert.equal(calls.some(({ sql }) => sql === 'ROLLBACK'), true);
});

test('launched survey rejects mutation and audit failure rolls back the content write', async () => {
  const locked = clientPool();
  const originalQuery = locked.pool.connect;
  locked.pool.connect = async () => {
    const client = await originalQuery();
    const query = client.query.bind(client);
    client.query = (sql, values) => /SELECT s\.\*, om\.role/.test(sql)
      ? Promise.resolve({ rows: [{ id: surveyId, organization_id: organizationId, name: 'Survey', lifecycle_status: 'active', archived_at: null, instructions: null, role: 'editor' }] })
      : query(sql, values);
    return client;
  };
  await assert.rejects(lifecycle.updateSurveyInstructions(locked.pool, { id: 9 }, surveyId, 'new', null), (error) => error.status === 409 && error.code === 'survey_not_editable');
  assert.equal(locked.calls.some(({ sql }) => /UPDATE survey SET instructions/.test(sql)), false);
  assert.equal(locked.calls.some(({ sql }) => sql === 'ROLLBACK'), true);

  const failed = clientPool({ auditFailure: true });
  await assert.rejects(lifecycle.updateSurveyInstructions(failed.pool, { id: 9 }, surveyId, 'new', null), /audit unavailable/);
  assert.equal(failed.calls.some(({ sql }) => /UPDATE survey SET instructions/.test(sql)), true);
  assert.equal(failed.calls.some(({ sql }) => sql === 'ROLLBACK'), true);
  assert.equal(failed.calls.some(({ sql }) => sql === 'COMMIT'), false);
});
