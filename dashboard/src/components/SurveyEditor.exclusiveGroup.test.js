import { describe, expect, it } from 'vitest';
import { SurveyCreator } from 'survey-creator-react';

// Importing the editor module performs the Creator-side Serializer
// registrations exactly as the running dashboard does.
import './SurveyEditor.js';

describe('Survey Editor exclusive ranking group registration', () => {
  it('keeps exclusiveGroup through Creator load/save', () => {
    const creator = new SurveyCreator({
      showPagesPanel: false,
      pageEditMode: 'single',
    });
    creator.JSON = {
      elements: [
        {
          type: 'draggableranking',
          name: 'question_1',
          exclusiveGroup: 'values',
          minSelectedChoices: 1,
          maxSelectedChoices: 2,
          choices: [
            { value: 'alpha', text: 'Alpha' },
            { value: 'beta', text: 'Beta' },
          ],
        },
        {
          type: 'draggableranking',
          name: 'question_2',
          exclusiveGroup: 'values',
          minSelectedChoices: 1,
          maxSelectedChoices: 2,
          choices: [
            { value: 'alpha', text: 'Alpha' },
            { value: 'beta', text: 'Beta' },
          ],
        },
      ],
    };

    const saved = creator.survey.toJSON();
    const elements = saved.pages.flatMap((page) => page.elements);
    expect(elements.map((element) => element.exclusiveGroup)).toEqual(['values', 'values']);
    creator.dispose();
  });

  it('leaves questions without a group unchanged', () => {
    const creator = new SurveyCreator({
      showPagesPanel: false,
      pageEditMode: 'single',
    });
    creator.JSON = {
      elements: [{
        type: 'draggableranking',
        name: 'question_1',
        choices: [{ value: 'alpha', text: 'Alpha' }],
      }],
    };

    const saved = creator.survey.toJSON();
    expect(saved.pages[0].elements[0]).not.toHaveProperty('exclusiveGroup');
    creator.dispose();
  });
});
