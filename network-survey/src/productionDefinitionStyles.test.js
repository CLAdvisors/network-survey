import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const css = fs.readFileSync(path.resolve(process.cwd(), '../frontend-shared/src/surveyRuntime.css'), 'utf8');

describe('production definition reflow styles', () => {
  it('keeps controls touch-sized and long literal content contained at 320px', () => {
    expect(css).toMatch(/\.cla-choice-definition__button,[\s\S]*?min-height:\s*44px/);
    expect(css).toMatch(/\.cla-choice-definition__callout[\s\S]*?flex:\s*1 0 100%/);
    expect(css).toMatch(/\.cla-choice-definition__callout[\s\S]*?overflow-wrap:\s*anywhere/);
    expect(css).toContain('@container (max-width: 320px)');
    expect(css).toMatch(/\.cla-choice-definition__text p[\s\S]*?white-space:\s*pre-wrap/);
  });
});
