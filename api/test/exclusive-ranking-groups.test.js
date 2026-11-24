const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');

process.env.NODE_ENV = 'test';
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'test-secret';
process.env.ALLOW_PUBLIC_SIGNUP = 'false';
process.env.AUTH_RATE_LIMIT_MAX = '1000';
process.env.RESPONDENT_RATE_LIMIT_MAX = '1000';

const {
  app,
  pool,
  validateSurveyDefinition,
  validateRequiredAnswers,
} = require('../server');

const choices = ['alpha', 'beta', 'gamma'];

function ranking(name, extra = {}) {
  return { type: 'draggableranking', name, choices, ...extra };
}

function grouped(elements) {
  return validateSurveyDefinition({ elements });
}

test('exclusive group is accepted, trimmed and preserved only on draggable rankings', () => {
  const schema = grouped([
    ranking('first', { exclusiveGroup: '  values  ' }),
    ranking('second', { exclusiveGroup: 'values' }),
    ranking('third'),
  ]);

  assert.equal(schema.elements[0].exclusiveGroup, 'values');
  assert.equal(schema.elements[1].exclusiveGroup, 'values');
  assert.equal('exclusiveGroup' in schema.elements[2], false);
});

test('an empty exclusive group is dropped so existing surveys stay unchanged', () => {
  const schema = grouped([
    ranking('first', { exclusiveGroup: '   ' }),
    ranking('second'),
  ]);
  assert.equal('exclusiveGroup' in schema.elements[0], false);
});

test('save rejects malformed, singleton, mismatched and infeasible groups', () => {
  assert.throws(
    () => grouped([ranking('a', { exclusiveGroup: 'bad/group' }), ranking('b', { exclusiveGroup: 'bad/group' })]),
    /exclusiveGroup must be 1-64 characters/
  );
  assert.throws(
    () => grouped([ranking('a', { exclusiveGroup: 'x'.repeat(65) }), ranking('b', { exclusiveGroup: 'x'.repeat(65) })]),
    /exclusiveGroup must be 1-64 characters/
  );
  assert.throws(
    () => grouped([ranking('a', { exclusiveGroup: 5}), ranking('b', { exclusiveGroup: '5' })]),
    /exclusiveGroup must be a string/
  );
  assert.throws(
    () => grouped([ranking('a', { exclusiveGroup: 'solo' })]),
    /must link at least two/
  );
  assert.throws(
    () => grouped([
      ranking('a', { exclusiveGroup: 'values' }),
      ranking('b', { exclusiveGroup: 'values', choices: ['alpha', 'beta', 'delta'] }),
    ]),
    /requires identical choice values in a and b/
  );
  assert.throws(
    () => grouped([
      ranking('a', { exclusiveGroup: 'values', minSelectedChoices: 2 }),
      ranking('b', { exclusiveGroup: 'values', minSelectedChoices: 2 }),
    ]),
    /cannot be completed/
  );
  assert.throws(
    () => grouped([
      { type: 'text', name: 'plain', exclusiveGroup: 'values' },
      ranking('b', { exclusiveGroup: 'values' }),
    ]),
    /only draggableranking questions may be linked/
  );
});

test('save counts requiredness when checking group feasibility', () => {
  assert.throws(
    () => grouped([
      ranking('a', { exclusiveGroup: 'values', choices: ['only'], isRequired: true }),
      ranking('b', { exclusiveGroup: 'values', choices: ['only'], isRequired: true }),
    ]),
    /cannot be completed/
  );
  assert.throws(
    () => grouped([
      ranking('a', { exclusiveGroup: 'values', choices: ['one', 'two'], isRequired: true, minSelectedChoices: 2 }),
      ranking('b', { exclusiveGroup: 'values', choices: ['one', 'two'], isRequired: true }),
    ]),
    /cannot be completed/
  );

  const feasible = grouped([
    ranking('a', { exclusiveGroup: 'values', choices: ['only'], isRequired: true }),
    ranking('b', { exclusiveGroup: 'values', choices: ['only'] }),
  ]);
  assert.equal(feasible.elements[0].isRequired, true);
});

test('save rejects overlapping default answers within a group', () => {
  assert.throws(
    () => grouped([
      ranking('a', { exclusiveGroup: 'values', defaultValue: ['alpha'] }),
      ranking('b', { exclusiveGroup: 'values', defaultValue: ['alpha', 'beta'] }),
    ]),
    /same default value in a and b/
  );

  const disjoint = grouped([
    ranking('a', { exclusiveGroup: 'values', defaultValue: ['alpha'] }),
    ranking('b', { exclusiveGroup: 'values', defaultValue: ['beta'] }),
    ranking('c', { exclusiveGroup: 'values' }),
  ]);
  assert.deepEqual(disjoint.elements[0].defaultValue, ['alpha']);
});

test('save accepts groups whose minimums exactly exhaust the shared choices', () => {
  const schema = grouped([
    ranking('a', { exclusiveGroup: 'values', minSelectedChoices: 2 }),
    ranking('b', { exclusiveGroup: 'values', minSelectedChoices: 1 }),
  ]);
  assert.equal(schema.elements[0].minSelectedChoices, 2);
});

test('submit rejects the same value ranked in two linked questions', () => {
  const schema = grouped([
    { type: 'boolean', name: 'show' },
    ranking('a', { exclusiveGroup: 'values', isRequired: true }),
    ranking('b', { exclusiveGroup: 'values', isRequired: true, visibleIf: '{show} = true' }),
    { type: 'text', name: 'name' },
  ]);

  assert.deepEqual(
    validateRequiredAnswers(schema, { show: true, a: ['alpha', 'beta'], b: ['gamma'], name: 'x' }),
    []
  );
  assert.deepEqual(
    validateRequiredAnswers(schema, { show: true, a: ['alpha'], b: ['alpha'], name: 'x' }),
    ['"alpha" is ranked in more than one linked ranking question.']
  );
});

test('a duplicate within one linked question is not worded as a cross-question collision', () => {
  const schema = grouped([
    ranking('a', { exclusiveGroup: 'values', isRequired: true }),
    ranking('b', { exclusiveGroup: 'values', isRequired: true }),
  ]);
  assert.deepEqual(validateRequiredAnswers(schema, { a: ['alpha', 'alpha'], b: ['beta'] }), [
    'Invalid response: a',
  ]);
});

test('submit reports the choice text and ignores hidden or read-only siblings', () => {
  const schema = grouped([
    { type: 'boolean', name: 'show' },
    ranking('a', {
      exclusiveGroup: 'values',
      choices: [
        { value: 'alpha', text: 'Alpha label' },
        { value: 'beta', text: 'Beta label' },
        { value: 'gamma', text: 'Gamma label' },
      ],
      isRequired: true,
    }),
    ranking('b', {
      exclusiveGroup: 'values',
      choices: [
        { value: 'alpha', text: 'Alpha label' },
        { value: 'beta', text: 'Beta label' },
        { value: 'gamma', text: 'Gamma label' },
      ],
      visibleIf: '{show} = true',
    }),
    ranking('c', {
      exclusiveGroup: 'values',
      choices: [
        { value: 'alpha', text: 'Alpha label' },
        { value: 'beta', text: 'Beta label' },
        { value: 'gamma', text: 'Gamma label' },
      ],
      readOnly: true,
    }),
  ]);

  assert.deepEqual(
    validateRequiredAnswers(schema, { show: true, a: ['alpha'], b: ['beta'], c: ['gamma'] }),
    []
  );
  assert.deepEqual(
    validateRequiredAnswers(schema, { show: true, a: ['alpha'], b: ['alpha'], c: ['gamma'] }),
    ['"Alpha label" is ranked in more than one linked ranking question.']
  );
  // Hidden b keeps its stored value but cannot collide with the visible a.
  assert.deepEqual(
    validateRequiredAnswers(schema, { show: false, a: ['alpha'], b: ['alpha'], c: ['gamma'] }),
    []
  );
  // Read-only c is exempt too.
  assert.deepEqual(
    validateRequiredAnswers(schema, { show: true, a: ['gamma'], b: ['beta'], c: ['gamma'] }),
    []
  );
});

test('unlinked draggable rankings may repeat values across questions', () => {
  const schema = grouped([
    ranking('a', { isRequired: true }),
    ranking('b', { isRequired: true }),
  ]);
  assert.deepEqual(validateRequiredAnswers(schema, { a: ['alpha'], b: ['alpha'] }), []);
});

test('/api/user returns 400 with a readable error for overlapping linked rankings', async (t) => {
  const originalQuery = pool.query;
  const originalConnect = pool.connect;
  t.after(() => {
    pool.query = originalQuery;
    pool.connect = originalConnect;
  });

  const schema = grouped([
    ranking('question_1', { exclusiveGroup: 'values', isRequired: true }),
    ranking('question_2', { exclusiveGroup: 'values', isRequired: true }),
  ]);
  pool.query = async (sql) => {
    if (/FROM Respondent r/.test(sql)) {
      return {
        rows: [{
          respondent_id: 91,
          response: null,
          can_respond: true,
          survey_id: 'survey-exclusive-id',
        }],
      };
    }
    throw new Error(`Unexpected query: ${sql}`);
  };

  const persisted = [];
  pool.connect = async () => ({
    query: async (sql, values) => {
      if (/^\s*(BEGIN|COMMIT|ROLLBACK)/.test(sql)) return { rows: [], rowCount: 0 };
      if (/FROM Respondent r[\s\S]+JOIN Survey s/.test(sql)) {
        return { rows: [{ respondent_id: 91, response: null, can_respond: true, survey_id: 'survey-exclusive-id' }] };
      }
      if (/SELECT questions FROM Survey/.test(sql)) return { rows: [{ questions: schema }] };
      if (/UPDATE respondent SET response/.test(sql)) {
        persisted.push({ sql, values });
        return { rowCount: 1, rows: [] };
      }
      return { rowCount: 0, rows: [] };
    },
    release() {},
  });

  const overlapping = await request(app)
    .post('/api/user')
    .send({
      surveyName: 'Survey A',
      userId: 'valid-token',
      answers: JSON.stringify({ question_1: ['alpha'], question_2: ['alpha'] }),
    });
  assert.equal(overlapping.status, 400);
  assert.equal(overlapping.body.message, 'Invalid survey responses.');
  assert.deepEqual(overlapping.body.errors, [
    '"alpha" is ranked in more than one linked ranking question.',
  ]);
  assert.equal(persisted.length, 0, 'overlapping answers must not be persisted');

  const disjoint = await request(app)
    .post('/api/user')
    .send({
      surveyName: 'Survey A',
      userId: 'valid-token',
      answers: JSON.stringify({ question_1: ['alpha'], question_2: ['beta'] }),
    });
  assert.equal(disjoint.status, 200);
  assert.deepEqual(disjoint.body, { success: true });
  assert.equal(persisted.length, 1);
  assert.deepEqual(persisted[0].values[0].question_1, ['alpha']);
  assert.deepEqual(persisted[0].values[0].question_2, ['beta']);
});
