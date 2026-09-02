import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { LONG_VALUE_SURVEY_JSON, SYNTHETIC_VALUES } from './labSurvey';

const css = readFileSync(resolve(process.cwd(), 'src/long-value-lab/longValueLab.css'), 'utf8');
const indexSource = readFileSync(resolve(process.cwd(), 'src/index.jsx'), 'utf8');
const experienceSource = readFileSync(resolve(process.cwd(), 'src/long-value-lab/DefinitionExperience.jsx'), 'utf8');

describe('long-value lab fixture and isolation', () => {
  it('uses enough varied, unmistakably synthetic definitions to expose density', () => {
    expect(SYNTHETIC_VALUES).toHaveLength(16);
    expect(SYNTHETIC_VALUES.every(({ value }) => value.startsWith('charter-'))).toBe(true);
    expect(SYNTHETIC_VALUES.some(({ definition }) => definition.includes('\n\n'))).toBe(true);
    expect(Math.max(...SYNTHETIC_VALUES.map(({ definition }) => definition.length))).toBeGreaterThan(250);
    expect(LONG_VALUE_SURVEY_JSON.elements.map(({ type }) => type)).toEqual(['draggableranking', 'radiogroup']);
  });

  it('is selected only by its explicit route and does not replace normal respondent flow', () => {
    expect(indexSource).toContain("=== '/labs/long-values'");
    expect(indexSource).toContain("React.lazy(() => import('./long-value-lab/LongValueLab'))");
    expect(indexSource).toContain('<Survey />');
  });

  it('renders definitions as React text and never through an HTML injection API', () => {
    expect(experienceSource).toContain('<div className="lv-definition-text">{text}</div>');
    expect(experienceSource).not.toContain('dangerouslySetInnerHTML');
  });

  it('includes narrow reflow, long-token, reduced-motion, focus, and high-contrast safeguards', () => {
    expect(css).toContain('container-type: inline-size');
    expect(css).toContain('@container (max-width: 599px)');
    expect(css).toContain('.lv-preview--320');
    expect(css).toContain('overflow-wrap: anywhere');
    expect(css).toContain('@media (prefers-reduced-motion: reduce)');
    expect(css).toContain('@media (forced-colors: active)');
    expect(css).toContain(':focus-visible');
    expect(css).toContain('max-height: calc(100dvh - 32px)');
  });
});
