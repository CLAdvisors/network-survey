import { describe, expect, it, vi } from 'vitest';
import { releaseSurveyModel, replaceSurveyContextModel } from './surveyModelLifecycle';

describe('SurveyJS model hook lifecycle', () => {
  it('cleans the old Creator preview hooks before tracking its replacement', () => {
    const oldPreview = { name: 'old preview' };
    const newPreview = { name: 'new preview' };
    const contextModels = new Map([['preview', oldPreview]]);
    const cleanupHooks = vi.fn();
    const cleanupSurvey = vi.fn();
    const hooksBySurvey = new Map([[oldPreview, { cleanup: cleanupHooks }]]);

    replaceSurveyContextModel(
      contextModels,
      hooksBySurvey,
      'preview',
      newPreview,
      cleanupSurvey
    );

    expect(cleanupHooks).toHaveBeenCalledOnce();
    expect(cleanupSurvey).toHaveBeenCalledWith(oldPreview);
    expect(hooksBySurvey.has(oldPreview)).toBe(false);
    expect(contextModels.get('preview')).toBe(newPreview);
  });

  it('releases one model from hooks and every context without disposing Creator-owned models', () => {
    const model = { dispose: vi.fn() };
    const contextModels = new Map([['preview', model], ['other', model]]);
    const cleanupHooks = vi.fn();
    const hooksBySurvey = new Map([[model, { cleanup: cleanupHooks }]]);

    releaseSurveyModel(contextModels, hooksBySurvey, model, vi.fn());

    expect(cleanupHooks).toHaveBeenCalledOnce();
    expect(contextModels.size).toBe(0);
    expect(model.dispose).not.toHaveBeenCalled();
  });
});
