import { describe, expect, it } from 'vitest';
import { Serializer } from 'survey-core';
import {
  choiceDefinitionError,
  configureDraggableRankingChoiceEditor,
  normalizeDraggableRankingDefinitions,
  registerDraggableRankingDefinitionMetadata,
  validateDraggableRankingDefinitionProperty,
} from './draggableRankingDefinitions';

describe('draggable ranking definition authoring', () => {
  it('registers a nonlocalized multiline detail property visible by choice owner instance', () => {
    const property = registerDraggableRankingDefinitionMetadata();
    const rankingOwner = { getType: () => 'draggableranking' };
    const dropdownOwner = { getType: () => 'dropdown' };

    expect(property).toBe(Serializer.findProperty('itemvalue', 'definition'));
    expect(property.type).toBe('text');
    expect(property.isLocalizable).toBe(false);
    expect(property.locationInTable).toBe('detail');
    expect(property.visibleIf({ locOwner: rankingOwner })).toBe(true);
    expect(property.visibleIf({ locOwner: dropdownOwner })).toBe(false);
    expect(property.visibleIf({})).toBe(false);

    const editor = {};
    property.onPropertyEditorUpdate({}, editor);
    expect(editor.rows).toBeGreaterThan(1);
    expect(editor.description).toContain('10,000 characters');
    expect(editor.description).toContain('HTML is displayed literally');
  });

  it('disables Fast Entry and batch editing only for draggable ranking choices', () => {
    const rankingOptions = {
      propertyName: 'choices',
      element: { getType: () => 'draggableranking' },
      allowBatchEdit: true,
      editorOptions: { allowBatchEdit: true, showTextView: true },
    };
    configureDraggableRankingChoiceEditor(null, rankingOptions);
    expect(rankingOptions.allowBatchEdit).toBe(false);
    expect(rankingOptions.editorOptions).toMatchObject({ allowBatchEdit: false, showTextView: false });

    const dropdownOptions = {
      propertyName: 'choices',
      element: { getType: () => 'dropdown' },
      allowBatchEdit: true,
      editorOptions: { allowBatchEdit: true, showTextView: true },
    };
    configureDraggableRankingChoiceEditor(null, dropdownOptions);
    expect(dropdownOptions.allowBatchEdit).toBe(true);
    expect(dropdownOptions.editorOptions.showTextView).toBe(true);
  });

  it('reports actionable plain-text limits in the property editor', () => {
    expect(choiceDefinitionError('first paragraph\n\nsecond paragraph')).toBe('');
    expect(choiceDefinitionError(`unsafe\u202Etext`)).toContain('forbidden control');
    expect(choiceDefinitionError('x'.repeat(10_001))).toContain('10000-character');

    const options = {
      propertyName: 'definition',
      element: { locOwner: { getType: () => 'draggableranking' } },
      value: 'x'.repeat(10_001),
      error: '',
    };
    validateDraggableRankingDefinitionProperty(null, options);
    expect(options.error).toContain('40960-byte');
  });

  it('normalizes explicit backend-required text/value strings without adding a JSON variant', () => {
    const result = normalizeDraggableRankingDefinitions([{
      type: 'draggableranking',
      name: 'rank',
      choices: [
        { value: 'stable-alpha', text: 'Alpha', definition: ' First paragraph.\r\n\r\nSecond paragraph. ' },
        // SurveyJS omits text from serialized JSON when label and value match.
        { value: 'stable-beta' },
      ],
    }]);

    expect(result[0].choices).toEqual([
      { value: 'stable-alpha', text: 'Alpha', definition: 'First paragraph.\n\nSecond paragraph.' },
      { value: 'stable-beta', text: 'stable-beta' },
    ]);
    expect(result[0].choices[0]).not.toHaveProperty('definitionJson');
  });

  it('surfaces backend-compatible choice and aggregate constraints before save', () => {
    expect(() => normalizeDraggableRankingDefinitions([{
      type: 'draggableranking',
      choices: [{ value: 1, text: 'One', definition: 'Defined' }],
    }])).toThrow('must explicitly define string value and text properties');

    expect(() => normalizeDraggableRankingDefinitions([{
      type: 'draggableranking',
      choices: Array.from({ length: 101 }, (_, index) => ({
        value: `v${index}`,
        text: `Choice ${index}`,
        definition: 'Defined',
      })),
    }])).toThrow('at most 100 choices');
  });
});
