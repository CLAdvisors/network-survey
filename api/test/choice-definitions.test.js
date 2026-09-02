const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');

process.env.NODE_ENV = 'test';
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'test-secret';

const {
  app,
  pool,
  DEFINED_RANKING_LIMITS,
  validateSurveyDefinition,
  validateRequiredAnswers,
} = require('../server');

function definedRanking(choices, name = 'values') {
  return { elements: [{ type: 'draggableranking', name, choices, isRequired: true }] };
}

function choice(value, definition = 'Definition') {
  return { value, text: `Label ${value}`, definition };
}

test('definition-enabled draggable ranking choices normalize literal fields and retain machine values', () => {
  const schema = validateSurveyDefinition(definedRanking([
    { value: '  stable-one  ', text: '  Stable one  ', definition: '  First paragraph.\r\n\rSecond paragraph.  ' },
    { value: 'stable-two', text: 'Stable two', definition: '   ' },
  ]));

  assert.deepEqual(schema.elements[0].choices, [
    { value: 'stable-one', text: 'Stable one', definition: 'First paragraph.\n\nSecond paragraph.' },
    { value: 'stable-two', text: 'Stable two' },
  ]);
  assert.deepEqual(validateRequiredAnswers(schema, { values: ['stable-two', 'stable-one'] }), []);
  assert.deepEqual(validateRequiredAnswers(schema, { values: ['Stable one'] }), ['Invalid response: values']);
});

test('legacy draggable rankings without definitions retain primitive and legacy object choices', () => {
  const choices = ['one', 2, false, { value: 'three', text: 3 }];
  const normalized = validateSurveyDefinition(definedRanking(choices));
  assert.deepEqual(normalized.elements[0].choices, choices);
});

test('definition is accepted only on draggable ranking choices as a literal string', () => {
  for (const element of [
    { type: 'radiogroup', name: 'radio', choices: [{ value: 'one', text: 'One', definition: 'No' }] },
    { type: 'draggableranking', name: 'nested', choices: [{ value: 'one', text: 'One', metadata: { definition: 'No' } }] },
    { type: 'text', name: 'question', definition: 'No' },
  ]) {
    assert.throws(
      () => validateSurveyDefinition({ elements: [element] }),
      /only draggableranking choices may define it/
    );
  }
  assert.throws(
    () => validateSurveyDefinition({ definition: 'No', elements: [] }),
    /only draggableranking choices may define it/
  );
  assert.throws(
    () => validateSurveyDefinition(definedRanking([{ value: 'one', text: 'One', definition: { en: 'No' } }])),
    /definition must be a literal string/
  );
});

test('one definition makes explicit, nonempty, unique string values and texts mandatory', () => {
  const invalidChoices = [
    [choice('one'), 'legacy'],
    [choice('one'), { value: 'two', definition: 'Two' }],
    [choice('one'), { value: 2, text: 'Two' }],
    [choice('one'), { value: 'two', text: '   ' }],
    [choice('one'), { value: ' one ', text: 'Duplicate after trimming' }],
  ];
  for (const choices of invalidChoices) {
    assert.throws(() => validateSurveyDefinition(definedRanking(choices)));
  }
});

test('definition-enabled ranking limits enforce characters, UTF-8 bytes, count, and forbidden controls', () => {
  assert.deepEqual(DEFINED_RANKING_LIMITS, {
    choices: 100,
    valueChars: 128,
    valueBytes: 512,
    textChars: 240,
    textBytes: 1024,
    definitionChars: 10_000,
    definitionBytes: 40 * 1024,
    surveyDefinitionChars: 250_000,
    surveyDefinitionBytes: 512 * 1024,
  });

  const invalid = [
    [{ value: 'v'.repeat(129), text: 'Valid', definition: 'Defined' }],
    [{ value: '😀'.repeat(129), text: 'Valid', definition: 'Defined' }],
    [{ value: 'valid', text: 't'.repeat(241), definition: 'Defined' }],
    [{ value: 'valid', text: '😀'.repeat(241), definition: 'Defined' }],
    [{ value: 'valid', text: 'Valid', definition: 'd'.repeat(10_001) }],
    [{ value: 'valid', text: 'Valid', definition: '😀'.repeat(10_001) }],
    Array.from({ length: 101 }, (_, index) => choice(`v${index}`)),
  ];
  for (const choices of invalid) {
    assert.throws(() => validateSurveyDefinition(definedRanking(choices)));
  }

  for (const forbidden of ['\t', '\0', '\u0085', '\u061c', '\u200e', '\u202e', '\u2066']) {
    assert.throws(() => validateSurveyDefinition(definedRanking([
      { value: 'value', text: 'Text', definition: `before${forbidden}after` },
    ])), /forbidden control or bidirectional formatting character/);
  }
});

test('survey-wide definition character and byte budgets are enforced', () => {
  const characterHeavy = {
    elements: Array.from({ length: 26 }, (_, questionIndex) => ({
      type: 'draggableranking',
      name: `q${questionIndex}`,
      choices: Array.from({ length: 10 }, (_, choiceIndex) =>
        choice(`${questionIndex}-${choiceIndex}`, 'd'.repeat(1000))),
    })),
  };
  assert.throws(() => validateSurveyDefinition(characterHeavy), /aggregate limit/);

  const byteHeavy = {
    elements: Array.from({ length: 66 }, (_, index) => ({
      type: 'draggableranking',
      name: `q${index}`,
      choices: [choice(`v${index}`, '😀'.repeat(2000))],
    })),
  };
  assert.throws(() => validateSurveyDefinition(byteHeavy), /aggregate limit/);
});

test('/api/updateQuestions has a scoped 1 MiB JSON body limit', async (t) => {
  t.after(() => pool.end());

  const acceptedByParser = await request(app)
    .post('/api/updateQuestions')
    .send({ padding: 'x'.repeat(150 * 1024) });
  assert.equal(acceptedByParser.status, 401);

  const oversized = await request(app)
    .post('/api/updateQuestions')
    .send({ padding: 'x'.repeat(1024 * 1024) });
  assert.equal(oversized.status, 413);
  assert.deepEqual(oversized.body, {
    error: 'request_too_large',
    message: 'Request body exceeds the allowed size.',
  });
});
