import { describe, expect, test } from 'vitest';
import { toDisplayAnswers } from './Results';

describe('toDisplayAnswers', () => {
  test('normalizes scalar, array, and structured SurveyJS answers for safe rendering', () => {
    expect(toDisplayAnswers('2026-07-24')).toEqual(['2026-07-24']);
    expect(toDisplayAnswers(['Alex (a@example.com)', 'Blair (b@example.com)']))
      .toEqual(['Alex (a@example.com)', 'Blair (b@example.com)']);
    expect(toDisplayAnswers({ row_1: 'Yes' })).toEqual(['{"row_1":"Yes"}']);
    expect(toDisplayAnswers(null)).toEqual([]);
  });
});
