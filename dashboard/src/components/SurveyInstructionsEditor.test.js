import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, test, vi } from 'vitest';
import api from '../api/axios';
import SurveyInstructionsEditor from './SurveyInstructionsEditor';

vi.mock('../api/axios', () => ({ default: { get: vi.fn(), put: vi.fn() } }));
const response = (instructions, effectiveInstructions = 'Derived default') => ({ data: { instructions, effectiveInstructions, limits: { characters: 5000, bytes: 16000 } } });
const deferred = () => { let resolve; let reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };

beforeEach(() => {
  vi.clearAllMocks();
  api.get.mockResolvedValue(response(null));
  api.put.mockImplementation((_url, body) => Promise.resolve(response(body.instructions)));
});

test('offers explicit derived, hidden, and custom semantics with accessible count and undo', async () => {
  const dirty = vi.fn();
  render(<SurveyInstructionsEditor surveyId="survey-a" onDirtyChange={dirty} />);
  expect(await screen.findByText(/Current derived default: Derived default/)).toBeInTheDocument();
  expect(screen.getByRole('radio', { name: /use the derived default/i })).toBeChecked();

  await userEvent.click(screen.getByRole('radio', { name: /hide the instruction block/i }));
  expect(dirty).toHaveBeenLastCalledWith('survey-a', 'instructions', true);
  await userEvent.click(screen.getByRole('button', { name: /undo changes/i }));
  expect(screen.getByRole('radio', { name: /use the derived default/i })).toBeChecked();

  await userEvent.click(screen.getByRole('radio', { name: /use custom instructions/i }));
  const field = screen.getByLabelText('Custom survey instructions');
  fireEvent.change(field, { target: { value: 'Line one\nLine two' } });
  expect(screen.getAllByText(/17\/5000 characters/).length).toBeGreaterThan(0);
});

test('preserves survey-scoped drafts across switches and rejects stale loads', async () => {
  const staleA = deferred();
  api.get.mockImplementation((url) => {
    if (url.includes('survey-a') && api.get.mock.calls.filter(([called]) => called.includes('survey-a')).length === 1) return staleA.promise;
    if (url.includes('survey-a')) return Promise.resolve(response('Fresh A'));
    return Promise.resolve(response('Persisted B'));
  });
  const { rerender } = render(<SurveyInstructionsEditor surveyId="survey-a" />);
  rerender(<SurveyInstructionsEditor surveyId="survey-b" />);
  expect(await screen.findByDisplayValue('Persisted B')).toBeInTheDocument();
  staleA.resolve(response('Stale A'));
  await waitFor(() => expect(screen.getByDisplayValue('Persisted B')).toBeInTheDocument());

  fireEvent.change(screen.getByLabelText('Custom survey instructions'), { target: { value: 'Draft B' } });
  rerender(<SurveyInstructionsEditor surveyId="survey-a" />);
  expect(await screen.findByDisplayValue('Fresh A')).toBeInTheDocument();
  rerender(<SurveyInstructionsEditor surveyId="survey-b" />);
  expect(await screen.findByDisplayValue('Draft B')).toBeInTheDocument();
});

test('retains drafts on save errors and ignores stale save completion after a survey switch', async () => {
  const save = deferred();
  let persistedA = 'Original A';
  api.get.mockImplementation((url) => Promise.resolve(response(url.includes('survey-a') ? persistedA : 'Original B')));
  api.put.mockReturnValueOnce(save.promise);
  const dirty = vi.fn();
  const { rerender } = render(<SurveyInstructionsEditor surveyId="survey-a" onDirtyChange={dirty} />);
  const field = await screen.findByDisplayValue('Original A');
  fireEvent.change(field, { target: { value: 'Draft A' } });
  await userEvent.click(screen.getByRole('button', { name: /save instructions/i }));
  rerender(<SurveyInstructionsEditor surveyId="survey-b" onDirtyChange={dirty} />);
  expect(await screen.findByDisplayValue('Original B')).toBeInTheDocument();
  persistedA = 'Draft A';
  save.resolve(response('Draft A'));
  await waitFor(() => expect(screen.getByDisplayValue('Original B')).toBeInTheDocument());

  rerender(<SurveyInstructionsEditor surveyId="survey-a" onDirtyChange={dirty} />);
  const restored = await screen.findByDisplayValue('Draft A');
  fireEvent.change(restored, { target: { value: 'Draft A retained after error' } });
  api.put.mockRejectedValueOnce({ response: { data: { message: 'Save unavailable' } } });
  await userEvent.click(screen.getByRole('button', { name: /save instructions/i }));
  expect((await screen.findByText('Save unavailable')).closest('[tabindex="-1"]')).not.toBeNull();
  expect(screen.getByDisplayValue('Draft A retained after error')).toBeInTheDocument();
});

test('shows lifecycle read-only messaging and disables updates', async () => {
  render(<SurveyInstructionsEditor surveyId="survey-a" readOnly />);
  expect(await screen.findByText(/read-only after a survey has been launched/i)).toBeInTheDocument();
  expect(screen.getByRole('radio', { name: /use the derived default/i })).toBeDisabled();
  expect(screen.getByRole('button', { name: /save instructions/i })).toBeDisabled();
});
