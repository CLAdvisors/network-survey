const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const fs = require('node:fs');
const path = require('node:path');
const bcrypt = require('bcrypt');
const { Model } = require('survey-core');

process.env.NODE_ENV = 'test';
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'test-secret';
process.env.ALLOW_PUBLIC_SIGNUP = 'false';
process.env.AUTH_RATE_LIMIT_MAX = '1000';
process.env.RESPONDENT_RATE_LIMIT_MAX = '1000';

const {
  app,
  pool,
  validateRespondentToken,
  requireAuth,
  toSafeUser,
  columnExists,
  tableExists,
  hasAnyRole,
  resolveSurveyForUser,
  copySurveyForUser,
  getDefaultOrganizationForUser,
  getDashboardBaseUrl,
  buildDashboardUrl,
  createDemoToken,
  verifyDemoToken,
  sanitizeSurveyForDemo,
  READ_SURVEY_ROLES,
  ANALYST_ROLES,
  EDITOR_ROLES,
  ADMIN_ROLES,
  hashToken,
  parseRequiredCsvValue,
  csvToJson,
  SUPPORTED_QUESTION_TYPES,
  validateSurveyDefinition,
  validateRequiredAnswers,
  normalizeQuestionNames,
  formatRespondentChoice,
} = require('../server');

test('question schema requiredness is explicit, typed, and validates submitted answers', () => {
  assert.equal(parseRequiredCsvValue(undefined), true, 'an absent Required column remains legacy-required');
  assert.equal(parseRequiredCsvValue(''), false, 'a blank present Required value is optional');
  assert.equal(parseRequiredCsvValue('false'), false);
  assert.equal(parseRequiredCsvValue('TRUE'), true);
  const csvQuestionRequiredness = (requiredHeaderAndValue) => csvToJson(
    `Title,Question name,Question title,Question type,Max answers${requiredHeaderAndValue.header}\nSurvey,q1,Question,text,${requiredHeaderAndValue.value}`
  ).questions.elements[0].isRequired;
  assert.equal(csvQuestionRequiredness({ header: '', value: '' }), true, 'absent Required column');
  assert.equal(csvQuestionRequiredness({ header: ',Required', value: ',' }), false, 'blank Required value');
  assert.equal(csvQuestionRequiredness({ header: ',Required', value: ',true' }), true);
  assert.equal(csvQuestionRequiredness({ header: ',Required', value: ',false' }), false);

  const schema = validateSurveyDefinition({
    elements: [
      { type: 'tagbox', name: 'legacy', title: 'Legacy optional', choicesLazyLoadEnabled: true },
      { type: 'draggableranking', name: 'required', title: 'Rank', choices: ['a'], isRequired: true },
    ]
  });
  assert.equal(schema.elements[0].isRequired, false);
  assert.equal(schema.elements[1].isRequired, true);
  assert.deepEqual(validateRequiredAnswers(schema, { legacy: [] }), ['Invalid response: required']);
  assert.deepEqual(validateRequiredAnswers(schema, { required: ['a'] }), []);
  assert.deepEqual(validateRequiredAnswers(schema, { required: {} }), ['Invalid response: required']);
  assert.deepEqual(validateRequiredAnswers(schema, { legacy: {} , required: ['a'] }), ['Invalid response: legacy']);
  const conditionalSchema = validateSurveyDefinition({ elements: [
    { type: 'boolean', name: 'show' },
    { type: 'text', name: 'conditional', isRequired: true, visibleIf: '{show} = true' },
  ] });
  assert.deepEqual(validateRequiredAnswers(conditionalSchema, { show: false }), []);
  assert.deepEqual(validateRequiredAnswers(conditionalSchema, { show: true }), ['Invalid response: conditional']);
  assert.deepEqual(
    normalizeQuestionNames(conditionalSchema).elements[1].visibleIf,
    '{question_1} = true'
  );
  const collisionSchema = {
    elements: [
      { type: 'text', name: 'alpha' },
      { type: 'text', name: 'question_1', visibleIf: "{alpha} = 'yes'" },
    ],
  };
  assert.equal(
    normalizeQuestionNames(collisionSchema).elements[1].visibleIf,
    "{question_2} = 'yes'",
    'a replacement must not be rewritten again when it matches another old name'
  );
  const canonicalReferenceSchema = {
    elements: [
      { type: 'text', name: 'question_1' },
      { type: 'text', name: 'question_2', visibleIf: "{question_1} = 'yes'" },
    ],
  };
  assert.equal(
    normalizeQuestionNames(canonicalReferenceSchema).elements[1].visibleIf,
    "{question_1} = 'yes'",
    'an already-canonical reference must remain unchanged'
  );
  const unknownReferenceSchema = {
    elements: [{ type: 'text', name: 'alpha', visibleIf: "{not_a_question} = 'yes'" }],
  };
  assert.equal(
    normalizeQuestionNames(unknownReferenceSchema).elements[0].visibleIf,
    "{not_a_question} = 'yes'",
    'references outside the schema must remain unchanged'
  );
  const reorderedChoiceSourceSchema = {
    elements: [
      { type: 'radiogroup', name: 'question_2', choices: ['a'] },
      { type: 'dropdown', name: 'question_1', choicesFromQuestion: 'question_2' },
      { type: 'checkbox', name: 'dependent', choicesFromQuestion: 'question_1' },
    ],
    triggers: [{ type: 'copyvalue', expression: '{dependent} notempty', fromName: 'question_2', setToName: 'question_1' }],
  };
  const normalizedChoiceSources = normalizeQuestionNames(reorderedChoiceSourceSchema);
  assert.deepEqual(
    normalizedChoiceSources.elements.map(({ name, choicesFromQuestion }) => ({ name, choicesFromQuestion })),
    [
      { name: 'question_2', choicesFromQuestion: undefined },
      { name: 'question_1', choicesFromQuestion: 'question_2' },
      { name: 'question_3', choicesFromQuestion: 'question_1' },
    ],
    'canonical identities and exact references must survive a reorder collision-safely'
  );
  assert.deepEqual(normalizedChoiceSources.triggers[0], {
    type: 'copyvalue',
    expression: '{question_3} notempty',
    fromName: 'question_2',
    setToName: 'question_1',
  });
  assert.equal(SUPPORTED_QUESTION_TYPES.has('draggableranking'), true);
  assert.throws(
    () => validateSurveyDefinition({ elements: [{ type: 'tagbox', name: 'tag', isRequired: 'false' }] }),
    /required/
  );
  assert.throws(() => validateSurveyDefinition({ elements: [{ type: 'text' }] }), /nonempty safe name/);
  assert.throws(
    () => validateSurveyDefinition({ elements: [{ type: 'text', name: 'unsafe name' }] }),
    /nonempty safe name/
  );
  assert.throws(
    () => validateSurveyDefinition({ elements: [
      { type: 'text', name: 'duplicate' },
      { type: 'comment', name: 'duplicate' },
    ] }),
    /names must be unique: duplicate/
  );
  assert.throws(
    () => validateSurveyDefinition({ elements: [{ type: 'madeup', name: 'unknown' }] }),
    /unsupported type: madeup/
  );
  assert.throws(
    () => validateSurveyDefinition({ elements: [{ type: 'text', name: 'alias', valueName: 'shared' }] }),
    /unsupported property valueName.*Remove valueName so answers are stored under the question name/
  );
  assert.throws(
    () => validateSurveyDefinition({ elements: [{
      type: 'dropdown', name: 'remote', choicesByUrl: { url: 'https://example.test/choices' }
    }] }),
    /unsupported property choicesByUrl.*Remove choicesByUrl.*server-side URL choice resolution is not supported/
  );
  assert.throws(
    () => validateSurveyDefinition({ elements: [{
      type: 'matrixdropdown', name: 'matrix', rows: ['row'],
      columns: [{ name: 'remote', cellType: 'dropdown', choicesByUrl: { url: 'https://example.test/choices' } }]
    }] }),
    /column 1 defines unsupported property choicesByUrl/
  );
  assert.throws(
    () => validateSurveyDefinition({ elements: [{
      type: 'dropdown', name: 'not_lazy', choicesLazyLoadEnabled: true
    }] }),
    /unsupported property choicesLazyLoadEnabled for type dropdown.*supported only for tagbox/
  );
  assert.throws(
    () => validateSurveyDefinition({ elements: [{
      type: 'tagbox', name: 'new_tags', allowAddNewTag: true
    }] }),
    /unsupported property allowAddNewTag=true.*Set allowAddNewTag to false or remove it/
  );
  assert.doesNotThrow(() => validateSurveyDefinition({ elements: [{
    type: 'tagbox', name: 'known_tags', choicesLazyLoadEnabled: true, allowAddNewTag: false
  }] }));
  assert.throws(
    () => validateSurveyDefinition({ elements: [{ type: 'panel', elements: [{ type: 'text' }] }] }),
    /Nested SurveyJS questions, panels, and pages are not supported/
  );
  assert.throws(
    () => validateSurveyDefinition({ elements: [], pages: [] }),
    /Move every question into the survey's top-level elements array/
  );
});

test('canonical question identities survive insertion, reorder, and deletion without compacting response keys', () => {
  const inserted = normalizeQuestionNames({ elements: [
    { type: 'text', name: 'new_question', title: 'New', visibleIf: '{question_3} notempty' },
    { type: 'text', name: 'question_1', title: 'Original one' },
    { type: 'text', name: 'question_3', title: 'Original three' },
  ] });
  assert.deepEqual(inserted.elements.map(({ name, title }) => [name, title]), [
    ['question_4', 'New'],
    ['question_1', 'Original one'],
    ['question_3', 'Original three'],
  ]);
  assert.equal(inserted.elements[0].visibleIf, '{question_3} notempty');

  const reordered = normalizeQuestionNames({ elements: [
    inserted.elements[2], inserted.elements[0], inserted.elements[1],
  ] });
  assert.deepEqual(reordered.elements.map(({ name, title }) => [name, title]), [
    ['question_3', 'Original three'],
    ['question_4', 'New'],
    ['question_1', 'Original one'],
  ]);

  const afterDeletion = normalizeQuestionNames({ elements: [
    reordered.elements[0], reordered.elements[2],
  ] });
  assert.deepEqual(afterDeletion.elements.map(({ name, title }) => [name, title]), [
    ['question_3', 'Original three'],
    ['question_1', 'Original one'],
  ], 'deleting question_4 must not compact the remaining response keys');
  assert.deepEqual(
    { question_1: 'answer one', question_3: 'answer three' },
    { [afterDeletion.elements[1].name]: 'answer one', [afterDeletion.elements[0].name]: 'answer three' },
    'existing answers retain the same semantic question identity'
  );

  const firstImport = normalizeQuestionNames({ elements: [
    { type: 'text', name: 'arbitrary_alpha' },
    { type: 'comment', name: 'arbitrary_beta', visibleIf: '{arbitrary_alpha} notempty' },
  ] });
  assert.deepEqual(firstImport.elements.map(({ name }) => name), ['question_1', 'question_2']);
  assert.equal(firstImport.elements[1].visibleIf, '{question_1} notempty');

  const afterHistoricalDeletion = normalizeQuestionNames({ elements: [
    { type: 'text', name: 'question_2', title: 'Survivor' },
    { type: 'text', name: 'later_addition', title: 'Later' },
  ] }, { minimumNextQuestionNumber: 8 });
  assert.deepEqual(afterHistoricalDeletion.elements.map(({ name }) => name), ['question_2', 'question_8']);

  const persistedOnly = normalizeQuestionNames({ elements: [
    { type: 'text', name: 'question_5', title: 'Persisted', visibleIf: '{question_99} notempty' },
    { type: 'text', name: 'question_99', title: 'Imported canonical' },
    { type: 'comment', name: 'fresh', title: 'Fresh', visibleIf: '{question_5} = 1 and {question_99} = 2' },
  ] }, {
    minimumNextQuestionNumber: 8,
    currentCanonicalNames: new Set(['question_2', 'question_5']),
  });
  assert.deepEqual(persistedOnly.elements.map(({ name }) => name), ['question_5', 'question_8', 'question_9']);
  assert.equal(persistedOnly.elements[0].visibleIf, '{question_8} notempty');
  assert.equal(persistedOnly.elements[2].visibleIf, '{question_5} = 1 and {question_8} = 2');

  const freshCanonicalImport = normalizeQuestionNames({ elements: [
    { type: 'text', name: 'question_500', visibleIf: '{question_500} notempty' },
  ] }, { preserveCanonicalNames: new Set() });
  assert.equal(freshCanonicalImport.elements[0].name, 'question_1');
  assert.equal(freshCanonicalImport.elements[0].visibleIf, '{question_1} notempty');

  const reorderedPersisted = normalizeQuestionNames({ elements: [
    { type: 'text', name: 'question_5' },
    { type: 'text', name: 'question_2', visibleIf: '{question_5} notempty' },
  ] }, { currentCanonicalNames: ['question_2', 'question_5'] });
  assert.deepEqual(reorderedPersisted.elements.map(({ name }) => name), ['question_5', 'question_2']);
  assert.equal(reorderedPersisted.elements[1].visibleIf, '{question_5} notempty');
  const allocatedThenDeleted = normalizeQuestionNames({ elements: [
    { type: 'text', name: 'question_1' },
    { type: 'text', name: 'unanswered_highest' },
  ] });
  assert.equal(allocatedThenDeleted.claNextQuestionNumber, 3);
  allocatedThenDeleted.elements.pop();
  const afterUnansweredDeletion = normalizeQuestionNames({
    ...allocatedThenDeleted,
    elements: [...allocatedThenDeleted.elements, { type: 'text', name: 'later' }],
  });
  assert.deepEqual(afterUnansweredDeletion.elements.map(({ name }) => name), ['question_1', 'question_3']);
  assert.equal(afterUnansweredDeletion.claNextQuestionNumber, 4);
  assert.doesNotThrow(() => new Model(afterUnansweredDeletion),
    'the respondent SurveyJS Model must ignore internal schema metadata');

  assert.throws(
    () => normalizeQuestionNames({ elements: [] }, { minimumNextQuestionNumber: 0 }),
    /minimumNextQuestionNumber must be a positive integer/
  );
  for (const invalidCounter of [0, -1, 1.5, '3', null]) {
    assert.throws(
      () => normalizeQuestionNames({ elements: [], claNextQuestionNumber: invalidCounter }),
      /claNextQuestionNumber must be a positive safe integer/
    );
  }
});

test('dotted expression references rewrite only known leading question names collision-safely', () => {
  const normalized = normalizeQuestionNames({
    elements: [
      { type: 'multipletext', name: 'details', items: [{ name: 'first' }] },
      { type: 'matrixdropdown', name: 'matrix', rows: ['r1'], columns: [{ name: 'c1', choices: [1] }] },
      {
        type: 'text',
        name: 'question_1',
        visibleIf: '{details.first} notempty and {matrix.r1.c1} = 1 and {question_1.value} = 2 and {unknown.value} = 3 and {row.c1} = 4'
      },
    ],
  });

  assert.equal(
    normalized.elements[2].visibleIf,
    '{question_2.first} notempty and {question_3.r1.c1} = 1 and {question_1.value} = 2 and {unknown.value} = 3 and {row.c1} = 4'
  );

  const reservedReferences = normalizeQuestionNames({ elements: [{
    type: 'dropdown', name: 'choice', choices: ['a'],
    choicesVisibleIf: '{item} != null and {survey.locale} = "en" and {panel.name} notempty and {composite.value} notempty',
  }] });
  assert.equal(reservedReferences.elements[0].choicesVisibleIf,
    '{item} != null and {survey.locale} = "en" and {panel.name} notempty and {composite.value} notempty');
  for (const reservedName of ['item', 'ROW', 'Panel', 'composite', 'Survey']) {
    assert.throws(
      () => validateSurveyDefinition({ elements: [{ type: 'text', name: reservedName }] }),
      new RegExp(`name.*${reservedName}.*reserved SurveyJS expression variable`, 'i')
    );
  }
});

test('supported question types enforce requiredness, visibility, and practical value constraints', () => {
  const schema = validateSurveyDefinition({ elements: [
    { type: 'boolean', name: 'show' },
    { type: 'text', name: 'text', isRequired: true },
    { type: 'comment', name: 'comment' },
    { type: 'boolean', name: 'boolean' },
    { type: 'rating', name: 'rating', rateMin: 2, rateMax: 4 },
    { type: 'radiogroup', name: 'radio', choices: ['a', { value: 'b', text: 'Bee' }] },
    { type: 'dropdown', name: 'dropdown', choices: ['x', 'y'] },
    { type: 'checkbox', name: 'checkbox', choices: ['a', 'b'] },
    { type: 'tagbox', name: 'lazyTagbox', choicesLazyLoadEnabled: true },
    { type: 'tagbox', name: 'staticTagbox', choices: ['known'] },
    { type: 'draggableranking', name: 'drag', choices: ['a', 'b'], isRequired: true },
    { type: 'imagepicker', name: 'imageSingle', choices: ['one', 'two'] },
    { type: 'imagepicker', name: 'imageMulti', multiSelect: true, choices: ['one', 'two'] },
    { type: 'file', name: 'file' },
    { type: 'matrix', name: 'matrix', rows: ['row1'], columns: ['choice1', 'choice2'] },
    { type: 'matrixdropdown', name: 'matrixDropdown', rows: ['row1'], columns: [
      { name: 'single', cellType: 'dropdown', choices: ['a', 'b'] },
      { name: 'multi', cellType: 'checkbox', choices: ['x', 'y'] },
    ] },
    { type: 'matrixdynamic', name: 'matrixDynamic', columns: [
      { name: 'label', cellType: 'text' },
      { name: 'pick', cellType: 'dropdown', choices: ['a', 'b'] },
    ] },
    { type: 'multipletext', name: 'multipleText', items: [{ name: 'first' }, { name: 'second' }] },
    { type: 'text', name: 'hiddenRequired', isRequired: true, visibleIf: '{show} = true' },
    { type: 'text', name: 'disabledRequired', isRequired: true, enableIf: '{show} = true' },
  ] });

  assert.deepEqual(validateRequiredAnswers(schema, {
    show: false,
    text: 'hello',
    comment: 'details',
    boolean: true,
    rating: 3,
    radio: 'b',
    dropdown: 'x',
    checkbox: ['a'],
    lazyTagbox: ['dynamically-loaded-user-id'],
    staticTagbox: ['known'],
    drag: ['b'],
    imageSingle: 'one',
    imageMulti: ['one', 'two'],
    file: [{ name: 'report.pdf', type: 'application/pdf', content: 'data:pdf', size: 42 }],
    matrix: { row1: 'choice2' },
    matrixDropdown: { row1: { single: 'a', multi: ['x'] } },
    matrixDynamic: [{ label: 'first row', pick: 'b' }],
    multipleText: { first: 'one', second: 'two' },
  }, { lazyTagboxChoices: new Set(['dynamically-loaded-user-id']) }), [],
  'valid values and a conditionally hidden required question are accepted');

  const invalidErrors = validateRequiredAnswers(schema, {
    show: true,
    text: 10,
    comment: false,
    boolean: 'true',
    rating: 5,
    radio: 'not-a-choice',
    dropdown: ['x'],
    checkbox: ['not-a-choice'],
    lazyTagbox: ['still-allowed-dynamically'],
    staticTagbox: ['unknown'],
    drag: [],
    imageSingle: ['one'],
    imageMulti: 'one',
    file: [{ name: 'bad.txt', content: { nested: true } }],
    matrix: { unknownRow: 'choice1' },
    matrixDropdown: { row1: { unknownColumn: { nested: true } } },
    matrixDynamic: [{ unknownColumn: { nested: true } }],
    multipleText: { unknownItem: { nested: true } },
  }, { lazyTagboxChoices: new Set(['dynamically-loaded-user-id']) });
  for (const name of [
    'text', 'comment', 'boolean', 'rating', 'radio', 'dropdown', 'checkbox',
    'lazyTagbox', 'staticTagbox', 'drag', 'imageSingle', 'imageMulti', 'file', 'matrix', 'matrixDropdown',
    'matrixDynamic', 'multipleText', 'hiddenRequired', 'disabledRequired'
  ]) {
    assert.ok(invalidErrors.includes(`Invalid response: ${name}`), `${name} should be rejected`);
  }
  assert.equal(invalidErrors.includes('Invalid response: lazyTagbox'), true);
  assert.deepEqual(
    validateRequiredAnswers(schema, { show: false, text: 'ok', drag: ['a'], rating: Number.NaN }),
    ['Invalid response: rating']
  );
  assert.deepEqual(
    validateRequiredAnswers(schema, {
      show: true,
      text: 'ok',
      drag: ['a'],
      hiddenRequired: 'visible answer',
      disabledRequired: 'enabled answer'
    }),
    [],
    'visibleIf and enableIf required questions pass when active and answered'
  );
});

test('lazy tagboxes accept the union of primitive configured choices and verified respondent strings', () => {
  const schema = validateSurveyDefinition({ elements: [{
    type: 'tagbox', name: 'people', choicesLazyLoadEnabled: true,
    choices: ['Static', { value: 42, text: 'Forty two' }, false], maxSelectedChoices: 4,
  }] });
  const verified = new Set(['Alice (alice@example.com)']);

  assert.deepEqual(validateRequiredAnswers(schema, {
    people: ['Static', 42, false, 'Alice (alice@example.com)'],
  }, { lazyTagboxChoices: verified }), []);
  assert.deepEqual(validateRequiredAnswers(schema, {
    people: ['Alice (forged@example.com)'],
  }, { lazyTagboxChoices: verified }), ['Invalid response: people']);
  assert.deepEqual(validateRequiredAnswers(schema, {
    people: [42, 42],
  }, { lazyTagboxChoices: verified }), ['Invalid response: people'], 'duplicates remain invalid');
  assert.deepEqual(validateRequiredAnswers(schema, {
    people: ['Static', 42, false, 'Alice (alice@example.com)', 'extra'],
  }, { lazyTagboxChoices: new Set(['Alice (alice@example.com)', 'extra']) }),
  ['Invalid response: people'], 'selection limits still apply to the union');
});

test('recursive requiredness and explicit matrixdynamic row bounds are enforced together', () => {
  const schema = validateSurveyDefinition({ elements: [
    { type: 'multipletext', name: 'details', isRequired: true, items: [{ name: 'first' }] },
    { type: 'matrixdropdown', name: 'structured', isRequired: true, rows: ['r1'], columns: [{ name: 'c1', cellType: 'text' }] },
    {
      type: 'matrixdynamic', name: 'dynamic', isRequired: true, minRowCount: 2, maxRowCount: 3,
      columns: [{ name: 'required', cellType: 'text', isRequired: true }]
    },
  ] });

  for (const answers of [
    { details: { first: '' }, structured: { r1: { c1: '' } }, dynamic: [{}, { required: '' }] },
    { details: { first: 'ok' }, structured: { r1: { c1: 'ok' } }, dynamic: [{ required: 'only one' }] },
    {
      details: { first: 'ok' }, structured: { r1: { c1: 'ok' } },
      dynamic: [{ required: '1' }, { required: '2' }, { required: '3' }, { required: '4' }]
    },
  ]) {
    const errors = validateRequiredAnswers(schema, answers);
    if (answers.details.first === '') {
      assert.ok(errors.includes('Invalid response: details'));
      assert.ok(errors.includes('Invalid response: structured'));
    }
    assert.ok(errors.includes('Invalid response: dynamic'));
  }

  assert.deepEqual(validateRequiredAnswers(schema, {
    details: { first: 'ok' },
    structured: { r1: { c1: 'ok' } },
    dynamic: [{ required: '1' }, { required: '2' }],
  }), []);
  assert.ok(validateRequiredAnswers(schema, {
    details: { first: 'ok' }, structured: { r1: { c1: 'ok' } }, dynamic: [{ required: '1' }, {}],
  }).includes('Invalid response: dynamic'), 'row bounds must not bypass nested required-cell validation');
});

test('nested survey definition contract rejects malformed values before SurveyJS model construction', () => {
  const invalidElements = [
    { type: 'imagepicker', name: 'image', choices: [null] },
    { type: 'imagepicker', name: 'image', choices: [{ imageLink: 'cat.png' }] },
    { type: 'radiogroup', name: 'choice', choices: [{ value: { nested: true }, text: 'Looks valid' }] },
    { type: 'matrix', name: 'matrix', rows: null, columns: ['yes'] },
    { type: 'matrixdropdown', name: 'matrix', rows: ['r1'], columns: [null] },
    { type: 'matrixdropdown', name: 'matrix', rows: ['r1'], columns: [{ name: 'empty_dropdown' }] },
    { type: 'matrixdynamic', name: 'matrix', columns: [{ name: 'bad.name' }] },
    { type: 'matrixdynamic', name: 'matrix', columns: [{ name: 'same' }, { name: 'same' }] },
    { type: 'matrixdynamic', name: 'matrix', columns: [{ name: 'cell', cellType: 'madeup' }] },
    { type: 'multipletext', name: 'details', items: [null] },
    { type: 'multipletext', name: 'details', items: [{ name: '__proto__' }] },
    { type: 'matrixdynamic', name: 'matrix', minRowCount: 3, maxRowCount: 2, columns: [{ name: 'cell' }] },
    { type: 'matrixdynamic', name: 'matrix', maxRowCount: 0, columns: [{ name: 'cell' }] },
  ];
  for (const element of invalidElements) {
    assert.throws(() => validateSurveyDefinition({ elements: [element] }), undefined,
      `${element.type} malformed nested definition should be rejected`);
  }

  const generatedModel = new Model();
  const page = generatedModel.addNewPage('generated');
  for (const type of ['imagepicker', 'matrix', 'matrixdropdown', 'matrixdynamic', 'multipletext', 'file']) {
    page.addNewQuestion(type, type);
  }
  const generatedElements = generatedModel.toJSON().pages[0].elements;
  assert.doesNotThrow(() => validateSurveyDefinition({ elements: generatedElements }),
    'normal SurveyJS model-generated nested definitions, including spaced column names, remain valid');

  assert.doesNotThrow(() => validateSurveyDefinition({ elements: [{
    type: 'imagepicker', name: 'image', choices: [{ value: 'cat', imageLink: 'cat.png' }]
  }] }));
  assert.doesNotThrow(() => validateSurveyDefinition({ elements: [{
    type: 'matrixdynamic', name: 'matrix', cellType: 'text',
    columns: [{ name: 'inherited_text', cellType: 'default' }]
  }] }), 'default matrix cells inherit non-choice parent cell types');
});

test('SurveyJS-generated rating values are accepted exactly', () => {
  const generatedModel = new Model();
  const page = generatedModel.addNewPage('ratings');
  const stars = page.addNewQuestion('rating', 'stars');
  stars.rateType = 'stars';
  stars.rateCount = 10;
  const fractional = page.addNewQuestion('rating', 'fractional');
  fractional.rateMin = 0;
  fractional.rateStep = 0.5;
  fractional.rateCount = 4;
  const generatedElements = generatedModel.toJSON().pages[0].elements;
  const schema = validateSurveyDefinition({ elements: generatedElements });

  assert.deepEqual(validateRequiredAnswers(schema, { stars: 10, fractional: 1.5 }), []);
  assert.deepEqual(
    validateRequiredAnswers(schema, { stars: 11, fractional: 2 }),
    ['Invalid response: stars', 'Invalid response: fractional']
  );
});

test('SurveyJS-generated inline Other values are accepted without weakening choice validation', () => {
  const generatedModel = new Model({
    storeOthersAsComment: false,
    elements: [
      { type: 'radiogroup', name: 'radio', choices: ['known'], showOtherItem: true },
      { type: 'dropdown', name: 'dropdown', choices: ['known'], showOtherItem: true },
      { type: 'checkbox', name: 'checkbox', choices: ['known', 'second known'], showOtherItem: true, maxSelectedChoices: 2 },
      { type: 'tagbox', name: 'tagbox', choices: ['known', 'second known'], showOtherItem: true, maxSelectedChoices: 2 },
    ],
  });
  for (const name of ['radio', 'dropdown', 'checkbox', 'tagbox']) {
    const question = generatedModel.getQuestionByName(name);
    const other = question.otherItem.value;
    question.value = ['checkbox', 'tagbox'].includes(question.getType()) ? ['known', other] : other;
    question.otherValue = `${name} free form`;
  }

  const serialized = generatedModel.toJSON();
  const schema = validateSurveyDefinition({
    storeOthersAsComment: serialized.storeOthersAsComment,
    elements: serialized.pages[0].elements,
  });
  const generatedAnswers = JSON.parse(JSON.stringify(generatedModel.data));
  assert.deepEqual(generatedAnswers, {
    radio: 'radio free form',
    dropdown: 'dropdown free form',
    checkbox: ['known', 'checkbox free form'],
    tagbox: ['known', 'tagbox free form'],
  });
  assert.deepEqual(validateRequiredAnswers(schema, generatedAnswers), []);

  for (const answers of [
    { checkbox: ['unknown one', 'unknown two'] },
    { checkbox: ['same unknown', 'same unknown'] },
    { checkbox: ['known', 'second known', 'one unknown'] },
    { tagbox: ['unknown one', 'unknown two'] },
    { radio: { forged: true } },
  ]) {
    const name = Object.keys(answers)[0];
    assert.ok(validateRequiredAnswers(schema, answers).includes(`Invalid response: ${name}`));
  }

  const commentStoredSchema = validateSurveyDefinition({
    elements: [{ type: 'checkbox', name: 'strict', choices: ['known'], showOtherItem: true }],
  });
  assert.deepEqual(
    validateRequiredAnswers(commentStoredSchema, { strict: ['forged'] }),
    ['Invalid response: strict'],
    'default comment storage must not permit arbitrary unknown choice values'
  );
});

test('configured SurveyJS values, comments, special choices, and duplicate selections are enforced', () => {
  const schema = validateSurveyDefinition({ elements: [
    { type: 'text', name: 'number', inputType: 'number', showCommentArea: true },
    { type: 'boolean', name: 'boolean', valueTrue: 'yes', valueFalse: 'no' },
    { type: 'rating', name: 'rating', rateValues: [{ value: 10, text: 'Ten' }, 20] },
    {
      type: 'checkbox', name: 'specials', choices: ['ordinary'], showOtherItem: true,
      showNoneItem: true, noneItemValue: 'nothing', showRefuseItem: true,
      refuseItemValue: 'decline', showDontKnowItem: true, dontKnowItemValue: 'unsure'
    },
    { type: 'ranking', name: 'ranking', choices: ['first', 'second'] },
    { type: 'matrixdropdown', name: 'matrix', rows: ['row'], columns: [
      { name: 'number', cellType: 'text', inputType: 'number' },
      { name: 'boolean', cellType: 'boolean', valueTrue: 1, valueFalse: 0 },
      { name: 'rating', cellType: 'rating', rateValues: ['low', 'high'] },
      { name: 'multi', cellType: 'checkbox', choices: ['x'], showNoneItem: true },
    ] },
  ] });

  assert.deepEqual(validateRequiredAnswers(schema, {
    number: 12,
    'number-Comment': 'A useful comment',
    boolean: 'no',
    rating: 10,
    specials: ['other', 'nothing', 'decline', 'unsure'],
    'specials-Comment': 'Other detail',
    ranking: ['second', 'first'],
    matrix: { row: { number: 3, boolean: 0, rating: 'high', multi: ['none'] } },
  }), []);

  const invalid = validateRequiredAnswers(schema, {
    number: '12',
    'boolean-Comment': 'not configured',
    boolean: true,
    rating: 15,
    specials: ['ordinary', 'ordinary'],
    'specials-Comment': 'x'.repeat(4001),
    ranking: ['first', 'first'],
    matrix: { row: { number: '3', boolean: false, rating: 1, multi: ['x', 'x'] } },
  });
  for (const name of ['number', 'boolean', 'rating', 'specials', 'specials-Comment', 'ranking', 'matrix']) {
    assert.ok(invalid.includes(`Invalid response: ${name}`), `${name} should be rejected`);
  }
  assert.ok(invalid.includes('Unknown question: boolean-Comment'));

  assert.deepEqual(
    validateRequiredAnswers({ elements: [{ type: 'persisted-widget', name: 'legacy' }] }, {}),
    ['Unsupported question type: persisted-widget']
  );
});

test('structured answer validation constrains schema keys, choices, and nested shapes', () => {
  const schema = validateSurveyDefinition({ elements: [
    { type: 'matrix', name: 'matrix', rows: ['r1'], columns: ['yes', 'no'] },
    { type: 'matrixdropdown', name: 'dropdownMatrix', rows: ['r1'], columns: [
      { name: 'pick', cellType: 'dropdown', choices: ['a', 'b'] },
    ] },
    { type: 'matrixdynamic', name: 'dynamicMatrix', columns: [
      { name: 'label', cellType: 'text' },
      { name: 'pick', cellType: 'dropdown', choices: ['a', 'b'] },
    ] },
    { type: 'multipletext', name: 'multiple', items: [{ name: 'first' }] },
    { type: 'file', name: 'files' },
  ] });

  assert.deepEqual(validateRequiredAnswers(schema, {
    matrix: { r1: 'yes' },
    dropdownMatrix: { r1: { pick: 'b' } },
    dynamicMatrix: [{ label: 'row', pick: 'a' }],
    multiple: { first: 'value' },
    files: [{ name: 'answer.txt', type: 'text/plain', content: 'answer', size: 6, lastModified: 1710000000000 }],
  }), []);

  const invalidCases = [
    ['matrix', { matrix: { unknownRow: 'yes' } }],
    ['matrix', { matrix: { r1: 'unknownChoice' } }],
    ['dropdownMatrix', { dropdownMatrix: { unknownRow: { pick: 'a' } } }],
    ['dropdownMatrix', { dropdownMatrix: { r1: { unknownColumn: 'a' } } }],
    ['dropdownMatrix', { dropdownMatrix: { r1: { pick: 'unknownChoice' } } }],
    ['dynamicMatrix', { dynamicMatrix: ['not-an-object'] }],
    ['dynamicMatrix', { dynamicMatrix: [{ unknownColumn: { nested: true } }] }],
    ['multiple', { multiple: { unknownItem: 'value' } }],
    ['multiple', { multiple: { first: { nested: true } } }],
    ['files', { files: [{ content: 'missing name' }] }],
    ['files', { files: [{ name: 'bad.txt', content: { nested: true } }] }],
    ['files', { files: [{ name: 'bad.txt', extra: 'not allowed' }] }],
    ['files', { files: [{ name: 'bad.txt', lastModified: Number.POSITIVE_INFINITY }] }],
    ['files', { files: [{ name: 'bad.txt', lastModified: 'yesterday' }] }],
  ];
  for (const [name, answers] of invalidCases) {
    const errors = validateRequiredAnswers(schema, answers);
    assert.equal(errors.filter((error) => error === `Invalid response: ${name}`).length, 1,
      `${name} errors should be present and deduplicated`);
  }
});

test('nested required editors, selection limits, rating steps, and model-provided choices are enforced', () => {
  const schema = validateSurveyDefinition({ elements: [
    { type: 'radiogroup', name: 'choiceSource', choices: ['a', 'b', 'c'] },
    { type: 'dropdown', name: 'dynamicSingle', choicesFromQuestion: 'choiceSource' },
    { type: 'checkbox', name: 'dynamicMulti', choicesFromQuestion: 'choiceSource', minSelectedChoices: 1, maxSelectedChoices: 2 },
    { type: 'tagbox', name: 'dynamicTagbox', choicesFromQuestion: 'choiceSource', minSelectedChoices: 1, maxSelectedChoices: 3, claMaxSelections: 2 },
    { type: 'ranking', name: 'dynamicRanking', choicesFromQuestion: 'choiceSource', maxSelectedChoices: 2 },
    { type: 'draggableranking', name: 'customRanking', choices: ['a', 'b', 'c'], maxSelectedChoices: 2 },
    { type: 'imagepicker', name: 'dynamicImage', choicesFromQuestion: 'choiceSource', multiSelect: true, maxSelectedChoices: 2 },
    { type: 'rating', name: 'steppedRating', rateMin: 0.1, rateMax: 0.5, rateStep: 0.2 },
    { type: 'multipletext', name: 'requiredItems', items: [
      { name: 'required', isRequired: true }, { name: 'optional' },
    ] },
    { type: 'matrixdropdown', name: 'requiredDropdownCell', rows: ['row'], columns: [
      { name: 'required', cellType: 'text', isRequired: true },
    ] },
    { type: 'matrixdynamic', name: 'requiredDynamicCell', rowCount: 1, columns: [
      { name: 'required', cellType: 'text', isRequired: true },
    ] },
  ] });

  assert.deepEqual(validateRequiredAnswers(schema, {
    choiceSource: 'a',
    dynamicSingle: 'b',
    dynamicMulti: ['a', 'b'],
    dynamicTagbox: ['a', 'c'],
    dynamicRanking: ['c', 'a'],
    customRanking: ['b', 'a'],
    dynamicImage: ['b', 'c'],
    steppedRating: 0.3,
    requiredItems: { required: 'yes' },
    requiredDropdownCell: { row: { required: 'yes' } },
    requiredDynamicCell: [{ required: 'yes' }],
  }), [], 'choicesFromQuestion values and values on the configured rating step are accepted');

  const nestedErrors = validateRequiredAnswers(schema, {
    requiredItems: { optional: 'present' },
    requiredDropdownCell: { row: {} },
    requiredDynamicCell: [{}],
  });
  for (const name of ['requiredItems', 'requiredDropdownCell', 'requiredDynamicCell']) {
    assert.ok(nestedErrors.includes(`Invalid response: ${name}`), `${name} nested required value must be enforced`);
  }

  const constraintErrors = validateRequiredAnswers(schema, {
    choiceSource: 'a',
    dynamicSingle: 'forged',
    dynamicMulti: [],
    dynamicTagbox: ['a', 'b', 'c'],
    dynamicRanking: ['a', 'b', 'c'],
    customRanking: ['a', 'b', 'c'],
    dynamicImage: ['a', 'b', 'c'],
    steppedRating: 0.2,
  });
  for (const name of ['dynamicSingle', 'dynamicMulti', 'dynamicTagbox', 'dynamicRanking', 'customRanking', 'dynamicImage', 'steppedRating']) {
    assert.ok(constraintErrors.includes(`Invalid response: ${name}`), `${name} constraint must be enforced`);
  }
});

test('authenticated question update rejects nested, unknown, and invalid-identity definitions before persistence', async (t) => {
  const originalQuery = pool.query;
  const originalConnect = pool.connect;
  t.after(() => {
    pool.query = originalQuery;
    pool.connect = originalConnect;
  });

  const hashedPassword = await bcrypt.hash('password123', 4);
  pool.query = async (sql) => {
    if (/SELECT \* FROM users WHERE username = \$1/.test(sql)) {
      return { rows: [{ id: 87, username: 'nested-editor', password: hashedPassword, status: 'active' }] };
    }
    if (/SELECT \* FROM users WHERE id = \$1/.test(sql)) {
      return { rows: [{ id: 87, username: 'nested-editor', status: 'active' }] };
    }
    // Do not cache a false capability value before the dedicated login test.
    if (/information_schema\.columns/.test(sql)) throw new Error('test metadata unavailable');
    if (/SELECT[\s\S]+sess[\s\S]+FROM[\s\S]+sessions/i.test(sql)) {
      return { rows: [{ sess: { cookie: {}, userId: 87, username: 'nested-editor' } }], rowCount: 1 };
    }
    if (/sessions/i.test(sql)) return { rows: [], rowCount: 1 };
    if (/LEFT JOIN organization_memberships/.test(sql)) {
      return { rows: [{ id: 'survey-id', name: 'Survey A', role: 'editor', questions: { elements: [] } }] };
    }
    return { rows: [], rowCount: 0 };
  };
  let persisted = false;
  pool.connect = async () => ({
    query: async () => { persisted = true; return { rows: [], rowCount: 0 }; },
    release() {}
  });

  const agent = request.agent(app);
  assert.equal((await agent.post('/api/login').send({ username: 'nested-editor', password: 'password123' })).status, 200);
  const response = await agent.post('/api/updateQuestions').send({
    surveyName: 'Survey A',
    questions: { elements: [{ type: 'panel', name: 'panel1', elements: [{ type: 'text', name: 'child' }] }] }
  });

  assert.equal(response.status, 400);
  assert.match(response.body.message, /Nested SurveyJS questions, panels, and pages are not supported/);
  assert.equal(persisted, false);

  const unknownResponse = await agent.post('/api/updateQuestions').send({
    surveyName: 'Survey A',
    questions: { elements: [{ type: 'unknownwidget', name: 'unknown' }] }
  });
  assert.equal(unknownResponse.status, 400);
  assert.match(unknownResponse.body.message, /unsupported type: unknownwidget/);
  assert.equal(persisted, false);

  const valueNameResponse = await agent.post('/api/updateQuestions').send({
    surveyName: 'Survey A',
    questions: { elements: [{ type: 'text', name: 'aliased', valueName: 'shared_answer' }] }
  });
  assert.equal(valueNameResponse.status, 400);
  assert.match(valueNameResponse.body.message, /unsupported property valueName.*Remove valueName/);
  assert.equal(persisted, false);

  const choicesByUrlResponse = await agent.post('/api/updateQuestions').send({
    surveyName: 'Survey A',
    questions: { elements: [{
      type: 'dropdown', name: 'remote', choicesByUrl: { url: 'https://example.test/choices' }
    }] }
  });
  assert.equal(choicesByUrlResponse.status, 400);
  assert.match(choicesByUrlResponse.body.message,
    /unsupported property choicesByUrl.*Remove choicesByUrl.*server-side URL choice resolution is not supported/);
  assert.equal(persisted, false, 'URL-backed choices must fail before persistence');

  const nonTagboxLazyResponse = await agent.post('/api/updateQuestions').send({
    surveyName: 'Survey A',
    questions: { elements: [{ type: 'dropdown', name: 'lazy', choicesLazyLoadEnabled: true }] }
  });
  assert.equal(nonTagboxLazyResponse.status, 400);
  assert.match(nonTagboxLazyResponse.body.message,
    /unsupported property choicesLazyLoadEnabled for type dropdown.*supported only for tagbox/);

  const addNewTagResponse = await agent.post('/api/updateQuestions').send({
    surveyName: 'Survey A',
    questions: { elements: [{ type: 'tagbox', name: 'new_tag', allowAddNewTag: true }] }
  });
  assert.equal(addNewTagResponse.status, 400);
  assert.match(addNewTagResponse.body.message,
    /unsupported property allowAddNewTag=true.*Set allowAddNewTag to false or remove it/);
  assert.equal(persisted, false, 'unsupported tagbox runtime properties must fail before persistence');

  const invalidIdentitySchemas = [
    [{ type: 'text' }],
    [{ type: 'text', name: 'unsafe name' }],
    [{ type: 'text', name: 'duplicate' }, { type: 'comment', name: 'duplicate' }],
  ];
  for (const elements of invalidIdentitySchemas) {
    const identityResponse = await agent.post('/api/updateQuestions').send({
      surveyName: 'Survey A',
      questions: { elements }
    });
    assert.equal(identityResponse.status, 400);
  }
  assert.equal(persisted, false, 'invalid identities must be rejected before persistence');

  const malformedChoiceResponse = await agent.post('/api/updateQuestions').send({
    surveyName: 'Survey A',
    questions: { elements: [{ type: 'imagepicker', name: 'image', choices: [{ imageLink: 'cat.png' }] }] }
  });
  assert.equal(malformedChoiceResponse.status, 400);
  assert.match(malformedChoiceResponse.body.message, /primitive value or text/);
  assert.equal(persisted, false, 'malformed choices must fail before persistence');

  const generatedModel = new Model();
  const page = generatedModel.addNewPage('generated');
  page.addNewQuestion('matrixdynamic', 'generated_matrix');
  page.addNewQuestion('multipletext', 'generated_details');
  const generatedElements = generatedModel.toJSON().pages[0].elements;
  const validResponse = await agent.post('/api/updateQuestions').send({
    surveyName: 'Survey A',
    questions: { elements: [
      ...generatedElements,
      { type: 'comment', name: 'question_99', visibleIf: '{generated_matrix.Column 1} notempty and {question_99} empty' },
    ] }
  });
  assert.equal(validResponse.status, 200);
  assert.equal(persisted, true, 'normal SurveyJS model-generated schemas should persist');
  assert.deepEqual(validResponse.body.questions.elements.map(({ name }) => name), ['question_1', 'question_2', 'question_3']);
  assert.equal(validResponse.body.questions.elements[2].visibleIf,
    '{question_1.Column 1} notempty and {question_3} empty');
});

test('authenticated question updates allocate above historical response keys for object and CSV payloads', async (t) => {
  const originalQuery = pool.query;
  const originalConnect = pool.connect;
  t.after(() => {
    pool.query = originalQuery;
    pool.connect = originalConnect;
  });

  const hashedPassword = await bcrypt.hash('password123', 4);
  const historicalQueries = [];
  let historicalMaximum = '7';
  let persistedQuestions = { claNextQuestionNumber: 12, elements: [
    { type: 'text', name: 'question_2' },
    { type: 'text', name: 'question_5' },
  ] };
  pool.query = async (sql, values) => {
    if (/SELECT \* FROM users WHERE username = \$1/.test(sql)) {
      return { rows: [{ id: 88, username: 'history-editor', password: hashedPassword, status: 'active' }] };
    }
    if (/SELECT \* FROM users WHERE id = \$1/.test(sql)) {
      return { rows: [{ id: 88, username: 'history-editor', status: 'active' }] };
    }
    if (/information_schema\.columns/.test(sql)) throw new Error('test metadata unavailable');
    if (/SELECT[\s\S]+sess[\s\S]+FROM[\s\S]+sessions/i.test(sql)) {
      return { rows: [{ sess: { cookie: {}, userId: 88, username: 'history-editor' } }], rowCount: 1 };
    }
    if (/sessions/i.test(sql)) return { rows: [], rowCount: 1 };
    if (/LEFT JOIN organization_memberships/.test(sql)) {
      return { rows: [{
        id: 'history-survey-id', name: 'History Survey', role: 'editor', questions: persistedQuestions,
      }] };
    }
    if (/jsonb_object_keys/.test(sql)) {
      historicalQueries.push({ sql, values });
      return { rows: [{ max_question_number: historicalMaximum }] };
    }
    throw new Error(`Unexpected query: ${sql}`);
  };

  const updates = [];
  pool.connect = async () => ({
    query: async (sql, values) => {
      updates.push({ sql, values });
      persistedQuestions = /SET title =/.test(sql) ? values[1] : values[0];
      return { rows: [{ name: 'History Survey' }], rowCount: 1 };
    },
    release() {}
  });

  const agent = request.agent(app);
  assert.equal((await agent.post('/api/login').send({
    username: 'history-editor', password: 'password123'
  })).status, 200);

  const invalidCounter = await agent.post('/api/updateQuestions').send({
    surveyName: 'History Survey',
    questions: { claNextQuestionNumber: '12', elements: [{ type: 'text', name: 'fresh' }] },
  });
  assert.equal(invalidCounter.status, 400);
  assert.match(invalidCounter.body.message, /claNextQuestionNumber must be a positive safe integer/);
  assert.equal(updates.length, 0);

  const reorderedAndImported = await agent.post('/api/updateQuestions').send({
    surveyName: 'History Survey',
    questions: { claNextQuestionNumber: 2, elements: [
      { type: 'text', name: 'question_5', visibleIf: '{question_2} notempty' },
      { type: 'text', name: 'question_2' },
      { type: 'comment', name: 'question_7', visibleIf: '{question_5} and {question_7}' },
    ] }
  });
  assert.equal(reorderedAndImported.status, 200);
  assert.deepEqual(reorderedAndImported.body.questions.elements.map(({ name }) => name),
    ['question_5', 'question_2', 'question_12']);
  assert.equal(reorderedAndImported.body.questions.claNextQuestionNumber, 13,
    'the persisted counter is authoritative over a valid but stale client counter');
  assert.equal(reorderedAndImported.body.questions.elements[0].visibleIf, '{question_2} notempty');
  assert.equal(reorderedAndImported.body.questions.elements[2].visibleIf, '{question_5} and {question_12}');

  historicalMaximum = '8';
  const csvAdd = await agent.post('/api/updateQuestions').send({
    surveyName: 'History Survey',
    questions: [
      'Title,Question name,Question title,Question type,Max answers',
      'Imported,question_8,Current CSV question,text,',
      'Imported,question_3,Imported canonical,text,',
      'Imported,csv_name,Fresh CSV question,comment,',
    ].join('\n')
  });
  assert.equal(csvAdd.status, 200);
  assert.deepEqual(csvAdd.body.questions.elements.map(({ name }) => name),
    ['question_13', 'question_14', 'question_15']);
  assert.equal(csvAdd.body.questions.claNextQuestionNumber, 16,
    'CSV/Survey Creator payloads may omit the internal counter without resetting it');

  const deleted = await agent.delete('/api/question').send({
    surveyName: 'History Survey', questionName: 'question_15'
  });
  assert.equal(deleted.status, 200);
  assert.equal(persistedQuestions.claNextQuestionNumber, 16,
    'deleting the unanswered highest question preserves the allocation watermark');

  const addAfterDelete = await agent.post('/api/updateQuestions').send({
    surveyName: 'History Survey',
    questions: { elements: [
      persistedQuestions.elements[0],
      persistedQuestions.elements[1],
      { type: 'comment', name: 'fresh_after_delete' },
    ] }
  });
  assert.equal(addAfterDelete.status, 200);
  assert.deepEqual(addAfterDelete.body.questions.elements.map(({ name }) => name),
    ['question_13', 'question_14', 'question_16']);
  assert.equal(addAfterDelete.body.questions.claNextQuestionNumber, 17);

  assert.equal(historicalQueries.length, 4);
  for (const { sql, values } of historicalQueries) {
    assert.match(sql, /jsonb_object_keys/);
    assert.match(sql, /\^question_\(\[1-9\]\[0-9\]\*\)\$/);
    assert.match(sql, /r\.survey_id = \$1 OR \(r\.survey_id IS NULL AND r\.survey_name = \$2\)/);
    assert.deepEqual(values, ['history-survey-id', 'History Survey']);
  }
  assert.deepEqual(updates[0].values, [reorderedAndImported.body.questions, 'history-survey-id']);
  assert.deepEqual(updates[1].values, ['Imported', csvAdd.body.questions, 'history-survey-id']);
  assert.deepEqual(updates[2].values, [
    { ...csvAdd.body.questions, elements: csvAdd.body.questions.elements.slice(0, 2) },
    'history-survey-id',
  ]);
  assert.deepEqual(updates[3].values, [addAfterDelete.body.questions, 'history-survey-id']);
});

test('/api/user enforces required answers and accepts omitted optional answers', async (t) => {
  const originalQuery = pool.query;
  const originalConnect = pool.connect;
  t.after(() => {
    pool.query = originalQuery;
    pool.connect = originalConnect;
  });

  const schema = validateSurveyDefinition({ elements: [
    { type: 'boolean', name: 'show' },
    { type: 'draggableranking', name: 'question_1', choices: ['a', 'b'], isRequired: true },
    { type: 'imagepicker', name: 'question_2', choices: ['one', 'two'], multiSelect: true },
    { type: 'rating', name: 'question_3', rateMin: 1, rateMax: 3 },
    { type: 'radiogroup', name: 'question_4', choices: ['yes', 'no'] },
    { type: 'text', name: 'question_5', isRequired: true, visibleIf: '{show} = true' },
  ] });
  const queryCalls = [];
  pool.query = async (sql, values) => {
    queryCalls.push({ sql, values });
    if (/FROM Respondent r/.test(sql)) {
      return {
        rows: [{
          respondent_id: 91,
          response: null,
          can_respond: true,
          survey_id: 'survey-requiredness-id'
        }]
      };
    }
    if (/SELECT questions FROM Survey WHERE id = \$1/.test(sql)) {
      return { rows: [{ questions: schema }] };
    }
    throw new Error(`Unexpected query: ${sql}`);
  };

  const persisted = [];
  pool.connect = async () => ({
    query: async (sql, values) => {
      persisted.push({ sql, values });
      return { rowCount: 1, rows: [] };
    },
    release() {}
  });

  const missingRequired = await request(app)
    .post('/api/user')
    .send({ surveyName: 'Survey A', userId: 'valid-token', answers: '{}' });
  assert.equal(missingRequired.status, 400);
  assert.equal(missingRequired.body.message, 'Invalid survey responses.');
  assert.deepEqual(missingRequired.body.errors, ['Invalid response: question_1']);
  assert.equal(persisted.length, 0, 'invalid answers must not be persisted');

  const malformedValues = await request(app)
    .post('/api/user')
    .send({
      surveyName: 'Survey A',
      userId: 'valid-token',
      answers: JSON.stringify({
        show: false,
        question_1: ['a'],
        question_2: 'one',
        question_3: 10,
        question_4: 'maybe'
      })
    });
  assert.equal(malformedValues.status, 400);
  for (const name of ['question_2', 'question_3', 'question_4']) {
    assert.ok(malformedValues.body.errors.includes(`Invalid response: ${name}`));
  }
  assert.equal(persisted.length, 0, 'malformed values must not be persisted');

  const omittedOptional = await request(app)
    .post('/api/user')
    .send({
      surveyName: 'Survey A',
      userId: 'valid-token',
      answers: JSON.stringify({
        show: false,
        question_1: ['a'],
        question_2: ['one', 'two'],
        question_3: 2,
        question_4: 'yes'
      })
    });
  assert.equal(omittedOptional.status, 200);
  assert.deepEqual(omittedOptional.body, { success: true });
  assert.equal(persisted.length, 1);
  assert.deepEqual(persisted[0].values[0].question_1, ['a']);
  assert.deepEqual(persisted[0].values[0].question_2, ['one', 'two']);
  assert.equal(persisted[0].values[0].question_5, undefined, 'hidden required answer may be omitted');
  assert.equal(typeof persisted[0].values[0].timeStamp, 'string');
  assert.equal(queryCalls.filter(({ sql }) => /SELECT questions FROM Survey/.test(sql)).length, 3);
});

test('/api/user rejects nested required omissions and answer constraints before persistence', async (t) => {
  const originalQuery = pool.query;
  const originalConnect = pool.connect;
  t.after(() => {
    pool.query = originalQuery;
    pool.connect = originalConnect;
  });

  const schema = validateSurveyDefinition({ elements: [
    { type: 'radiogroup', name: 'source', choices: ['a', 'b', 'c'] },
    { type: 'checkbox', name: 'selected', choicesFromQuestion: 'source', minSelectedChoices: 1, maxSelectedChoices: 2 },
    { type: 'tagbox', name: 'tagged', choicesFromQuestion: 'source', claMaxSelections: 1 },
    { type: 'rating', name: 'rating', rateMin: 1, rateMax: 2, rateStep: 0.5 },
    { type: 'multipletext', name: 'details', items: [{ name: 'required', isRequired: true }] },
    { type: 'matrixdropdown', name: 'matrix', rows: ['row'], columns: [
      { name: 'required', cellType: 'text', isRequired: true },
    ] },
  ] });
  pool.query = async (sql) => {
    if (/FROM Respondent r/.test(sql)) {
      return { rows: [{ can_respond: true, survey_id: 'survey-constraints-id' }] };
    }
    if (/SELECT questions FROM Survey/.test(sql)) return { rows: [{ questions: schema }] };
    throw new Error(`Unexpected query: ${sql}`);
  };
  const persisted = [];
  pool.connect = async () => ({
    query: async (sql, values) => { persisted.push({ sql, values }); return { rowCount: 1, rows: [] }; },
    release() {},
  });

  const missingNested = await request(app).post('/api/user').send({
    surveyName: 'Survey A', userId: 'valid-token',
    answers: JSON.stringify({ details: {}, matrix: { row: {} } }),
  });
  assert.equal(missingNested.status, 400);
  assert.ok(missingNested.body.errors.includes('Invalid response: details'));
  assert.ok(missingNested.body.errors.includes('Invalid response: matrix'));

  const invalidConstraints = await request(app).post('/api/user').send({
    surveyName: 'Survey A', userId: 'valid-token',
    answers: JSON.stringify({
      source: 'a', selected: ['a', 'b', 'c'], tagged: ['a', 'b'], rating: 1.25,
      details: { required: 'present' }, matrix: { row: { required: 'present' } },
    }),
  });
  assert.equal(invalidConstraints.status, 400);
  for (const name of ['selected', 'tagged', 'rating']) {
    assert.ok(invalidConstraints.body.errors.includes(`Invalid response: ${name}`));
  }
  assert.equal(persisted.length, 0);

  const valid = await request(app).post('/api/user').send({
    surveyName: 'Survey A', userId: 'valid-token',
    answers: JSON.stringify({
      source: 'a', selected: ['a', 'c'], tagged: ['b'], rating: 1.5,
      details: { required: 'present' }, matrix: { row: { required: 'present' } },
    }),
  });
  assert.equal(valid.status, 200);
  assert.equal(persisted.length, 1);
});

test('/api/user validates lazy tagbox answers against exact same-survey respondent strings', async (t) => {
  const originalQuery = pool.query;
  const originalConnect = pool.connect;
  t.after(() => {
    pool.query = originalQuery;
    pool.connect = originalConnect;
  });

  let schema = validateSurveyDefinition({ elements: [
    {
      type: 'tagbox', name: 'people', choicesLazyLoadEnabled: true,
      choices: ['Configured', { value: 7, text: 'Seven' }, true],
    },
  ] });
  const choiceQueries = [];
  pool.query = async (sql, values) => {
    if (/FROM Respondent r[\s\S]+JOIN Survey s/.test(sql)) {
      return { rows: [{ can_respond: true, survey_id: 'survey-a-id' }] };
    }
    if (/SELECT questions FROM Survey/.test(sql)) return { rows: [{ questions: schema }] };
    if (/SELECT r\.name, r\.contact_info/.test(sql)) {
      choiceQueries.push({ sql, values });
      return { rows: [
        { name: 'Alice', contact_info: 'alice@example.com' },
        { name: 'Bob', contact_info: 'bob@example.com' },
        { name: null, contact_info: 'contact-only@example.com' },
        { name: 'Name Only', contact_info: null },
      ] };
    }
    throw new Error(`Unexpected query: ${sql}`);
  };
  const persisted = [];
  pool.connect = async () => ({
    query: async (sql, values) => { persisted.push({ sql, values }); return { rows: [], rowCount: 1 }; },
    release() {},
  });

  const omitted = await request(app).post('/api/user').send({
    surveyName: 'Survey A', userId: 'current-token', answers: '{}',
  });
  assert.equal(omitted.status, 200);
  assert.equal(choiceQueries.length, 0, 'an omitted lazy tagbox must not query respondents');

  const configuredOnly = await request(app).post('/api/user').send({
    surveyName: 'Survey A', userId: 'current-token',
    answers: JSON.stringify({ people: ['Configured', 7, true] }),
  });
  assert.equal(configuredOnly.status, 200);
  assert.equal(choiceQueries.length, 0, 'configured strings and primitive choices must not query respondents');

  const valid = await request(app).post('/api/user').send({
    surveyName: 'Survey A', userId: 'current-token',
    answers: JSON.stringify({ people: ['Configured', 7, true, 'Alice (alice@example.com)'] }),
  });
  assert.equal(valid.status, 200);
  assert.equal(persisted.length, 3);
  assert.match(choiceQueries[0].sql, /r\.uuid != \$3/);
  assert.match(choiceQueries[0].sql,
    /CONCAT\(COALESCE\(r\.name, ''\), ' \(', COALESCE\(r\.contact_info, ''\), '\)'\) = ANY\(\$4::text\[\]\)/);
  assert.deepEqual(choiceQueries[0].values, [
    'survey-a-id', 'Survey A', 'current-token', ['Alice (alice@example.com)']
  ], 'only the unconfigured submitted string is verified in the database');

  assert.equal(formatRespondentChoice({ name: null, contact_info: 'contact-only@example.com' }),
    ' (contact-only@example.com)');
  assert.equal(formatRespondentChoice({ name: 'Name Only', contact_info: null }), 'Name Only ()');
  const nullableValues = [' (contact-only@example.com)', 'Name Only ()'];
  const nullable = await request(app).post('/api/user').send({
    surveyName: 'Survey A', userId: 'current-token',
    answers: JSON.stringify({ people: nullableValues }),
  });
  assert.equal(nullable.status, 200);
  assert.deepEqual(choiceQueries[1].values[3], nullableValues,
    'SQL exact matching must use the same empty-string normalization as response formatting');
  assert.equal(persisted.length, 4);

  const forged = await request(app).post('/api/user').send({
    surveyName: 'Survey A', userId: 'current-token',
    answers: JSON.stringify({ people: ['Alice (forged@example.com)'] }),
  });
  assert.equal(forged.status, 400);
  assert.deepEqual(forged.body.errors, ['Invalid response: people']);
  assert.equal(persisted.length, 4, 'forged lazy choices must not persist');
  assert.deepEqual(choiceQueries[2].values[3], ['Alice (forged@example.com)'],
    'forged validation should query only the exact submitted value');

  schema = { elements: [{
    type: 'dropdown', name: 'remote', choicesByUrl: { url: 'https://example.test/choices' }
  }] };
  const remoteLegacy = await request(app).post('/api/user').send({
    surveyName: 'Survey A', userId: 'current-token', answers: JSON.stringify({ remote: 'choice' }),
  });
  assert.equal(remoteLegacy.status, 400);
  assert.ok(remoteLegacy.body.errors.some((error) =>
    /unsupported property choicesByUrl.*server-side URL choice resolution is not supported/.test(error)));
  assert.equal(choiceQueries.length, 3, 'legacy choicesByUrl must be rejected without a choice lookup');
  assert.equal(persisted.length, 4);

  schema = { elements: [{ type: 'dropdown', name: 'lazy', choicesLazyLoadEnabled: true }] };
  const nonTagboxLazyLegacy = await request(app).post('/api/user').send({
    surveyName: 'Survey A', userId: 'current-token', answers: '{}',
  });
  assert.equal(nonTagboxLazyLegacy.status, 400);
  assert.ok(nonTagboxLazyLegacy.body.errors.some((error) =>
    /unsupported property choicesLazyLoadEnabled for type dropdown.*supported only for tagbox/.test(error)));

  schema = { elements: [{ type: 'tagbox', name: 'tags', allowAddNewTag: true }] };
  const addNewTagLegacy = await request(app).post('/api/user').send({
    surveyName: 'Survey A', userId: 'current-token', answers: '{}',
  });
  assert.equal(addNewTagLegacy.status, 400);
  assert.ok(addNewTagLegacy.body.errors.some((error) =>
    /unsupported property allowAddNewTag=true.*Set allowAddNewTag to false or remove it/.test(error)));
  assert.equal(persisted.length, 4, 'unsupported legacy schema properties must not persist answers');

  schema = { elements: [{ type: 'text', name: 'legacy', valueName: 'shared' }] };
  const aliasedLegacy = await request(app).post('/api/user').send({
    surveyName: 'Survey A', userId: 'current-token', answers: JSON.stringify({ legacy: 'answer' }),
  });
  assert.equal(aliasedLegacy.status, 400);
  assert.ok(aliasedLegacy.body.errors.some((error) =>
    /Unsupported question property: valueName.*Remove valueName/.test(error)));
  assert.equal(persisted.length, 4);

  schema = { elements: [{ type: 'old-custom-widget', name: 'legacy' }] };
  const unsupported = await request(app).post('/api/user').send({
    surveyName: 'Survey A', userId: 'current-token', answers: '{}',
  });
  assert.equal(unsupported.status, 400);
  assert.deepEqual(unsupported.body.errors, ['Unsupported question type: old-custom-widget']);
  assert.equal(persisted.length, 4);
});

test('/api/user returns a client error for malformed or non-object answers', async (t) => {
  const originalQuery = pool.query;
  const originalConnect = pool.connect;
  t.after(() => {
    pool.query = originalQuery;
    pool.connect = originalConnect;
  });

  let schemaQueries = 0;
  pool.query = async (sql) => {
    if (/FROM Respondent r/.test(sql)) {
      return { rows: [{ can_respond: true, survey_id: 'survey-requiredness-id' }] };
    }
    schemaQueries += 1;
    return { rows: [] };
  };
  pool.connect = async () => {
    throw new Error('invalid answers must not be persisted');
  };

  const malformed = await request(app)
    .post('/api/user')
    .send({ surveyName: 'Survey A', userId: 'valid-token', answers: '{' });
  assert.equal(malformed.status, 400);
  assert.equal(malformed.body.message, 'Answers must be valid JSON.');

  const arrayAnswers = await request(app)
    .post('/api/user')
    .send({ surveyName: 'Survey A', userId: 'valid-token', answers: '[]' });
  assert.equal(arrayAnswers.status, 400);
  assert.equal(arrayAnswers.body.message, 'Invalid survey responses.');
  assert.deepEqual(arrayAnswers.body.errors, ['Answers must be an object.']);
  assert.equal(schemaQueries, 0, 'invalid answer envelopes must fail before loading the schema');
});

test('dashboard URL helpers prefer DASHBOARD_URL and fall back to FRONTEND_URL', (t) => {
  const originalDashboardUrl = process.env.DASHBOARD_URL;
  const originalFrontendUrl = process.env.FRONTEND_URL;
  t.after(() => {
    if (originalDashboardUrl === undefined) delete process.env.DASHBOARD_URL;
    else process.env.DASHBOARD_URL = originalDashboardUrl;
    if (originalFrontendUrl === undefined) delete process.env.FRONTEND_URL;
    else process.env.FRONTEND_URL = originalFrontendUrl;
  });

  delete process.env.DASHBOARD_URL;
  process.env.FRONTEND_URL = 'https://dashboard.example.com/';
  assert.equal(getDashboardBaseUrl(), 'https://dashboard.example.com');
  assert.equal(buildDashboardUrl('/accept-invite?token=abc'), 'https://dashboard.example.com/accept-invite?token=abc');

  process.env.DASHBOARD_URL = 'https://admin.example.com/';
  assert.equal(getDashboardBaseUrl(), 'https://admin.example.com');
  assert.equal(buildDashboardUrl('reset-password?token=abc'), 'https://admin.example.com/reset-password?token=abc');
});

test('demo links are signed, survey-bound, and expire without database state', () => {
  const surveyId = '11111111-1111-4111-8111-111111111111';
  const issuedAt = Date.now();
  const token = createDemoToken(surveyId, 'Survey A', issuedAt);

  assert.deepEqual(
    Object.fromEntries(Object.entries(verifyDemoToken(token, issuedAt + 1)).filter(([key]) => key !== 'nonce')),
    { type: 'survey-demo', surveyId, surveyName: 'Survey A', expiresAt: issuedAt + (24 * 60 * 60 * 1000) }
  );
  const tokenParts = token.split('.');
  tokenParts[2] = `${tokenParts[2][0] === 'A' ? 'B' : 'A'}${tokenParts[2].slice(1)}`;
  assert.equal(verifyDemoToken(tokenParts.join('.'), issuedAt + 1), null);
  assert.equal(verifyDemoToken(token, issuedAt + (24 * 60 * 60 * 1000)), null);
});

test('demo schema sanitization recursively replaces legacy people choices', () => {
  const privateChoices = ['Private Person (private@example.com)'];
  const schema = {
    pages: [{
      elements: [{
        type: 'panel',
        elements: [{ type: 'tagbox', name: 'nested', choices: privateChoices }],
      }, {
        type: 'paneldynamic',
        templateElements: [{
          type: 'matrixdropdown',
          cellType: 'tagbox',
          columns: [{ name: 'person', choicesFromQuestion: 'matrix_source', defaultValue: privateChoices }],
        }],
      }, {
        type: 'dropdown', name: 'private_source', choicesFromQuestion: 'second_source', defaultValue: privateChoices[0],
      }, {
        type: 'tagbox', name: 'from_source', choicesFromQuestion: 'private_source', defaultValue: privateChoices,
      }, {
        type: 'dropdown', name: 'matrix_source', choices: privateChoices, defaultValue: privateChoices[0],
      }, {
        type: 'dropdown', name: 'second_source', choices: privateChoices,
      }, {
        type: 'text', name: 'private_source', choicesByUrl: { url: 'https://user:secret@private.example/choices' },
      }],
    }],
  };

  const sanitized = sanitizeSurveyForDemo(schema);
  const elements = sanitized.pages[0].elements;
  const nestedTagbox = elements[0].elements[0];
  const matrixTagbox = elements[1].templateElements[0].columns[0];
  const sourceQuestion = elements[2];
  const sourceTagbox = elements[3];
  const matrixSourceQuestion = elements[4];
  const secondSourceQuestion = elements[5];
  const duplicateSourceName = elements[6];
  for (const question of [nestedTagbox, matrixTagbox, sourceTagbox]) {
    assert.deepEqual(question.choices, []);
    assert.equal(question.choicesLazyLoadEnabled, true);
    assert.equal(question.allowAddNewTag, false);
    assert.equal(question.choicesFromQuestion, undefined);
    assert.equal(question.defaultValue, undefined);
  }
  for (const source of [sourceQuestion, matrixSourceQuestion, secondSourceQuestion, duplicateSourceName]) {
    assert.equal(source.choices.length, 100);
    assert.equal(source.choices[0], 'Demo Person 001 (demo-person-001@example.com)');
    assert.equal(source.choices.includes(privateChoices[0]), false);
    assert.equal(source.defaultValue, undefined);
    assert.equal(source.choicesByUrl, undefined);
  }
  assert.deepEqual(schema.pages[0].elements[0].elements[0].choices, privateChoices, 'persisted schema is not mutated');
});

test('signed demo links load survey questions but cannot be used for a different survey', async (t) => {
  const originalConnect = pool.connect;
  t.after(() => { pool.connect = originalConnect; });

  const surveyId = '11111111-1111-4111-8111-111111111111';
  const token = createDemoToken(surveyId, 'Survey A');
  let queryCount = 0;
  pool.connect = async () => ({
    query: async (sql, values) => {
      queryCount += 1;
      assert.match(sql, /WHERE \(id = \$1/);
      assert.deepEqual(values, [surveyId, 'Survey A']);
      return { rows: [{
        title: 'Configured title',
        questions: { elements: [
          { type: 'text', name: 'q1' },
          {
            type: 'tagbox',
            name: 'people',
            choicesLazyLoadEnabled: true,
            choices: ['Private Person (private@example.com)'],
          },
        ] },
      }] };
    },
    release() {},
  });

  const valid = await request(app).get('/api/questions').query({ surveyName: 'Survey A', demoToken: token });
  assert.equal(valid.status, 200);
  assert.equal(valid.body.title, 'Configured title');
  assert.deepEqual(valid.body.questions.elements[1].choices, [], 'demo schemas scrub persisted people choices');

  const names = await request(app).get('/api/names').query({ surveyName: 'Survey A', demoToken: token, take: 2 });
  assert.equal(names.status, 200);
  assert.deepEqual(names.body, {
    names: [
      'Demo Person 001 (demo-person-001@example.com)',
      'Demo Person 002 (demo-person-002@example.com)',
    ],
    total: 100,
  }, 'demo links use synthetic choices instead of exposing respondent PII');

  const wrongSurvey = await request(app).get('/api/questions').query({ surveyName: 'Survey B', demoToken: token });
  assert.equal(wrongSurvey.status, 403);
  assert.equal(queryCount, 1);
});

test('dashboard/admin endpoints require authentication', async () => {
  const endpoints = [
    ['post', '/api/survey', { surveyName: 'S' }],
    ['post', '/api/testEmail', { surveyName: 'S', language: 'English', email: 'a@example.com' }],
    ['post', '/api/surveys/survey-id/demo-email', { language: 'English', email: 'a@example.com' }],
    ['post', '/api/surveys/survey-id/copy', { name: 'Copied survey' }],
    ['post', '/api/startSurvey', { surveyName: 'S' }],
    ['post', '/api/updateEmails', { surveyName: 'S', csvData: 'English,Hello' }],
    ['post', '/api/updateTarget', { surveyName: 'S', csvData: 'First,Last,Email\nA,B,a@example.com' }],
    ['post', '/api/updateTargets', { surveyName: 'S', csvData: 'First,Last,Email\nA,B,a@example.com' }],
    ['post', '/api/updateQuestions', { surveyName: 'S', questions: { elements: [] } }],
    ['get', '/api/survey-notifications/S'],
    ['put', '/api/survey-notifications/S/subject', { language: 'English', subject: 'Invitation' }],
    ['get', '/api/admin/names?surveyName=S'],
    ['get', '/api/admin/questions?surveyName=S'],
    ['get', '/api/listQuestions?surveyName=S'],
    ['get', '/api/results?surveyName=S'],
    ['get', '/api/targets?surveyName=S'],
    ['get', '/api/surveyStatus?surveyName=S'],
    ['get', '/api/orgs'],
  ];

  for (const [method, url, body] of endpoints) {
    const res = await request(app)[method](url).send(body || {});
    assert.equal(res.status, 401, `${method.toUpperCase()} ${url}`);
  }
});

test('public signup can be disabled by ALLOW_PUBLIC_SIGNUP=false', async () => {
  const res = await request(app)
    .post('/api/register')
    .send({ username: 'new-user', password: 'password123' });

  assert.equal(res.status, 403);
});

test('login rejects disabled users before creating a session', async (t) => {
  const originalQuery = pool.query;
  t.after(() => {
    pool.query = originalQuery;
  });

  const hashedPassword = await bcrypt.hash('password123', 4);
  pool.query = async (sql, values) => {
    assert.match(sql, /SELECT \* FROM users WHERE username = \$1/);
    assert.deepEqual(values, ['disabled-user']);
    return { rows: [{ id: 44, username: 'disabled-user', password: hashedPassword, status: 'disabled' }] };
  };

  const res = await request(app)
    .post('/api/login')
    .send({ username: 'disabled-user', password: 'password123' });

  assert.equal(res.status, 403);
  assert.match(res.body.error, /disabled/i);
});

test('login updates last_login_at when IAM column exists and returns safe user shape', async (t) => {
  const originalQuery = pool.query;
  t.after(() => {
    pool.query = originalQuery;
  });

  const hashedPassword = await bcrypt.hash('password123', 4);
  let updatedLastLogin = false;
  pool.query = async (sql, values) => {
    if (/SELECT \* FROM users WHERE username = \$1/.test(sql)) {
      return {
        rows: [{
          id: 45,
          username: 'active-user',
          password: hashedPassword,
          email: 'active@example.com',
          display_name: 'Active User',
          status: 'active',
          is_platform_admin: false,
        }]
      };
    }

    if (/information_schema\.columns/.test(sql)) {
      assert.deepEqual(values, ['users', 'last_login_at']);
      return { rows: [{ '?column?': 1 }] };
    }

    if (/UPDATE users SET last_login_at = CURRENT_TIMESTAMP WHERE id = \$1/.test(sql)) {
      updatedLastLogin = true;
      assert.deepEqual(values, [45]);
      return { rows: [], rowCount: 1 };
    }

    // connect-pg-simple session destroy/set/touch queries during regenerate/save.
    if (/sessions/i.test(sql)) {
      return { rows: [], rowCount: 1 };
    }

    return { rows: [], rowCount: 0 };
  };

  const res = await request(app)
    .post('/api/login')
    .send({ username: 'active-user', password: 'password123' });

  assert.equal(res.status, 200);
  assert.equal(updatedLastLogin, true);
  assert.equal(res.body.user.username, 'active-user');
  assert.equal(res.body.user.email, 'active@example.com');
  assert.equal(res.body.user.displayName, 'Active User');
  assert.equal(res.body.user.password, undefined);
});

test('requireAuth loads current user and rejects disabled account status', async (t) => {
  const originalQuery = pool.query;
  t.after(() => {
    pool.query = originalQuery;
  });

  pool.query = async (sql, values) => {
    assert.match(sql, /SELECT \* FROM users WHERE id = \$1/);
    assert.deepEqual(values, [52]);
    return { rows: [{ id: 52, username: 'disabled-user', status: 'disabled' }] };
  };

  const req = { session: { userId: 52 } };
  const res = {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
  let nextCalled = false;

  await requireAuth(req, res, () => { nextCalled = true; });

  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 403);
  assert.match(res.body.error, /disabled/i);
});

test('schema capability helpers do not cache failed inspections as false', async (t) => {
  const originalQuery = pool.query;
  t.after(() => {
    pool.query = originalQuery;
  });

  let calls = 0;
  pool.query = async () => {
    calls += 1;
    if (calls === 1) {
      throw new Error('temporary metadata outage');
    }
    return { rows: [{ '?column?': 1 }] };
  };

  const columnName = `temporary_column_${Date.now()}`;
  assert.equal(await columnExists('users', columnName), false);
  assert.equal(await columnExists('users', columnName), true);
  assert.equal(calls, 2);
});

test('schema capability helpers do not cache failed table inspections as false', async (t) => {
  const originalQuery = pool.query;
  t.after(() => {
    pool.query = originalQuery;
  });

  let calls = 0;
  pool.query = async () => {
    calls += 1;
    if (calls === 1) {
      throw new Error('temporary metadata outage');
    }
    return { rows: [{ '?column?': 1 }] };
  };

  const tableName = `temporary_table_${Date.now()}`;
  assert.equal(await tableExists(tableName), false);
  assert.equal(await tableExists(tableName), true);
  assert.equal(calls, 2);
});

test('safe user serialization omits password hashes', () => {
  const safe = toSafeUser({
    id: 1,
    username: 'user',
    password: 'hash',
    email: 'user@example.com',
    display_name: 'User',
    status: 'active',
    is_platform_admin: true,
  });

  assert.deepEqual(safe, {
    id: 1,
    username: 'user',
    email: 'user@example.com',
    displayName: 'User',
    status: 'active',
    isPlatformAdmin: true,
    lastLoginAt: null,
  });
  assert.equal(safe.password, undefined);
});

test('remaining IAM migration adds audit, invite/reset, and non-destructive survey identifier foundation', () => {
  const changelog = fs.readFileSync(path.join(__dirname, '../../db/changelogs/master-changelog.xml'), 'utf8');
  const remaining = fs.readFileSync(path.join(__dirname, '../../db/changelogs/v1_4_product_iam_remaining.sql'), 'utf8');

  assert.match(changelog, /v1_4_product_iam_remaining\.sql/);
  assert.match(remaining, /CREATE TABLE IF NOT EXISTS audit_events/i);
  assert.match(remaining, /CREATE TABLE IF NOT EXISTS organization_invites/i);
  assert.match(remaining, /CREATE TABLE IF NOT EXISTS password_reset_tokens/i);
  assert.match(remaining, /ALTER TABLE Survey ADD COLUMN IF NOT EXISTS display_name/i);
  assert.match(remaining, /CREATE UNIQUE INDEX IF NOT EXISTS idx_survey_org_slug_active/i);
  assert.match(remaining, /active_slug_population/i);
  assert.match(remaining, /active_slug_duplicates/i);
  assert.match(remaining, /slug = s\.slug \|\| '-' \|\| s\.id::text/i);
  assert.doesNotMatch(remaining, /\bDROP\b|\bTRUNCATE\b|\bDELETE\s+FROM\b|ALTER\s+TABLE[\s\S]+DROP\s+COLUMN/i);
});

test('password reset request stores only token hash and returns raw token only with explicit manual-delivery flag', async (t) => {
  const originalQuery = pool.query;
  const originalReturnDevTokens = process.env.RETURN_DEV_TOKENS;
  process.env.RETURN_DEV_TOKENS = 'true';
  t.after(() => {
    pool.query = originalQuery;
    if (originalReturnDevTokens === undefined) delete process.env.RETURN_DEV_TOKENS;
    else process.env.RETURN_DEV_TOKENS = originalReturnDevTokens;
  });

  const calls = [];
  pool.query = async (sql, values) => {
    calls.push({ sql, values });
    if (/SELECT id, username, email FROM users/.test(sql)) {
      return { rows: [{ id: 9, username: 'reset-user', email: 'reset@example.com' }] };
    }
    if (/information_schema\.tables/.test(sql)) {
      return { rows: [] };
    }
    return { rows: [], rowCount: 1 };
  };

  const res = await request(app)
    .post('/api/password-reset/request')
    .send({ username: 'reset-user' });

  assert.equal(res.status, 200);
  assert.equal(typeof res.body.token, 'string');
  const insertCall = calls.find(call => /INSERT INTO password_reset_tokens/.test(call.sql));
  assert.ok(insertCall);
  assert.notEqual(insertCall.values[1], res.body.token);
  assert.equal(insertCall.values[1], hashToken(res.body.token));
});

test('password reset request does not expose raw token based on NODE_ENV alone', async (t) => {
  const originalQuery = pool.query;
  const originalReturnDevTokens = process.env.RETURN_DEV_TOKENS;
  delete process.env.RETURN_DEV_TOKENS;
  t.after(() => {
    pool.query = originalQuery;
    if (originalReturnDevTokens === undefined) delete process.env.RETURN_DEV_TOKENS;
    else process.env.RETURN_DEV_TOKENS = originalReturnDevTokens;
  });

  pool.query = async (sql) => {
    if (/SELECT id, username, email FROM users/.test(sql)) {
      return { rows: [{ id: 19, username: 'reset-user', email: 'reset@example.com' }] };
    }
    return { rows: [], rowCount: 1 };
  };

  const res = await request(app)
    .post('/api/password-reset/request')
    .send({ username: 'reset-user' });

  assert.equal(res.status, 200);
  assert.equal(res.body.success, true);
  assert.equal(res.body.token, undefined);
  assert.equal(res.body.resetUrl, undefined);
});

test('member update API prevents admins from assigning owner role', async (t) => {
  const originalQuery = pool.query;
  const originalConnect = pool.connect;
  t.after(() => {
    pool.query = originalQuery;
    pool.connect = originalConnect;
  });

  const hashedPassword = await bcrypt.hash('password123', 4);
  pool.query = async (sql, values) => {
    if (/SELECT \* FROM users WHERE username = \$1/.test(sql)) {
      return { rows: [{ id: 10, username: 'admin-user', password: hashedPassword, status: 'active' }] };
    }
    if (/SELECT \* FROM users WHERE id = \$1/.test(sql)) {
      return { rows: [{ id: 10, username: 'admin-user', status: 'active' }] };
    }
    if (/information_schema\.columns/.test(sql)) return { rows: [] };
    if (/SELECT[\s\S]+sess[\s\S]+FROM[\s\S]+sessions/i.test(sql)) {
      return { rows: [{ sess: { cookie: {}, userId: 10, username: 'admin-user' } }], rowCount: 1 };
    }
    if (/sessions/i.test(sql)) return { rows: [], rowCount: 1 };
    if (/FROM organization_memberships om/.test(sql)) return { rows: [] };
    if (/FROM organization_memberships\s+WHERE organization_id = \$1 AND user_id = \$2/.test(sql)) {
      return { rows: [{ role: 'admin', organization_id: values[0] }] };
    }
    return { rows: [], rowCount: 0 };
  };

  const agent = request.agent(app);
  const loginRes = await agent.post('/api/login').send({ username: 'admin-user', password: 'password123' });
  assert.equal(loginRes.status, 200);

  let updateAttempted = false;
  pool.connect = async () => ({
    query: async (sql, values) => {
      if (sql === 'BEGIN' || sql === 'ROLLBACK' || sql === 'COMMIT') return { rows: [], rowCount: 0 };
      if (/SELECT om\.role\s+FROM organization_memberships om/.test(sql)) {
        return { rows: [{ role: 'admin' }] };
      }
      if (/SELECT om\.role, u\.status, u\.username/.test(sql)) {
        return { rows: [{ role: 'editor', status: 'active', username: 'target-user' }] };
      }
      if (/UPDATE organization_memberships|UPDATE users/.test(sql)) updateAttempted = true;
      return { rows: [], rowCount: 0 };
    },
    release() {}
  });

  const res = await agent
    .patch('/api/orgs/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/members/11')
    .send({ role: 'owner' });

  assert.equal(res.status, 403);
  assert.match(res.body.message, /Only owners can assign owner role/);
  assert.equal(updateAttempted, false);
});

test('platform admin organization list endpoint requires platform admin and returns member counts', async (t) => {
  const originalQuery = pool.query;
  t.after(() => {
    pool.query = originalQuery;
  });

  const hashedPassword = await bcrypt.hash('password123', 4);
  pool.query = async (sql, values) => {
    if (/SELECT \* FROM users WHERE username = \$1/.test(sql)) {
      return { rows: [{ id: 77, username: 'platform-user', password: hashedPassword, status: 'active', is_platform_admin: true }] };
    }
    if (/SELECT \* FROM users WHERE id = \$1/.test(sql)) {
      return { rows: [{ id: 77, username: 'platform-user', status: 'active', is_platform_admin: true }] };
    }
    if (/information_schema\.columns/.test(sql) || /information_schema\.tables/.test(sql)) return { rows: [] };
    if (/SELECT[\s\S]+sess[\s\S]+FROM[\s\S]+sessions/i.test(sql)) {
      return { rows: [{ sess: { cookie: {}, userId: 77, username: 'platform-user' } }], rowCount: 1 };
    }
    if (/sessions/i.test(sql)) return { rows: [], rowCount: 1 };
    if (/SELECT o\.id, o\.name, o\.slug, COUNT\(om\.user_id\)::int AS "memberCount"/.test(sql)) {
      return { rows: [{ id: 'org-1', name: 'Default / Imported', slug: 'default-imported', memberCount: 2 }] };
    }
    return { rows: [], rowCount: 0 };
  };

  const agent = request.agent(app);
  const loginRes = await agent.post('/api/login').send({ username: 'platform-user', password: 'password123' });
  assert.equal(loginRes.status, 200);

  const res = await agent.get('/api/orgs');
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.organizations, [{ id: 'org-1', name: 'Default / Imported', slug: 'default-imported', memberCount: 2 }]);
});

test('local db setup bootstraps local admin IAM access after migrations', () => {
  const setupSource = fs.readFileSync(path.join(__dirname, '../../scripts/db-setup.js'), 'utf8');
  assert.match(setupSource, /is_platform_admin/);
  assert.match(setupSource, /status = EXCLUDED\.status/);
  assert.match(setupSource, /organization_memberships/);
  assert.match(setupSource, /default-imported/);
  assert.match(setupSource, /DO UPDATE SET role = 'owner'/);
});

test('member management, invite, reset, and audit routes are present with required guardrails', () => {
  const serverSource = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
  assert.match(serverSource, /app\.get\('\/api\/orgs'/);
  assert.match(serverSource, /Platform admin access is required/);
  assert.match(serverSource, /app\.get\('\/api\/orgs\/:organizationId\/members'/);
  assert.match(serverSource, /app\.patch\('\/api\/orgs\/:organizationId\/members\/:userId'/);
  assert.match(serverSource, /You cannot disable your own account/);
  assert.match(serverSource, /Cannot remove the last active owner/);
  assert.match(serverSource, /Only owners can modify owners/);
  assert.match(serverSource, /Only owners can assign owner role/);
  assert.match(serverSource, /lockedActorMembership/);
  assert.match(serverSource, /FOR UPDATE`/);
  assert.match(serverSource, /lockRows: true/);
  assert.match(serverSource, /app\.post\('\/api\/orgs\/:organizationId\/invites'/);
  assert.match(serverSource, /app\.post\('\/api\/invites\/accept'/);
  assert.match(serverSource, /app\.post\('\/api\/password-reset\/request'/);
  assert.match(serverSource, /app\.post\('\/api\/password-reset\/complete'/);
  assert.match(serverSource, /eventType: 'member\.updated'/);
  assert.match(serverSource, /eventType: 'survey\.archived'/);
});

test('/api/testEmail rejects arbitrary recipients instead of falling back to another respondent token', async (t) => {
  const originalQuery = pool.query;
  const originalConnect = pool.connect;
  t.after(() => {
    pool.query = originalQuery;
    pool.connect = originalConnect;
  });

  const hashedPassword = await bcrypt.hash('password123', 4);
  pool.query = async (sql, values) => {
    if (/SELECT \* FROM users WHERE username = \$1/.test(sql)) {
      return { rows: [{ id: 31, username: 'editor-user', password: hashedPassword, status: 'active' }] };
    }
    if (/SELECT \* FROM users WHERE id = \$1/.test(sql)) {
      return { rows: [{ id: 31, username: 'editor-user', status: 'active' }] };
    }
    if (/information_schema\.columns/.test(sql)) return { rows: [] };
    if (/SELECT[\s\S]+sess[\s\S]+FROM[\s\S]+sessions/i.test(sql)) {
      return { rows: [{ sess: { cookie: {}, userId: 31, username: 'editor-user' } }], rowCount: 1 };
    }
    if (/sessions/i.test(sql)) return { rows: [], rowCount: 1 };
    if (/LEFT JOIN organization_memberships/.test(sql)) {
      return {
        rows: [{
          id: '11111111-1111-4111-8111-111111111111',
          name: 'Survey A',
          organization_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          role: 'editor',
        }]
      };
    }
    return { rows: [], rowCount: 0 };
  };

  const sendTestQueries = [];
  pool.connect = async () => ({
    query: async (sql, values) => {
      sendTestQueries.push({ sql, values });
      if (/SELECT text, invitation_subject FROM email/.test(sql)) {
        return { rows: [{ text: 'Hello {{link}}', invitation_subject: 'Invitation' }] };
      }
      if (/SELECT uuid FROM Respondent/.test(sql)) {
        assert.match(sql, /lower\(contact_info\) = lower\(\$3\)/);
        assert.deepEqual(values, ['11111111-1111-4111-8111-111111111111', 'Survey A', 'attacker@example.com']);
        return { rows: [] };
      }
      return { rows: [], rowCount: 0 };
    },
    release() {}
  });

  const agent = request.agent(app);
  const loginRes = await agent.post('/api/login').send({ username: 'editor-user', password: 'password123' });
  assert.equal(loginRes.status, 200);

  const res = await agent
    .post('/api/testEmail')
    .send({ surveyName: 'Survey A', language: 'English', email: 'attacker@example.com' });

  assert.equal(res.status, 404);
  assert.match(res.body.message, /Reminders can only be sent/);
  assert.equal(sendTestQueries.some((call) => /SELECT uuid FROM Respondent/.test(call.sql)), true);
});

test('dashboard read-only tables hide edit controls and demo email avoids public demo token', () => {
  const questionTable = fs.readFileSync(path.join(__dirname, '../../dashboard/src/components/QuestionTable.js'), 'utf8');
  const respondentTable = fs.readFileSync(path.join(__dirname, '../../dashboard/src/components/RespondentTable.js'), 'utf8');
  const serverSource = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');

  assert.match(questionTable, /readOnly = false/);
  assert.match(questionTable, /editable: !readOnly/);
  assert.match(questionTable, /!readOnly &&/);
  assert.match(respondentTable, /readOnly = false/);
  assert.match(respondentTable, /disabled=\{readOnly\}/);
  assert.match(respondentTable, /!readOnly &&/);
  assert.match(respondentTable, /surveyName,/);
  assert.doesNotMatch(respondentTable, /params\.row\.surveyName/);
  assert.doesNotMatch(serverSource, /sendMail\(email, 'demo'/);
  assert.match(serverSource, /lower\(contact_info\) = lower\(\$3\)/);
  assert.match(serverSource, /No active respondent token found/);
});

test('demo seed is local-guarded, idempotent, and uses real respondent tokens', () => {
  const seed = fs.readFileSync(path.join(__dirname, '../../scripts/dev/seed-demo-account.js'), 'utf8');
  const menu = fs.readFileSync(path.join(__dirname, '../../dashboard/src/components/SurveyTableMenuCell.js'), 'utf8');
  assert.match(seed, /DEMO_SEED_ALLOW_NONLOCAL/);
  assert.match(seed, /ON CONFLICT \(slug\) DO UPDATE/);
  assert.match(seed, /ON CONFLICT \(username\) DO UPDATE/);
  assert.match(seed, /ON CONFLICT \(name, survey_name\) DO UPDATE/);
  assert.match(seed, /demo-alex-token/);
  assert.doesNotMatch(seed, /userId=demo/);
  assert.doesNotMatch(menu, /userId=demo/);
});

test('Phase 2/3 IAM migrations are included and avoid destructive operations', () => {
  const changelog = fs.readFileSync(path.join(__dirname, '../../db/changelogs/master-changelog.xml'), 'utf8');
  const phase2 = fs.readFileSync(path.join(__dirname, '../../db/changelogs/v1_2_product_iam_foundation.sql'), 'utf8');
  const archive = fs.readFileSync(path.join(__dirname, '../../db/changelogs/v1_3_survey_archive.sql'), 'utf8');

  assert.match(changelog, /v1_2_product_iam_foundation\.sql/);
  assert.match(changelog, /v1_3_survey_archive\.sql/);
  assert.match(phase2, /CREATE EXTENSION IF NOT EXISTS pgcrypto/i);
  assert.match(phase2, /CREATE TABLE IF NOT EXISTS organizations/i);
  assert.match(phase2, /organization_memberships/i);
  assert.match(phase2, /ALTER TABLE Survey ADD COLUMN IF NOT EXISTS id UUID;/i);
  assert.match(phase2, /UPDATE Survey SET id = gen_random_uuid\(\) WHERE id IS NULL/i);
  assert.match(phase2, /ALTER TABLE Survey ALTER COLUMN id SET DEFAULT gen_random_uuid\(\)/i);
  assert.match(phase2, /conrelid = 'users'::regclass/i);
  assert.match(archive, /ADD COLUMN IF NOT EXISTS archived_at/i);
  assert.match(archive, /ADD COLUMN IF NOT EXISTS archived_by_user_id/i);
  assert.doesNotMatch(phase2 + '\n' + archive, /\bDROP\b|\bTRUNCATE\b|\bDELETE\s+FROM\b|ALTER\s+TABLE[\s\S]+DROP\s+COLUMN/i);
});

test('role policy matrix matches org-scoped authorization decisions', () => {
  for (const role of ['viewer', 'analyst', 'editor', 'admin', 'owner']) {
    assert.equal(hasAnyRole(role, READ_SURVEY_ROLES), true, `${role} can read metadata/questions`);
  }

  assert.equal(hasAnyRole('viewer', ANALYST_ROLES), false);
  assert.equal(hasAnyRole('analyst', ANALYST_ROLES), true);
  assert.equal(hasAnyRole('analyst', EDITOR_ROLES), false);
  assert.equal(hasAnyRole('editor', EDITOR_ROLES), true);
  assert.equal(hasAnyRole('editor', ADMIN_ROLES), false);
  assert.equal(hasAnyRole('admin', ADMIN_ROLES), true);
  assert.equal(hasAnyRole('owner', ADMIN_ROLES), true);
});

test('survey copy transaction preserves configuration and roster while resetting respondent state', async (t) => {
  const originalConnect = pool.connect;
  t.after(() => { pool.connect = originalConnect; });

  const calls = [];
  const sourceQuestions = { title: 'Instructions', completedHtml: 'Thank you', elements: [{ type: 'text', name: 'question_1' }] };
  pool.connect = async () => ({
    query: async (sql, values) => {
      calls.push({ sql, values });
      if (/SELECT s\.id, s\.name, s\.title/.test(sql)) {
        return { rows: [{
          id: '11111111-1111-4111-8111-111111111111',
          name: 'Source Survey', title: 'Configured title', questions: sourceQuestions,
          organization_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', role: 'editor',
        }] };
      }
      if (/SELECT 1 FROM Survey/.test(sql)) return { rows: [] };
      if (/INSERT INTO Survey/.test(sql)) return { rows: [{
        id: '22222222-2222-4222-8222-222222222222', name: 'Copied Survey',
        title: 'Configured title', organization_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      }] };
      return { rows: [], rowCount: 2 };
    },
    release() {},
  });

  const copied = await copySurveyForUser({
    actor: { id: 7, isPlatformAdmin: false },
    sourceSurveyId: '11111111-1111-4111-8111-111111111111',
    name: '  Copied Survey  ',
  });
  assert.equal(copied.name, 'Copied Survey');
  assert.equal(copied.title, 'Configured title');
  assert.equal(copied.organizationId, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
  assert.equal(copied.respondentStateReset, true);
  assert.equal(calls[0].sql, 'BEGIN ISOLATION LEVEL REPEATABLE READ');
  assert.match(calls[1].sql, /JOIN organization_memberships/);
  assert.match(calls[1].sql, /om\.role = ANY\(\$3::text\[\]\)/);
  assert.match(calls[1].sql, /FOR SHARE OF s, om/);
  assert.deepEqual(calls[1].values, [7, '11111111-1111-4111-8111-111111111111', EDITOR_ROLES]);
  assert.equal(calls.at(-1).sql, 'COMMIT');

  const surveyInsert = calls.find(({ sql }) => /INSERT INTO Survey/.test(sql));
  assert.deepEqual(surveyInsert.values, [
    'Copied Survey', 'Configured title', sourceQuestions,
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 7, 'copied-survey',
  ]);
  const emailCopy = calls.find(({ sql }) => /INSERT INTO EMAIL/.test(sql));
  assert.match(emailCopy.sql, /lang, text, invitation_subject/);
  assert.match(emailCopy.sql, /SELECT \$1, \$2, lang, text, invitation_subject/);
  const rosterCopy = calls.find(({ sql }) => /INSERT INTO Respondent/.test(sql));
  assert.match(rosterCopy.sql, /gen_random_uuid\(\)::text/);
  assert.match(rosterCopy.sql, /lang, NULL, FALSE/);
  assert.doesNotMatch(rosterCopy.sql, /SELECT[\s\S]*\bresponse\b[\s\S]*FROM Respondent/);
  assert.doesNotMatch(rosterCopy.sql, /SELECT[\s\S]*r?\.uuid[\s\S]*FROM Respondent/);
  assert.ok(calls.some(({ sql, values }) => /survey\.copied/.test(sql) && values[0] === 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'));
});

test('survey copy rejects collisions and cross-org/non-editor access without writes', async (t) => {
  const originalConnect = pool.connect;
  t.after(() => { pool.connect = originalConnect; });

  let sourceRole = 'editor';
  let collision = true;
  const calls = [];
  pool.connect = async () => ({
    query: async (sql) => {
      calls.push(sql);
      if (/SELECT s\.id, s\.name, s\.title/.test(sql)) {
        return { rows: sourceRole ? [{
          id: 'source-id', name: 'Source', organization_id: 'org-b', role: sourceRole,
          title: 'Title', questions: { elements: [] },
        }] : [] };
      }
      if (/SELECT 1 FROM Survey/.test(sql)) return { rows: collision ? [{ '?column?': 1 }] : [] };
      return { rows: [] };
    },
    release() {},
  });

  await assert.rejects(
    copySurveyForUser({ actor: { id: 8 }, sourceSurveyId: 'source-id', name: 'Existing' }),
    (error) => error.statusCode === 409 && /already exists/.test(error.message)
  );
  assert.equal(calls.at(-1), 'ROLLBACK');
  assert.equal(calls.some(sql => /INSERT INTO Survey/.test(sql)), false);

  calls.length = 0;
  sourceRole = null;
  collision = false;
  await assert.rejects(
    copySurveyForUser({ actor: { id: 8 }, sourceSurveyId: 'source-id', name: 'Cross Org Copy' }),
    (error) => error.statusCode === 404
  );
  assert.equal(calls.at(-1), 'ROLLBACK');
  assert.equal(calls.some(sql => /INSERT INTO/.test(sql)), false);
});

test('survey copy rolls back every write when roster copying fails', async (t) => {
  const originalConnect = pool.connect;
  t.after(() => { pool.connect = originalConnect; });

  const calls = [];
  pool.connect = async () => ({
    query: async (sql) => {
      calls.push(sql);
      if (/SELECT s\.id, s\.name, s\.title/.test(sql)) {
        return { rows: [{ id: 'source-id', name: 'Source', organization_id: 'org-a', role: 'owner' }] };
      }
      if (/SELECT 1 FROM Survey/.test(sql)) return { rows: [] };
      if (/INSERT INTO Survey/.test(sql)) {
        return { rows: [{ id: 'copy-id', name: 'Copy', title: null, organization_id: 'org-a' }] };
      }
      if (/INSERT INTO Respondent/.test(sql)) throw new Error('roster copy failed');
      return { rows: [] };
    },
    release() {},
  });

  await assert.rejects(
    copySurveyForUser({ actor: { id: 9 }, sourceSurveyId: 'source-id', name: 'Copy' }),
    /roster copy failed/
  );
  assert.ok(calls.some(sql => /INSERT INTO Survey/.test(sql)));
  assert.equal(calls.includes('COMMIT'), false);
  assert.equal(calls.at(-1), 'ROLLBACK');
});

test('resolveSurveyForUser denies cross-org guessed surveyName before downstream reads', async (t) => {
  const originalQuery = pool.query;
  t.after(() => {
    pool.query = originalQuery;
  });

  let queries = 0;
  pool.query = async (sql, values) => {
    queries += 1;
    assert.match(sql, /LEFT JOIN organization_memberships/);
    assert.deepEqual(values, [7, 'Org B Secret']);
    return {
      rows: [{
        id: '22222222-2222-4222-8222-222222222222',
        name: 'Org B Secret',
        organization_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        role: null,
      }]
    };
  };

  const res = { statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
  const survey = await resolveSurveyForUser({ user: { id: 7, isPlatformAdmin: false } }, res, {
    surveyName: 'Org B Secret',
    allowedRoles: ANALYST_ROLES,
  });

  assert.equal(survey, null);
  assert.equal(res.statusCode, 404);
  assert.equal(queries, 1);
});

test('resolveSurveyForUser allows platform admin without membership', async (t) => {
  const originalQuery = pool.query;
  t.after(() => {
    pool.query = originalQuery;
  });

  pool.query = async () => ({
    rows: [{
      id: '33333333-3333-4333-8333-333333333333',
      name: 'Any Survey',
      organization_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      role: null,
    }]
  });

  const res = { status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
  const survey = await resolveSurveyForUser({ user: { id: 1, isPlatformAdmin: true } }, res, {
    surveyName: 'Any Survey',
    allowedRoles: ADMIN_ROLES,
  });

  assert.equal(survey.name, 'Any Survey');
  assert.equal(survey.role, 'owner');
  assert.equal(res.statusCode, undefined);
});

test('survey create organization defaulting handles none, one, multiple, and platform admin explicit requirement', async (t) => {
  const originalQuery = pool.query;
  t.after(() => {
    pool.query = originalQuery;
  });

  let memberships = [];
  pool.query = async (sql, values) => {
    assert.match(sql, /FROM organization_memberships/);
    assert.deepEqual(values, [42]);
    return { rows: memberships };
  };

  const makeRes = () => ({ statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } });
  const req = { user: { id: 42, isPlatformAdmin: false } };

  memberships = [];
  let res = makeRes();
  assert.equal(await getDefaultOrganizationForUser(req, res), null);
  assert.equal(res.statusCode, 403);

  memberships = [{ organization_id: 'org-a', role: 'editor' }];
  res = makeRes();
  assert.deepEqual(await getDefaultOrganizationForUser(req, res), memberships[0]);
  assert.equal(res.statusCode, 200);

  memberships = [{ organization_id: 'org-a', role: 'editor' }, { organization_id: 'org-b', role: 'owner' }];
  res = makeRes();
  assert.equal(await getDefaultOrganizationForUser(req, res), null);
  assert.equal(res.statusCode, 400);

  res = makeRes();
  assert.equal(await getDefaultOrganizationForUser({ user: { id: 1, isPlatformAdmin: true } }, res), null);
  assert.equal(res.statusCode, 400);
});

test('startSurvey email_sent update and survey archive implementation are scoped and non-destructive', () => {
  const serverSource = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
  assert.match(serverSource, /UPDATE Respondent SET email_sent = true WHERE contact_info = ANY\(\$1\) AND survey_name = \$2/);
  assert.match(serverSource, /UPDATE survey SET archived_at = CURRENT_TIMESTAMP, archived_by_user_id = \$1 WHERE id = \$2/);
  assert.doesNotMatch(serverSource, /DELETE FROM email WHERE survey_name[\s\S]+DELETE FROM respondent WHERE survey_name[\s\S]+DELETE FROM survey WHERE name/);
});

test('/api/names rejects demo and does not query/return respondent names', async (t) => {
  const originalQuery = pool.query;
  t.after(() => {
    pool.query = originalQuery;
  });

  const calls = [];
  pool.query = async (sql, values) => {
    calls.push({ sql, values });
    return { rows: [] };
  };

  const res = await request(app)
    .get('/api/names')
    .query({ surveyName: 'Survey A', userId: 'demo' });

  assert.equal(res.status, 403);
  assert.equal(res.body.names, undefined);
  assert.equal(calls.length, 1, 'only the token validation query should run');
  assert.match(calls[0].sql, /JOIN Survey s/);
  assert.match(calls[0].sql, /s\.archived_at IS NULL/);
  assert.deepEqual(calls[0].values, ['demo', 'Survey A']);
});

test('respondent routes reject invalid or mismatched survey/token before returning data', async (t) => {
  const originalQuery = pool.query;
  t.after(() => {
    pool.query = originalQuery;
  });

  pool.query = async () => ({ rows: [] });

  const questionRes = await request(app)
    .get('/api/questions')
    .query({ surveyName: 'Survey B', userId: 'valid-token' });
  assert.equal(questionRes.status, 403);

  const statusRes = await request(app)
    .get('/api/user/status')
    .query({ surveyName: 'Survey B', userId: 'valid-token' });
  assert.equal(statusRes.status, 403);

  const submitRes = await request(app)
    .post('/api/user')
    .send({ surveyName: 'Survey B', userId: 'valid-token', answers: '{}' });
  assert.equal(submitRes.status, 403);
});

test('respondent routes reject archived survey tokens without dashboard session', async (t) => {
  const originalQuery = pool.query;
  t.after(() => {
    pool.query = originalQuery;
  });

  const calls = [];
  pool.query = async (sql, values) => {
    calls.push({ sql, values });
    assert.match(sql, /s\.archived_at IS NULL/);
    assert.deepEqual(values, ['archived-token', 'Archived Survey']);
    return { rows: [] };
  };

  const questionRes = await request(app)
    .get('/api/questions')
    .query({ surveyName: 'Archived Survey', userId: 'archived-token' });
  assert.equal(questionRes.status, 403);

  const statusRes = await request(app)
    .get('/api/user/status')
    .query({ surveyName: 'Archived Survey', userId: 'archived-token' });
  assert.equal(statusRes.status, 403);

  const submitRes = await request(app)
    .post('/api/user')
    .send({ surveyName: 'Archived Survey', userId: 'archived-token', answers: '{}' });
  assert.equal(submitRes.status, 403);

  const namesRes = await request(app)
    .get('/api/names')
    .query({ surveyName: 'Archived Survey', userId: 'archived-token' });
  assert.equal(namesRes.status, 403);
  assert.equal(calls.length, 4);
});

test('/api/questions rejects demo token for arbitrary survey definitions', async (t) => {
  const originalQuery = pool.query;
  t.after(() => {
    pool.query = originalQuery;
  });

  pool.query = async () => ({ rows: [] });

  const res = await request(app)
    .get('/api/questions')
    .query({ surveyName: 'Survey A', userId: 'demo' });

  assert.equal(res.status, 403);
});

test('respondent token validation requires uuid, surveyName match, can_respond=true, and active survey', async (t) => {
  const originalQuery = pool.query;
  t.after(() => {
    pool.query = originalQuery;
  });

  const calls = [];
  pool.query = async (sql, values) => {
    calls.push({ sql, values });
    assert.match(sql, /JOIN Survey s/);
    assert.match(sql, /s\.archived_at IS NULL/);
    if (values[0] === 'valid-token' && values[1] === 'Survey A') {
      return { rows: [{ respondent_id: 1, response: null, can_respond: true, survey_id: 'survey-a-id' }] };
    }
    if (values[0] === 'disabled-token' && values[1] === 'Survey A') {
      return { rows: [{ respondent_id: 2, response: null, can_respond: false, survey_id: 'survey-a-id' }] };
    }
    // Archived surveys are rejected because the JOIN + archived_at predicate returns no rows.
    if (values[0] === 'archived-token' && values[1] === 'Archived Survey') {
      return { rows: [] };
    }
    return { rows: [] };
  };

  const ok = await validateRespondentToken('Survey A', 'valid-token');
  assert.equal(ok.ok, true);
  assert.equal(ok.respondent.survey_id, 'survey-a-id');
  assert.deepEqual(calls.at(-1).values, ['valid-token', 'Survey A']);

  const wrongSurvey = await validateRespondentToken('Survey B', 'valid-token');
  assert.equal(wrongSurvey.ok, false);
  assert.equal(wrongSurvey.status, 403);

  const disabled = await validateRespondentToken('Survey A', 'disabled-token');
  assert.equal(disabled.ok, false);
  assert.equal(disabled.status, 403);

  const archived = await validateRespondentToken('Archived Survey', 'archived-token');
  assert.equal(archived.ok, false);
  assert.equal(archived.status, 403);

  const demo = await validateRespondentToken('Survey A', 'demo');
  assert.equal(demo.ok, false);
  assert.equal(demo.status, 403);
});
