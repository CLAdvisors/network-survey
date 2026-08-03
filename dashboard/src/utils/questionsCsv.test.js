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

  it('parses quoted commas, escaped quotes, and multiline question text', () => {
    const csv = [
      'Title,Question name,Question title,Question type,Max answers,Required',
      'Survey,q1,"Who said ""hello,""\nand why?",comment,,false',
    ].join('\n');

    expect(parseQuestionsCsv(csv)).toEqual([{
      name: 'q1',
      text: 'Who said "hello,"\nand why?',
      type: 'comment',
      max: null,
      required: false,
    }]);
  });

  it('exports quoted content and explicit requiredness that round-trip', () => {
    const rows = [
      { id: 1, name: 'question_1', text: 'Required, with "quotes"', type: 'text', required: true },
      { id: 2, name: 'question_2', text: 'Optional\non two lines', type: 'comment', required: false },
    ];
    const csv = formatQuestionsCsv(rows);

    expect(csv).toContain('Required');
    expect(parseQuestionsCsv(csv)).toEqual([
      { name: 'question_1', text: rows[0].text, type: 'text', max: null, required: true },
      { name: 'question_2', text: rows[1].text, type: 'comment', max: null, required: false },
    ]);
  });

  it('rejects malformed quoted input instead of silently splitting it', () => {
    expect(() => parseQuestionsCsv(`${requiredCsv('true')}\nSurvey,q2,"unterminated`))
      .toThrow(/Invalid questions CSV/);
  });
});
