'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizeCommand,
  validateFinalRoster,
  temporaryName,
  mutateRoster,
  parseRespondentCsv,
  MAX_ROSTER_SIZE,
  MAX_BATCH_SIZE,
} = require('../respondent-roster');

const surveyId = '11111111-1111-4111-8111-111111111111';
const organizationId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const respondent = (id, name, overrides = {}) => ({
  respondent_id: id,
  name,
  contact_info: `${name.toLowerCase()}@example.test`,
  survey_id: surveyId,
  survey_name: 'Survey A',
  can_respond: true,
  uuid: `token-${id}`,
  lang: 'English',
  response: { answer: id },
  email_sent: id % 2 === 0,
  ...overrides,
});

class RosterClient {
  constructor(rows, options = {}) {
    this.rows = structuredClone(rows);
    this.survey = {
      id: surveyId,
      name: 'Survey A',
      organization_id: organizationId,
      lifecycle_status: 'draft',
      lifecycle_version: 4,
      archived_at: null,
      role: 'editor',
      ...options.survey,
    };
    this.audit = [];
    this.nextId = Math.max(0, ...rows.map((row) => row.respondent_id)) + 1;
    this.released = false;
  }

  async query(sql, values = []) {
    if (sql === 'BEGIN') {
      this.snapshot = structuredClone({ rows: this.rows, survey: this.survey, audit: this.audit, nextId: this.nextId });
      return { rows: [], rowCount: 0 };
    }
    if (sql === 'COMMIT') { this.snapshot = null; return { rows: [], rowCount: 0 }; }
    if (sql === 'ROLLBACK') {
      if (this.snapshot) Object.assign(this, structuredClone(this.snapshot));
      this.snapshot = null;
      return { rows: [], rowCount: 0 };
    }
    if (/SELECT s\.\*, om\.role/.test(sql)) return { rows: [structuredClone(this.survey)], rowCount: 1 };
    if (/SELECT respondent_id,name,contact_info/.test(sql)) {
      assert.match(sql, /ORDER BY respondent_id FOR UPDATE/);
      return { rows: structuredClone(this.rows.filter((row) => row.survey_id === values[0]).sort((a, b) => a.respondent_id - b.respondent_id)), rowCount: this.rows.length };
    }
    if (/DELETE FROM respondent WHERE respondent_id/.test(sql)) {
      const before = this.rows.length;
      this.rows = this.rows.filter((row) => !(row.respondent_id === values[0] && row.survey_id === values[1]));
      return { rows: [], rowCount: before - this.rows.length };
    }
    if (/UPDATE respondent SET name=\$1 WHERE/.test(sql)) {
      const row = this.rows.find((item) => item.respondent_id === values[1] && item.survey_id === values[2]);
      if (row) row.name = values[0];
      return { rows: [], rowCount: row ? 1 : 0 };
    }
    if (/UPDATE respondent SET survey_name=\$1 WHERE/.test(sql)) {
      let count = 0;
      for (const row of this.rows) if (row.survey_id === values[1] && row.survey_name !== values[0]) { row.survey_name = values[0]; count += 1; }
      return { rows: [], rowCount: count };
    }
    if (/UPDATE respondent SET name=\$1,contact_info/.test(sql)) {
      const row = this.rows.find((item) => item.respondent_id === values[5] && item.survey_id === values[6]);
      if (row) Object.assign(row, { name: values[0], contact_info: values[1], lang: values[2], can_respond: values[3], survey_name: values[4] });
      return { rows: [], rowCount: row ? 1 : 0 };
    }
    if (/INSERT INTO respondent\(name,contact_info/.test(sql)) {
      this.rows.push(respondent(this.nextId++, values[0], {
        contact_info: values[1], uuid: values[2], survey_name: values[3], survey_id: values[4], can_respond: values[5], lang: values[6], response: null, email_sent: false,
      }));
      return { rows: [], rowCount: 1 };
    }
    if (/UPDATE survey SET lifecycle_version/.test(sql)) {
      this.survey.lifecycle_version += 1;
      return { rows: [{ lifecycle_version: this.survey.lifecycle_version }], rowCount: 1 };
    }
    if (/INSERT INTO audit_events/.test(sql)) {
      this.audit.push({ organizationId: values[0], actorUserId: values[1], surveyId: values[2], eventType: values[3], metadata: JSON.parse(values[4]) });
      return { rows: [], rowCount: 1 };
    }
    throw new Error(`Unexpected SQL: ${sql}`);
  }

  release() { this.released = true; }
}

const poolFor = (client) => ({ connect: async () => client });
const fields = (row, name = row.name) => ({ respondentId: row.respondent_id, name, email: row.contact_info, language: row.lang, canRespond: row.can_respond });

async function rename(rows, updates, options = {}) {
  const client = new RosterClient(rows, options);
  const result = await mutateRoster(poolFor(client), { id: 9, is_platform_admin: false }, surveyId, { expectedRevision: 4, updates });
  return { client, result };
}

test('single rename preserves stable identity and all immutable respondent state', async () => {
  const original = respondent(1, 'Alice');
  const { client, result } = await rename([original], [fields(original, 'Alicia')]);
  assert.equal(result.revision, 5);
  assert.deepEqual(client.rows[0], { ...original, name: 'Alicia' });
  assert.equal(client.audit.length, 1);
  assert.deepEqual(client.audit[0].metadata, { previousRevision: 4, revision: 5, updatedCount: 1, addedCount: 0, deletedCount: 0, renamedCount: 1 });
});

test('two-way swaps and three-way cycles complete without changing IDs, tokens, responses, or email state', async () => {
  for (const names of [['Alice', 'Bob'], ['Alice', 'Bob', 'Carol']]) {
    const rows = names.map((name, index) => respondent(index + 1, name));
    const updates = rows.map((row, index) => fields(row, names[(index + 1) % names.length]));
    const { client } = await rename(rows, updates);
    assert.deepEqual(client.rows.map((row) => row.name), names.map((_, index) => names[(index + 1) % names.length]));
    for (let index = 0; index < rows.length; index += 1) {
      assert.equal(client.rows[index].respondent_id, rows[index].respondent_id);
      assert.equal(client.rows[index].uuid, rows[index].uuid);
      assert.deepEqual(client.rows[index].response, rows[index].response);
      assert.equal(client.rows[index].email_sent, rows[index].email_sent);
    }
  }
});

test('complete final roster rejects occupied and duplicate names before any write', async () => {
  const rows = [respondent(1, 'Alice'), respondent(2, 'Bob')];
  for (const updates of [
    [fields(rows[0], 'Bob')],
    [fields(rows[0], 'Same'), fields(rows[1], 'Same')],
  ]) {
    const client = new RosterClient(rows);
    await assert.rejects(() => mutateRoster(poolFor(client), { id: 9 }, surveyId, { expectedRevision: 4, updates }), (error) => error.code === 'respondent_name_duplicate');
    assert.deepEqual(client.rows, rows);
    assert.equal(client.survey.lifecycle_version, 4);
    assert.equal(client.audit.length, 0);
  }
});

test('stale revision, unknown/cross-survey IDs, placeholder changes, and immutable fields are rejected', async () => {
  const placeholder = respondent(1, 'None', { contact_info: 'N/A', can_respond: false, response: null });
  const alice = respondent(2, 'Alice');
  const cases = [
    [{ expectedRevision: 3, updates: [fields(alice, 'Alicia')] }, 'roster_stale'],
    [{ expectedRevision: 4, updates: [{ ...fields(alice), respondentId: 999 }] }, 'respondent_not_found'],
    [{ expectedRevision: 4, deletions: [placeholder.respondent_id] }, 'placeholder_protected'],
    [{ expectedRevision: 4, updates: [{ ...fields(alice), uuid: 'replacement' }] }, 'roster_fields_invalid'],
  ];
  for (const [command, code] of cases) {
    const client = new RosterClient([placeholder, alice]);
    await assert.rejects(() => mutateRoster(poolFor(client), { id: 9 }, surveyId, command), (error) => error.code === code);
    assert.deepEqual(client.rows, [placeholder, alice]);
  }
});

test('lifecycle lock and role authorization fail without roster reads or writes', async () => {
  for (const [survey, code] of [
    [{ lifecycle_status: 'active' }, 'survey_not_editable'],
    [{ role: 'analyst' }, 'survey_not_found'],
  ]) {
    const row = respondent(1, 'Alice');
    const client = new RosterClient([row], { survey });
    await assert.rejects(() => mutateRoster(poolFor(client), { id: 9 }, surveyId, { expectedRevision: 4, updates: [fields(row, 'Alicia')] }), (error) => error.code === code);
    assert.deepEqual(client.rows, [row]);
    assert.equal(client.survey.lifecycle_version, 4);
  }
});

test('a second browser command with the same revision fails rather than overwriting', async () => {
  const alice = respondent(1, 'Alice');
  const client = new RosterClient([alice]);
  await mutateRoster(poolFor(client), { id: 9 }, surveyId, { expectedRevision: 4, updates: [fields(alice, 'First')] });
  await assert.rejects(() => mutateRoster(poolFor(client), { id: 10 }, surveyId, { expectedRevision: 4, updates: [{ ...fields(alice, 'Second'), name: 'Second' }] }), (error) => error.code === 'roster_stale' && error.details.currentRevision === 5);
  assert.equal(client.rows[0].name, 'First');
});

test('forced failures at every mutation phase roll back rows, revision, additions, deletions, and audit', async () => {
  const rows = [respondent(1, 'Alice'), respondent(2, 'Bob')];
  const command = {
    expectedRevision: 4,
    updates: [fields(rows[0], 'Alicia')],
    deletions: [2],
    additions: [{ name: 'Carol', email: 'carol@example.test', language: 'English', canRespond: true }],
  };
  for (const phase of ['afterValidation', 'afterDeletions', 'afterStaging', 'afterUpdates', 'afterAdditions', 'afterAudit']) {
    const client = new RosterClient(rows);
    await assert.rejects(() => mutateRoster(poolFor(client), { id: 9 }, surveyId, command, { [phase]: () => { throw new Error(`fail ${phase}`); } }), new RegExp(`fail ${phase}`));
    assert.deepEqual(client.rows, rows, phase);
    assert.equal(client.survey.lifecycle_version, 4, phase);
    assert.deepEqual(client.audit, [], phase);
    assert.equal(client.released, true, phase);
  }
});

test('roster and mutation limits allow exactly 1,500 respondents', () => {
  assert.equal(MAX_ROSTER_SIZE, 1500);
  assert.equal(MAX_BATCH_SIZE, 1500);
  const addition = (index) => ({ name: `Person${index}`, email: `person${index}@example.test`, language: 'English', canRespond: true });
  const maximumCommand = normalizeCommand({ expectedRevision: 0, additions: Array.from({ length: 1500 }, (_, index) => addition(index + 1)) });
  assert.equal(validateFinalRoster([], maximumCommand).length, 1500);
  assert.throws(
    () => normalizeCommand({ expectedRevision: 0, additions: Array.from({ length: 1501 }, (_, index) => addition(index + 1)) }),
    (error) => error.code === 'roster_batch_too_large'
  );
  const oversizedExisting = Array.from({ length: 1501 }, (_, index) => respondent(index + 1, `Person${index + 1}`, { contact_info: `person${index + 1}@example.test` }));
  assert.throws(
    () => validateFinalRoster(oversizedExisting, normalizeCommand({ expectedRevision: 0, updates: [fields(oversizedExisting[0])] })),
    (error) => error.code === 'roster_too_large'
  );
});

test('validation enforces complete roster formats, strict IDs, lengths, and supported language', () => {
  const row = respondent(1, 'Alice');
  for (const update of [
    { ...fields(row), name: 'x'.repeat(101) },
    { ...fields(row), email: 'not-an-email' },
    { ...fields(row), language: 'Klingon' },
    { ...fields(row), canRespond: 'true' },
  ]) assert.throws(() => normalizeCommand({ expectedRevision: 4, updates: [update] }));
  assert.throws(() => validateFinalRoster([respondent(2, 'Broken', { contact_info: 'bad' })], normalizeCommand({ expectedRevision: 4, additions: [{ name: 'New', email: 'new@example.test', language: 'English', canRespond: true }] })), (error) => error.code === 'respondent_email_invalid');
});

test('CSV import is additions-only, strict, bounded, and occupied names are rejected by final validation', () => {
  const additions = parseRespondentCsv('First,Last,Email,Language,Can Respond\nAlice,Smith,alice@example.test,English,false');
  assert.deepEqual(additions, [{ name: 'Alice Smith', email: 'alice@example.test', language: 'English', canRespond: false }]);
  const command = normalizeCommand({ expectedRevision: 4, additions });
  assert.throws(() => validateFinalRoster([respondent(1, 'Alice Smith', { contact_info: 'old@example.test' })], command), (error) => error.code === 'respondent_name_duplicate');
  assert.throws(() => parseRespondentCsv('First,Last,Email,Can Respond\nA,B,a@example.test,maybe'), (error) => error.code === 'respondent_can_respond_invalid');
  assert.throws(() => parseRespondentCsv('First,Last,Email,Language,Can Respond,"unterminated\nA,B,a@example.test,English,true'), (error) => error.code === 'csv_invalid');
  assert.throws(() => parseRespondentCsv('First,Last,Email,Email,Language,Can Respond\nA,B,first@example.test,second@example.test,English,true'), (error) => error.code === 'csv_invalid');
  const csvRows = Array.from({ length: 1501 }, (_, index) => `Person,${index + 1},person${index + 1}@example.test,English,true`);
  assert.equal(parseRespondentCsv(`First,Last,Email,Language,Can Respond\n${csvRows.slice(0, 1500).join('\n')}`).length, 1500);
  assert.throws(
    () => parseRespondentCsv(`First,Last,Email,Language,Can Respond\n${csvRows.join('\n')}`),
    (error) => error.code === 'roster_batch_too_large' && error.status === 413
  );
});

test('temporary internal names are bounded and avoid current/final names', () => {
  const reserved = new Set(['Alice']);
  const first = temporaryName(123, reserved);
  const second = temporaryName(123, reserved);
  assert.ok(first.length <= 100);
  assert.notEqual(first, second);
  assert.match(first, /^~roster~/);
});
