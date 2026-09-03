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

  it('disposes a replaced dashboard-owned runtime model when requested', () => {
    const oldRuntime = { dispose: vi.fn() };
    const newRuntime = { dispose: vi.fn() };
    const contextModels = new Map([['preview-runtime', oldRuntime]]);
    const cleanupHooks = vi.fn();
    const hooksBySurvey = new Map([[oldRuntime, { cleanup: cleanupHooks }]]);

    replaceSurveyContextModel(
      contextModels,
      hooksBySurvey,
      'preview-runtime',
      newRuntime,
      vi.fn(),
      { disposePrevious: true }
    );

    expect(cleanupHooks).toHaveBeenCalledOnce();
    expect(oldRuntime.dispose).toHaveBeenCalledOnce();
    expect(newRuntime.dispose).not.toHaveBeenCalled();
    expect(contextModels.get('preview-runtime')).toBe(newRuntime);
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
