import { act, renderHook } from '@testing-library/react';
import { expect, test } from 'vitest';
import useSurveyOperationState from './useSurveyOperationState';

test('keeps pending operations and monotonic generations across remounts', () => {
  const surveyId = 'operation-state-survey';
  const first = renderHook(() => useSurveyOperationState('questions'));

  act(() => {
    first.result.current.advanceGeneration(surveyId);
    expect(first.result.current.begin(surveyId)).toBe(true);
  });
  expect(first.result.current.isPending(surveyId)).toBe(true);
  expect(first.result.current.generation(surveyId)).toBe(1);
  first.unmount();

  const second = renderHook(() => useSurveyOperationState('questions'));
  expect(second.result.current.isPending(surveyId)).toBe(true);
  act(() => {
    second.result.current.end(surveyId);
    second.result.current.advanceGeneration(surveyId);
  });

  expect(second.result.current.isPending(surveyId)).toBe(false);
  expect(second.result.current.generation(surveyId)).toBe(2);
});

test('serializes operations independently by survey and section', () => {
  const questions = renderHook(() => useSurveyOperationState('questions'));
  const respondents = renderHook(() => useSurveyOperationState('respondents'));

  let firstQuestion;
  let secondQuestion;
  let firstRespondent;
  act(() => {
    firstQuestion = questions.result.current.begin('shared-survey');
    secondQuestion = questions.result.current.begin('shared-survey');
    firstRespondent = respondents.result.current.begin('shared-survey');
  });
  expect(firstQuestion).toBe(true);
  expect(secondQuestion).toBe(false);
  expect(firstRespondent).toBe(true);

  act(() => {
    questions.result.current.end('shared-survey');
    respondents.result.current.end('shared-survey');
  });
});
