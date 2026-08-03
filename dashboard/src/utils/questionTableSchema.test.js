import { describe, expect, it } from 'vitest';
import { buildQuestionTableSchema } from './questionTableSchema';
import { parseQuestionsCsv } from './questionsCsv';

describe('buildQuestionTableSchema', () => {
  it('preserves existing configuration and names for API-side positional normalization', () => {
    const schema = {
      showProgressBar: 'bottom',
      elements: [
        { name: 'alpha', type: 'text', title: 'Old title', visibleIf: "{beta} = 'yes'" },
        { name: 'beta', type: 'boolean', title: 'Keep me' },
      ],
    };

    const result = buildQuestionTableSchema(schema, [
      { name: 'alpha', type: 'text', text: 'New title', required: true },
      { name: 'beta', type: 'boolean', text: 'Keep me', required: false },
    ]);

    expect(result.showProgressBar).toBe('bottom');
    expect(result.elements.map(({ name }) => name)).toEqual(['alpha', 'beta']);
    expect(result.elements[0]).toMatchObject({
      title: 'New title',
      visibleIf: "{beta} = 'yes'",
      isRequired: true,
    });
  });

  it('replaces unsafe imported names with collision-free temporary identities', () => {
    const overlengthName = `q${'a'.repeat(100)}`;
    const schema = {
      elements: [
        { name: 'question_1', type: 'text', customProperty: 'preserved' },
        { name: 'new_question_1', type: 'text' },
      ],
    };

    const result = buildQuestionTableSchema(schema, [
      { name: 'question_1', type: 'text', text: 'Persisted' },
      { name: 'name with spaces', type: 'text', text: 'Spaces' },
      { name: 'name-with-punctuation!', type: 'text', text: 'Punctuation' },
      { name: overlengthName, type: 'text', text: 'Overlength' },
      { name: ' leading_space', type: 'text', text: 'Leading space' },
    ]);

    expect(result.elements.map(({ name }) => name)).toEqual([
      'question_1',
      'new_question_2',
      'new_question_3',
      'new_question_4',
      'new_question_5',
    ]);
    expect(result.elements[0].customProperty).toBe('preserved');
  });

  it('preserves valid imported names that satisfy the API identifier contract', () => {
    const maxLengthName = `q${'a'.repeat(99)}`;
    const result = buildQuestionTableSchema({ elements: [] }, [
      { name: '_imported_name', type: 'text', text: 'Underscore' },
      { name: 'Imported_123', type: 'text', text: 'Alphanumeric' },
      { name: maxLengthName, type: 'text', text: 'Maximum length' },
    ]);

    expect(result.elements.map(({ name }) => name)).toEqual([
      '_imported_name',
      'Imported_123',
      maxLengthName,
    ]);
  });

  it('gives appended name collisions a fresh identity without cloning persisted schema', () => {
    const schema = {
      elements: [{
        name: 'question_1',
        type: 'tagbox',
        title: 'Existing',
        choices: ['private existing choice'],
        visibleIf: '{question_2} = true',
      }],
    };

    const result = buildQuestionTableSchema(schema, [
      { name: 'question_1', type: 'tagbox', text: 'Existing', required: true },
      { name: 'question_1', type: 'text', text: 'Imported', required: false },
      { name: 'question_1', type: 'comment', text: 'Also imported', required: true },
    ]);

    expect(result.elements.map(({ name }) => name)).toEqual([
      'question_1',
      'new_question_1',
      'new_question_2',
    ]);
    expect(result.elements[0].choices).toEqual(['private existing choice']);
    expect(result.elements[1]).toEqual({
      name: 'new_question_1',
      type: 'text',
      title: 'Imported',
      isRequired: false,
    });
    expect(result.elements[2]).toEqual({
      name: 'new_question_2',
      type: 'comment',
      title: 'Also imported',
      isRequired: true,
    });
  });

  it('makes Add Row and CSV-imported tagboxes answerable through lazy choices', () => {
    const addRow = { text: '', type: 'tagbox', required: true };
    const [csvRow] = parseQuestionsCsv([
      'Title,Question name,Question title,Question type,Max answers,Required',
      ',imported_people,Select collaborators,tagbox,3,false',
    ].join('\n'));

    const result = buildQuestionTableSchema({ elements: [] }, [addRow, csvRow]);

    expect(result.elements[0]).toMatchObject({
      type: 'tagbox',
      choices: [],
      choicesLazyLoadEnabled: true,
      choicesLazyLoadPageSize: 25,
      allowAddNewTag: false,
      claMaxSelections: 0,
    });
    expect(result.elements[0]).not.toHaveProperty('maxSelectedChoices');
    expect(result.elements[1]).toMatchObject({
      name: 'imported_people',
      choices: [],
      choicesLazyLoadEnabled: true,
      choicesLazyLoadPageSize: 25,
      allowAddNewTag: false,
      claMaxSelections: 3,
      maxSelectedChoices: 3,
    });
  });

  it('preserves existing tagbox configuration while enforcing runtime defaults', () => {
    const choices = [{ value: 'person-1', text: 'Existing person' }];
    const schema = {
      elements: [{
        name: 'people',
        type: 'tagbox',
        choices,
        choicesLazyLoadEnabled: false,
        choicesLazyLoadPageSize: 50,
        allowAddNewTag: true,
        placeholder: 'Custom prompt',
        customProperty: 'keep me',
      }],
    };

    const result = buildQuestionTableSchema(schema, [
      { name: 'people', type: 'tagbox', text: 'People', max: '4', required: true },
    ]);

    expect(result.elements[0]).toMatchObject({
      choices,
      choicesLazyLoadEnabled: true,
      choicesLazyLoadPageSize: 50,
      allowAddNewTag: false,
      placeholder: 'Custom prompt',
      customProperty: 'keep me',
      claMaxSelections: 4,
      maxSelectedChoices: 4,
    });
  });

  it('does not let a new unnamed row take a persisted name needed later', () => {
    const result = buildQuestionTableSchema(
      { elements: [{ name: 'new_question_1', type: 'text', customProperty: 'preserved' }] },
      [
        { text: 'New row', type: 'text' },
        { name: 'new_question_1', text: 'Existing row', type: 'text' },
      ],
    );

    expect(result.elements.map(({ name }) => name)).toEqual(['new_question_2', 'new_question_1']);
    expect(result.elements[1].customProperty).toBe('preserved');
  });
});
