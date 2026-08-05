import React from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const surveyState = vi.hoisted(() => ({ model: null }));

vi.mock('survey-core', () => {
  class FakeModel {
    constructor(json) {
      this.json = json;
      this.onCompleting = { add: (handler) => { this.completingHandler = handler; } };
      this.onChoicesLazyLoad = { add: (handler) => { this.lazyLoadHandler = handler; } };
      this.onAfterRenderQuestion = { add: (handler) => { this.renderHandler = handler; } };
      surveyState.model = this;
    }

    getAllQuestions() {
      return [];
    }

    dispose() {}
  }

  return {
    Model: FakeModel,
    Serializer: { addClass: vi.fn() },
    Question: class {},
  };
});

vi.mock('survey-react-ui', () => ({
  Survey: () => <div data-testid="survey-form" />,
}));

vi.mock('@network-survey/frontend-shared', () => ({
  applyProductionSurveyTheme: vi.fn(),
  PRODUCTION_SURVEY_CLASS_NAME: 'survey-runtime',
  buildApiUrl: (pathname, queryParams = {}) => {
    const query = new URLSearchParams(
      Object.entries(queryParams).filter(([, value]) => value !== null && value !== undefined)
    );
    const queryString = query.toString();
    return `${pathname}${queryString ? `?${queryString}` : ''}`;
  },
}));

vi.mock('@network-survey/frontend-react', () => ({
  DraggableRankingQuestion: () => null,
}));

vi.mock('./tagboxSearchPlaceholder', () => ({
  disposeTagboxSearchPlaceholder: vi.fn(),
  restoreTagboxSearchPlaceholder: vi.fn(),
}));

import SurveyComponent from './SurveyComponent';

class MockXMLHttpRequest {
  static requests = [];

  open(method, url) {
    this.method = method;
    this.url = url;
  }

  setRequestHeader() {}

  send() {
    MockXMLHttpRequest.requests.push(this.url);
    this.status = 200;
    this.response = JSON.stringify(
      this.url.includes('/questions')
        ? { title: 'Demo survey', questions: { elements: [{ type: 'tagbox', name: 'people' }] } }
        : { names: ['Real Person (real@example.com)'], total: 1 }
    );
    this.onload();
  }
}

describe('SurveyComponent demo mode', () => {
  beforeEach(() => {
    surveyState.model = null;
    MockXMLHttpRequest.requests = [];
    vi.stubGlobal('XMLHttpRequest', MockXMLHttpRequest);
    vi.stubGlobal('fetch', vi.fn());
    window.history.replaceState({}, '', '/?surveyName=Survey%20A&demoToken=signed-demo-token');
  });

  it('loads real roster choices and completes without posting a response', async () => {
    render(<SurveyComponent setTitle={vi.fn()} />);

    await waitFor(() => expect(screen.getByTestId('survey-form')).toBeInTheDocument());
    expect(screen.getByText(/will not save any answers or results/i)).toBeInTheDocument();

    const setItems = vi.fn();
    act(() => {
      surveyState.model.lazyLoadHandler(null, {
        skip: 0,
        take: 25,
        filter: '',
        setItems,
      });
    });

    expect(MockXMLHttpRequest.requests.at(-1)).toContain('/names');
    expect(MockXMLHttpRequest.requests.at(-1)).toContain('demoToken=signed-demo-token');
    expect(setItems).toHaveBeenCalledWith(
      [{ value: 'Real Person (real@example.com)', text: 'Real Person (real@example.com)' }],
      1
    );

    const completionOptions = {};
    act(() => {
      surveyState.model.completingHandler({ data: { people: ['Real Person (real@example.com)'] } }, completionOptions);
    });

    expect(completionOptions.allowComplete).toBeUndefined();
    expect(fetch).not.toHaveBeenCalled();
  });
});
