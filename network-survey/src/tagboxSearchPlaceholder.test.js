import { waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { restoreTagboxSearchPlaceholder } from './tagboxSearchPlaceholder';

describe('restoreTagboxSearchPlaceholder', () => {
  it('restores the configured placeholder after SurveyJS clears it', async () => {
    const frame = document.createElement('div');
    frame.innerHTML = '<input class="sd-tagbox__filter-string-input" placeholder="">';
    const question = {
      getType: () => 'tagbox',
      placeholder: 'Start typing to search for people',
    };
    const animationFrame = vi.spyOn(window, 'requestAnimationFrame').mockImplementation(() => 1);

    restoreTagboxSearchPlaceholder(frame, question);

    const input = frame.querySelector('input');
    expect(input).toHaveAttribute('placeholder', question.placeholder);

    input.placeholder = '';
    await waitFor(() => expect(input).toHaveAttribute('placeholder', question.placeholder));
    animationFrame.mockRestore();
  });

  it('uses SurveyJS localized search text when no custom placeholder is configured', () => {
    const frame = document.createElement('div');
    frame.innerHTML = '<input class="sd-tagbox__filter-string-input" placeholder="">';
    const question = {
      getType: () => 'tagbox',
      placeholder: 'Select…',
      getDefaultPropertyValue: () => 'Select…',
      dropdownListModel: { listModel: { filterStringPlaceholder: 'Type to search…' } },
    };

    restoreTagboxSearchPlaceholder(frame, question);

    expect(frame.querySelector('input')).toHaveAttribute('placeholder', 'Type to search…');
  });

  it('does not alter other question types', () => {
    const frame = document.createElement('div');
    frame.innerHTML = '<input class="sd-tagbox__filter-string-input" placeholder="Original">';

    restoreTagboxSearchPlaceholder(frame, { getType: () => 'text', placeholder: 'Replacement' });

    expect(frame.querySelector('input')).toHaveAttribute('placeholder', 'Original');
  });
});
