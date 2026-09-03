import { describe, expect, it } from 'vitest';
import { PanelModel, Question, Serializer } from 'survey-core';
import { SurveyCreator } from 'survey-creator-react';
import {
  choiceDefinitionError,
  configureDraggableRankingChoiceEditor,
  configureDraggableRankingDefinitionEditor,
  configureDraggableRankingDefinitionVisibility,
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
    expect(property.category).toBe('');
    expect(property.visibleIndex).toBe(0);

    const rankingChoice = {};
    const rankingVisibility = {
      property,
      element: rankingChoice,
      parentElement: rankingOwner,
      parentProperty: { name: 'choices' },
      show: false,
    };
    configureDraggableRankingDefinitionVisibility(null, rankingVisibility);
    expect(rankingVisibility.show).toBe(true);
    const dropdownVisibility = {
      property,
      element: {},
      parentElement: dropdownOwner,
      parentProperty: { name: 'choices' },
      show: true,
    };
    configureDraggableRankingDefinitionVisibility(null, dropdownVisibility);
    expect(dropdownVisibility.show).toBe(false);

    for (const propertyName of ['visibleIf', 'enableIf']) {
      const conditionalVisibility = {
        property: { name: propertyName },
        parentElement: rankingOwner,
        parentProperty: { name: 'choices' },
        show: true,
      };
      configureDraggableRankingDefinitionVisibility(null, conditionalVisibility);
      expect(conditionalVisibility.show).toBe(false);
    }

    const unrelatedVisibility = {
      property: { name: 'visibleIf' },
      parentElement: dropdownOwner,
      parentProperty: { name: 'choices' },
      show: true,
    };
    configureDraggableRankingDefinitionVisibility(null, unrelatedVisibility);
    expect(unrelatedVisibility.show).toBe(true);

    const editor = {};
    configureDraggableRankingDefinitionEditor(null, {
      property,
      element: rankingChoice,
      editor,
    });
    expect(editor.rows).toBe(5);
    expect(editor.autoGrow).toBe(true);
    expect(editor.description).toContain('10,000 characters');
    expect(editor.description).toContain('HTML is shown as text');
    expect(editor.description).not.toContain('1,000 choices per survey');
  });

  it('configures the real Creator choice-detail editor as multiline with guidance', () => {
    if (!Serializer.findClass('draggableranking')) {
      class TestDraggableRankingQuestion extends Question {
        getType() { return 'draggableranking'; }
      }
      Serializer.addClass(
        'draggableranking',
        [{ name: 'choices:itemvalue[]', default: [] }],
        () => new TestDraggableRankingQuestion(''),
        'question'
      );
    }
    registerDraggableRankingDefinitionMetadata();
    const creator = new SurveyCreator({ questionTypes: ['draggableranking'] });
    creator.onPropertyShowing.add(configureDraggableRankingDefinitionVisibility);
    creator.onPropertyEditorCreated.add(configureDraggableRankingDefinitionEditor);
    creator.JSON = {
      elements: [{
        type: 'draggableranking',
        name: 'priorities',
        choices: [{ value: 'stable-id', text: 'Short label', definition: 'Definition' }],
      }],
    };
    const question = creator.survey.getQuestionByName('priorities');
    creator.selectElement(question);
    const choicesEditor = creator.propertyGrid.getQuestionByName('choices');
    const panel = new PanelModel('choice-detail');
    choicesEditor.onCreateDetailPanelCallback({ editingObj: question.choices[0] }, panel);
    const definitionEditor = panel.getQuestionByName('definition');

    expect(definitionEditor.getType()).toBe('comment');
    expect(definitionEditor.rows).toBe(5);
    expect(definitionEditor.autoGrow).toBe(true);
    expect(definitionEditor.description).toContain('HTML is shown as text');
    expect(panel.getQuestionByName('visibleIf')?.isVisible).toBe(false);
    expect(panel.getQuestionByName('enableIf')?.isVisible).toBe(false);
    creator.dispose();
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
    expect(choiceDefinitionError(`unsafe\uD800text`)).toContain('forbidden control');
    expect(choiceDefinitionError('x'.repeat(10_001))).toContain('10000-character');

    const definitionChoice = {};
    const definitionProperty = registerDraggableRankingDefinitionMetadata();
    configureDraggableRankingDefinitionVisibility(null, {
      property: definitionProperty,
      element: definitionChoice,
      parentElement: { getType: () => 'draggableranking' },
      parentProperty: { name: 'choices' },
    });
    const options = {
      propertyName: 'definition',
      element: definitionChoice,
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
    expect(normalizeDraggableRankingDefinitions([{
      type: 'draggableranking',
      choices: ['one', 'two'],
    }])[0].choices).toEqual(['one', 'two']);

    expect(() => normalizeDraggableRankingDefinitions([{
      type: 'draggableranking',
      choices: Array.from({ length: 101 }, (_, index) => `v${index}`),
    }])).toThrow('at most 100 choices');

    expect(() => normalizeDraggableRankingDefinitions([{
      type: 'draggableranking',
      choices: [{ value: 1, text: 'One', definition: 'Defined' }],
    }])).toThrow('must explicitly define string value and text properties');

    expect(() => normalizeDraggableRankingDefinitions([{
      type: 'draggableranking',
      choices: [{ value: ' stable-id ', text: 'One', definition: 'Defined' }],
    }])).toThrow('may not have leading or trailing whitespace');

    expect(() => normalizeDraggableRankingDefinitions([{
      type: 'draggableranking',
      choices: Array.from({ length: 101 }, (_, index) => ({
        value: `v${index}`,
        text: `Choice ${index}`,
        definition: 'Defined',
      })),
    }])).toThrow('at most 100 choices');

    expect(() => normalizeDraggableRankingDefinitions(Array.from({ length: 11 }, (_, questionIndex) => ({
      type: 'draggableranking',
      choices: Array.from({ length: 100 }, (_, choiceIndex) => ({
        value: `${questionIndex}-${choiceIndex}`,
        text: `Choice ${choiceIndex}`,
        definition: 'Defined',
      })),
    })))).toThrow('at most 1000 choices across the survey');
  });
});
