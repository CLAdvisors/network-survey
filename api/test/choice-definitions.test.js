const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');

process.env.NODE_ENV = 'test';
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'test-secret';

const {
  app,
  pool,
  DEFINED_RANKING_LIMITS,
  QUESTION_DEFINITION_JSON_LIMIT,
  SURVEY_SCHEMA_MAX_BYTES,
  validateSurveyDefinition,
  validateRequiredAnswers,
  normalizeQuestionNames,
} = require('../server');

function definedRanking(choices, name = 'values') {
  return { elements: [{ type: 'draggableranking', name, choices, isRequired: true }] };
}

function choice(value, definition = 'Definition') {
  return { value, text: `Label ${value}`, definition };
}

test('definition-enabled rankings preserve canonical machine IDs while normalizing text and definition', () => {
  const schema = validateSurveyDefinition(definedRanking([
    { value: 'Stable.ID-01', text: '  Stable one  ', definition: '  First paragraph.\r\n\rSecond paragraph.  ' },
    { value: 'stable-two', text: 'Stable two', definition: '   ' },
  ]));

  assert.deepEqual(schema.elements[0].choices, [
    { value: 'Stable.ID-01', text: 'Stable one', definition: 'First paragraph.\n\nSecond paragraph.' },
    { value: 'stable-two', text: 'Stable two' },
  ]);
  assert.deepEqual(validateRequiredAnswers(schema, { values: ['stable-two', 'Stable.ID-01'] }), []);
  assert.deepEqual(validateRequiredAnswers(schema, { values: ['Stable one'] }), ['Invalid response: values']);
});

test('definition-enabled rankings reject noncanonical machine IDs without mutating input', () => {
  const invalidValues = [
    [' leading', /leading or trailing whitespace/],
    ['trailing ', /leading or trailing whitespace/],
    ['line\nbreak', /may not contain CR or LF/],
    ['line\rbreak', /may not contain CR or LF/],
    ['line\r\nbreak', /may not contain CR or LF/],
  ];
  for (const [value, message] of invalidValues) {
    const input = definedRanking([{ value, text: 'Label', definition: 'Definition' }]);
    const original = structuredClone(input);
    assert.throws(() => validateSurveyDefinition(input), message);
    assert.deepEqual(input, original);
  }
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
    surveyChoices: 1000,
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

  for (const forbidden of ['\t', '\0', '\u0085', '\u061c', '\u200e', '\u202e', '\u2066', '\uD800']) {
    assert.throws(() => validateSurveyDefinition(definedRanking([
      { value: 'value', text: 'Text', definition: `before${forbidden}after` },
    ])), /forbidden control or bidirectional formatting character/);
  }
});

test('definition-enabled rankings enforce a 1000-choice survey aggregate', () => {
  const schema = {
    elements: Array.from({ length: 10 }, (_, questionIndex) => ({
      type: 'draggableranking',
      name: `q${questionIndex}`,
      choices: Array.from({ length: 100 }, (_, choiceIndex) =>
        choice(`${questionIndex}-${choiceIndex}`)),
    })),
  };
  assert.equal(validateSurveyDefinition(schema).elements.flatMap(element => element.choices).length, 1000);

  schema.elements.push({
    type: 'draggableranking',
    name: 'one_too_many',
    choices: [choice('extra')],
  });
  assert.throws(() => validateSurveyDefinition(schema), /at most 1000 choices across the survey/);
});

test('survey definition UTF-8 byte budget has an independent exact boundary', () => {
  const schema = {
    elements: Array.from({ length: 128 }, (_, index) => ({
      type: 'draggableranking',
      name: `q${index}`,
      choices: [choice(`v${index}`, '😀'.repeat(1024))],
    })),
  };
  assert.doesNotThrow(() => validateSurveyDefinition(schema));
  schema.elements[0].choices[0].definition += 'x';
  assert.throws(() => validateSurveyDefinition(schema), /aggregate limit/);
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

test('the schema budget guarantees validator-approved JSON fits the authoring parser', () => {
  assert.equal(SURVEY_SCHEMA_MAX_BYTES, Math.floor(2.5 * 1024 * 1024));
  const accepted = { elements: [{ type: 'text', name: 'q', description: 'x'.repeat(SURVEY_SCHEMA_MAX_BYTES - 100) }] };
  assert.doesNotThrow(() => validateSurveyDefinition(accepted));
  accepted.elements[0].description += 'x'.repeat(200);
  assert.throws(() => validateSurveyDefinition(accepted), /Questions schema exceeds the .*byte limit/);
});

test('canonical reference expansion cannot exceed the persisted schema budget', () => {
  const schema = {
    elements: [{
      type: 'text',
      name: 'q',
      visibleIf: '{q}'.repeat(250_000),
    }],
  };
  assert.doesNotThrow(() => validateSurveyDefinition(schema));
  assert.throws(
    () => normalizeQuestionNames(schema, { currentCanonicalNames: new Set() }),
    /Questions schema exceeds the .*byte limit/
  );
});

test('all schema strings reject characters PostgreSQL JSONB cannot store', () => {
  for (const element of [
    { type: 'text', name: 'q', title: 'before\0after' },
    { type: 'text', name: 'q', description: 'before\uD800after' },
    { type: 'text', name: 'q', metadata: { nested: 'before\uDFFFafter' } },
    { type: 'text', name: 'q', metadata: { ['bad\0key']: 'value' } },
    { type: 'text', name: 'q', metadata: { nested: { ['bad\uD800key']: 'value' } } },
  ]) {
    assert.throws(
      () => validateSurveyDefinition({ elements: [element] }),
      /PostgreSQL JSONB cannot store/
    );
  }
  assert.doesNotThrow(() => validateSurveyDefinition({
    elements: [{ type: 'text', name: 'q', title: 'Valid astral text 😀' }],
  }));
});

test('/api/updateQuestions rejects unauthenticated oversized malformed bodies before parsing', async (t) => {
  t.after(() => pool.end());

  const response = await request(app)
    .post('/api/updateQuestions')
    .set('Content-Type', 'application/json')
    .send(`{"unfinished":"${'x'.repeat(3 * 1024 * 1024)}`);
  assert.equal(response.status, 401);
  assert.deepEqual(response.body, { error: 'Unauthorized' });
});

test('maximum-valid feature schema fits the scoped 3 MiB parser budget', () => {
  assert.equal(QUESTION_DEFINITION_JSON_LIMIT, '3mb');
  const maximumSchema = {
    elements: Array.from({ length: 10 }, (_, questionIndex) => ({
      type: 'draggableranking',
      name: `q${questionIndex}`,
      choices: Array.from({ length: 100 }, (_, choiceIndex) => {
        const prefix = `${questionIndex}-${choiceIndex}-`;
        return {
          value: prefix + '😀'.repeat(128 - [...prefix].length),
          text: '😀'.repeat(240),
          definition: 'd'.repeat(250),
        };
      }),
    })),
  };
  assert.doesNotThrow(() => validateSurveyDefinition(maximumSchema));
  const payload = { surveyName: 'Maximum', questions: maximumSchema };
  const payloadBytes = Buffer.byteLength(JSON.stringify(payload));
  assert.ok(payloadBytes > 1024 * 1024);
  assert.ok(payloadBytes < 3 * 1024 * 1024);
});
