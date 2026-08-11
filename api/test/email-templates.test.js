'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { pool, parseInvitationTemplateCsv, insertEmails } = require('../server');

test('CSV invitation import uses a real CSV parser for quoted multiline bodies', () => {
  const templates = parseInvitationTemplateCsv(
    'language_code,notification_text\nen,"Hello, team.\n\nPlease complete the survey."\nfr,"Bonjour"'
  );
  assert.deepEqual(templates, [
    { language: 'English', text: 'Hello, team.\n\nPlease complete the survey.' },
    { language: 'French', text: 'Bonjour' },
  ]);
});

test('structured template persistence round-trips multiline text and omits subject updates', async (t) => {
  const originalConnect = pool.connect;
  t.after(() => { pool.connect = originalConnect; });
  const calls = [];
  pool.connect = async () => ({
    query: async (sql, values) => {
      calls.push({ sql, values });
      return { rows: [], rowCount: 1 };
    },
    release() {},
  });

  const body = `Hello, team.\n\nPlease complete Jane's \"leadership\" survey.`;
  await insertEmails([{ language: 'English', text: body }], {
    id: '11111111-1111-4111-8111-111111111111',
    name: 'SurveyOne',
  });

  const insert = calls.find(({ sql }) => /INSERT INTO email/.test(sql));
  assert.ok(insert);
  assert.equal(insert.values[3], body);
  assert.equal(insert.values[4], null);
  assert.match(insert.sql, /WHEN \$5 IS NULL THEN email\.invitation_subject/);
  assert.equal(calls[0].sql, 'BEGIN');
  assert.equal(calls.at(-1).sql, 'COMMIT');
});
