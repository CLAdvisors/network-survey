import { describe, expect, it, vi } from 'vitest';
import {
  restrictSurveyToolbox,
  setSurveyToolboxItem,
  SUPPORTED_SURVEY_TOOLBOX_TYPES,
} from './surveyToolbox';

const API_SUPPORTED_TYPES = [
  'text',
  'comment',
  'boolean',
  'rating',
  'radiogroup',
  'dropdown',
  'checkbox',
  'tagbox',
  'ranking',
  'draggableranking',
  'imagepicker',
  'file',
  'matrix',
  'matrixdropdown',
  'matrixdynamic',
  'multipletext',
];

describe('Survey Creator toolbox contract', () => {
  it('contains exactly the API-supported answer-bearing question types', () => {
    expect(SUPPORTED_SURVEY_TOOLBOX_TYPES).toEqual(API_SUPPORTED_TYPES);
  });

  it('replaces a default item before adding its custom configuration', () => {
    const toolbox = {
      removeItem: vi.fn(),
      addItem: vi.fn(),
    };
    const customTagbox = { name: 'tagbox', title: 'People Tagbox' };

    setSurveyToolboxItem(toolbox, customTagbox);

    expect(toolbox.removeItem).toHaveBeenCalledWith('tagbox');
    expect(toolbox.addItem).toHaveBeenCalledWith(customTagbox);
    expect(toolbox.removeItem.mock.invocationCallOrder[0])
      .toBeLessThan(toolbox.addItem.mock.invocationCallOrder[0]);
  });

  it('removes nested and display-only items while retaining supported and custom types', () => {
    const removeItem = vi.fn();
    const toolbox = {
      itemNames: [
        ...SUPPORTED_SURVEY_TOOLBOX_TYPES,
        'panel',
        'paneldynamic',
        'html',
        'image',
        'expression',
        'signaturepad',
      ],
      removeItem,
    };

    restrictSurveyToolbox(toolbox);

    expect(removeItem.mock.calls.map(([name]) => name)).toEqual([
      'panel',
      'paneldynamic',
      'html',
      'image',
      'expression',
      'signaturepad',
    ]);
    expect(removeItem).not.toHaveBeenCalledWith('tagbox');
    expect(removeItem).not.toHaveBeenCalledWith('draggableranking');
  });
});
