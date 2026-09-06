import { describe, expect, it } from 'vitest';
import {
  parseSurveyInstructionFormatting,
  sourceOffsetToTextareaOffset,
  textareaOffsetToSourceOffset,
  toggleSurveyInstructionBold,
} from './surveyInstructionFormatting.js';

const compact = (value) => parseSurveyInstructionFormatting(value)
  .map(({ text, bold }) => [text, bold]);
const visible = (value) => parseSurveyInstructionFormatting(value)
  .map(({ text }) => text).join('');

function expectFormatting(value, expected) {
  expect(compact(value)).toEqual(expected);
}

describe('parseSurveyInstructionFormatting', () => {
  it('parses only non-empty, exactly paired, same-line bold markers', () => {
    expectFormatting('One **bold * word** and **two**.', [
      ['One ', false], ['bold * word', true], [' and ', false], ['two', true], ['.', false],
    ]);
    expectFormatting('**open\nclose**', [['**open\nclose**', false]]);
    expectFormatting('**** ***triple*** ******six****** **unfinished', [['**** ***triple*** ******six****** **unfinished', false]]);
  });

  it('leaves single stars and HTML as literal text', () => {
    expectFormatting('A *single* and **<em>tag</em> & text**.', [
      ['A *single* and ', false], ['<em>tag</em> & text', true], ['.', false],
    ]);
  });

  it('parses multiple and adjacent runs deterministically', () => {
    expectFormatting('**one** / **two****three**', [
      ['one', true], [' / ', false], ['two', true], ['three', true],
    ]);
    expectFormatting('****', [['****', false]]);
  });
});

describe('textarea/source offset mapping', () => {
  it('maps normalized textarea offsets across CRLF without changing source offsets for lone CR', () => {
    const crlf = 'first\r\nsecond\r\nthird';
    expect(textareaOffsetToSourceOffset(crlf, 6)).toBe(7);
    expect(textareaOffsetToSourceOffset(crlf, 13)).toBe(15);
    expect(sourceOffsetToTextareaOffset(crlf, 7)).toBe(6);
    expect(sourceOffsetToTextareaOffset(crlf, 15)).toBe(13);

    const loneCr = 'first\rsecond';
    expect(textareaOffsetToSourceOffset(loneCr, 6)).toBe(6);
    expect(sourceOffsetToTextareaOffset(loneCr, 6)).toBe(6);
  });

  it('clamps invalid and out-of-range offsets', () => {
    expect(textareaOffsetToSourceOffset('a\r\nb', -1)).toBe(0);
    expect(textareaOffsetToSourceOffset('a\r\nb', 99)).toBe(4);
    expect(sourceOffsetToTextareaOffset('a\r\nb', -1)).toBe(0);
    expect(sourceOffsetToTextareaOffset('a\r\nb', 99)).toBe(3);
  });
});

describe('toggleSurveyInstructionBold', () => {
  it('does not mutate a collapsed selection and explains why', () => {
    expect(toggleSurveyInstructionBold('plain', 2, 2)).toEqual({
      value: 'plain', selectionStart: 2, selectionEnd: 2,
      changed: false, reason: 'collapsed-selection',
    });
  });

  it('bolds mixed plain and already-bold text without nesting markers', () => {
    const input = 'one **two** three';
    const result = toggleSurveyInstructionBold(input, 0, input.length);

    expect(result.changed).toBe(true);
    expect(result.reason).toBe('bolded');
    expect(result.value).toBe('**one two three**');
    expectFormatting(result.value, [['one two three', true]]);
  });

  it('unbolds only a partial selection inside an existing bold run', () => {
    const result = toggleSurveyInstructionBold('**abcdef**', 4, 6); // "cd"

    expect(result.value).toBe('**ab**cd**ef**');
    expect(result.reason).toBe('unbolded');
    expectFormatting(result.value, [['ab', true], ['cd', false], ['ef', true]]);
  });

  it('handles multiple and adjacent selected formatting runs canonically', () => {
    const input = '**one**two**three**';
    const bolded = toggleSurveyInstructionBold(input, 0, input.length);
    expect(bolded.value).toBe('**onetwothree**');
    expectFormatting(bolded.value, [['onetwothree', true]]);

    const unbolded = toggleSurveyInstructionBold(bolded.value, bolded.selectionStart, bolded.selectionEnd);
    expect(unbolded.value).toBe('onetwothree');
    expectFormatting(unbolded.value, [['onetwothree', false]]);
  });

  it.each([
    ['LF', 'first\nsecond', '**first**\n**second**'],
    ['CRLF', 'first\r\nsecond', '**first**\r\n**second**'],
  ])('formats each nonempty %s line independently', (_name, input, expected) => {
    const result = toggleSurveyInstructionBold(input, 0, input.length);
    expect(result.value).toBe(expected);
    expect(visible(result.value)).toBe(input);
    expect(parseSurveyInstructionFormatting(result.value).filter((part) => part.bold))
      .toHaveLength(2);
  });

  it('leaves a selection containing only line endings unchanged', () => {
    expect(toggleSurveyInstructionBold('a\r\nb', 1, 3)).toMatchObject({
      value: 'a\r\nb', changed: false, reason: 'no-formattable-text',
    });
  });

  it('preserves literal single stars when formatting', () => {
    const input = 'Fields marked * are required';
    const result = toggleSurveyInstructionBold(input, 0, input.length);
    expect(result.value).toBe('**Fields marked * are required**');
    expectFormatting(result.value, [['Fields marked * are required', true]]);
  });

  it('treats a non-BMP code point as one atom when a selection intersects it', () => {
    const input = 'A😀B';
    const result = toggleSurveyInstructionBold(input, 1, 2);
    expect(result.value).toBe('A**😀**B');
    expectFormatting(result.value, [['A', false], ['😀', true], ['B', false]]);
  });

  it('refuses an ambiguous marker result rather than changing visible formatting incorrectly', () => {
    const input = 'literal ** marker';
    const result = toggleSurveyInstructionBold(input, 0, input.length);
    expect(result).toMatchObject({ value: input, changed: false, reason: 'unrepresentable' });
    expect(visible(result.value)).toBe(input);
  });
});
