import { describe, expect, it } from 'vitest';
import { Model, Question, Serializer } from 'survey-core';
import {
  EXCLUSIVE_GROUP_PATTERN,
  EXCLUSIVE_GROUP_PROPERTY,
  collectExclusiveConflictKeys,
  collectExclusiveTakenKeys,
  exclusiveChoiceKey,
  exclusiveGroupOf,
  exclusiveGroupPeers,
  normalizeExclusiveGroup,
} from './exclusiveRankingGroups.js';

if (!Serializer.findClass('draggableranking')) {
  class QuestionDraggableRankingModel extends Question {
    getType() {
      return 'draggableranking';
    }
  }
  Serializer.addClass(
    'draggableranking',
    [],
    () => new QuestionDraggableRankingModel(''),
    'question'
  );
  Serializer.addProperty('draggableranking', EXCLUSIVE_GROUP_PROPERTY);
}

const ranking = (name, extra = {}) => ({
  type: 'draggableranking',
  name,
  choices: ['a', 'b', 'c'],
  ...extra,
});

function createSurvey(elements) {
  return new Model({ elements });
}

describe('exclusive ranking group helpers', () => {
  it('registers a string property that round-trips through SurveyJS JSON', () => {
    const survey = createSurvey([ranking('q1', { exclusiveGroup: 'values' })]);
    expect(survey.getQuestionByName('q1').exclusiveGroup).toBe('values');
    expect(JSON.parse(JSON.stringify(survey.toJSON())).pages[0].elements[0].exclusiveGroup).toBe('values');
  });

  it('normalizes group labels and rejects non-strings', () => {
    expect(normalizeExclusiveGroup('  values ')).toBe('values');
    expect(normalizeExclusiveGroup('')).toBe('');
    expect(normalizeExclusiveGroup(undefined)).toBe('');
    expect(normalizeExclusiveGroup(42)).toBe('');
    expect(EXCLUSIVE_GROUP_PATTERN.test('values_v2-A')).toBe(true);
    expect(EXCLUSIVE_GROUP_PATTERN.test('bad/group')).toBe(false);
    expect(EXCLUSIVE_GROUP_PATTERN.test('x'.repeat(65))).toBe(false);
  });

  it('uses the answer-value key for primitive and object values', () => {
    expect(exclusiveChoiceKey('Alex')).toBe('Alex');
    expect(exclusiveChoiceKey(7)).toBe('7');
    expect(exclusiveChoiceKey({ value: 'Alex' })).toBe('Alex');
  });

  it('lists peers in the same group only, ignoring ungrouped questions', () => {
    const survey = createSurvey([
      ranking('q1', { exclusiveGroup: 'values' }),
      ranking('q2', { exclusiveGroup: 'values' }),
      ranking('q3'),
      ranking('q4', { exclusiveGroup: 'other' }),
    ]);
    const peers = exclusiveGroupPeers(survey.getQuestionByName('q1'));
    expect(peers.map((peer) => peer.name)).toEqual(['q2']);
  });

  it('collects values ranked in active peers and ignores hidden peers', () => {
    const survey = createSurvey([
      { type: 'boolean', name: 'show' },
      ranking('q1', { exclusiveGroup: 'values' }),
      ranking('q2', { exclusiveGroup: 'values', visibleIf: '{show} = true' }),
    ]);
    survey.setValue('show', true);
    survey.setValue('q1', ['a']);
    survey.setValue('q2', ['b']);
    expect([...collectExclusiveTakenKeys(survey.getQuestionByName('q1'))]).toEqual(['b']);

    survey.setValue('show', false);
    expect(survey.getQuestionByName('q2').isVisible).toBe(false);
    expect([...collectExclusiveTakenKeys(survey.getQuestionByName('q1'))]).toEqual([]);
  });

  it('treats the earlier question as the owner of a conflicting value', () => {
    const survey = createSurvey([
      ranking('q1', { exclusiveGroup: 'values' }),
      ranking('q2', { exclusiveGroup: 'values' }),
    ]);
    survey.setValue('q1', ['a', 'b']);
    survey.setValue('q2', ['b', 'c']);

    expect(collectExclusiveConflictKeys(survey.getQuestionByName('q1')).size).toBe(0);
    expect([...collectExclusiveConflictKeys(survey.getQuestionByName('q2'))]).toEqual(['a', 'b']);
    expect([...collectExclusiveTakenKeys(survey.getQuestionByName('q2'))]).toEqual(['a', 'b']);
  });

  it('reads the group from raw schema objects and SurveyJS questions', () => {
    expect(exclusiveGroupOf({ exclusiveGroup: ' values ' })).toBe('values');
    expect(exclusiveGroupOf({ exclusiveGroup: 5 })).toBe('');
    const survey = createSurvey([ranking('q1', { exclusiveGroup: 'values' })]);
    expect(exclusiveGroupOf(survey.getQuestionByName('q1'))).toBe('values');
  });
});
