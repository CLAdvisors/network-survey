import { describe, expect, it } from 'vitest';
import { formatQuestionsCsv, parseQuestionsCsv } from './questionsCsv';

const legacyCsv = 'Title,Question name,Question title,Question type,Max answers\nSurvey,q1,Legacy,text,';
const requiredCsv = (value) => `Title,Question name,Question title,Question type,Max answers,Required\nSurvey,q1,Question,text,,${value}`;

describe('question CSV Required contract', () => {
  it('keeps legacy rows required only when the Required column is absent', () => {
    expect(parseQuestionsCsv(legacyCsv)[0].required).toBe(true);
  });

  it.each([
    ['', false],
    ['true', true],
    ['false', false],
  ])('parses a present Required value %j as %s', (value, expected) => {
    expect(parseQuestionsCsv(requiredCsv(value))[0].required).toBe(expected);
  });

  it('exports explicit true and false values that round-trip', () => {
    const csv = formatQuestionsCsv([
      { id: 1, name: 'question_1', text: 'Required', type: 'text', required: true },
      { id: 2, name: 'question_2', text: 'Optional', type: 'text', required: false },
    ]);
    expect(csv).toContain('Required');
    expect(parseQuestionsCsv(csv).map((row) => row.required)).toEqual([true, false]);
  });
});
