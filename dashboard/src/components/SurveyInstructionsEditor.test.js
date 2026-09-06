import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, test, vi } from 'vitest';
import api from '../api/axios';
import SurveyInstructionsEditor from './SurveyInstructionsEditor';
import { advanceSurveyOperationGeneration } from './useSurveyOperationState';

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

test('applies and removes same-line bold markers with the toolbar and keyboard shortcut', async () => {
  api.get.mockResolvedValue(response('Read this carefully.'));
  render(<SurveyInstructionsEditor surveyId="survey-bold" />);
  const field = await screen.findByDisplayValue('Read this carefully.');
  expect(field).toHaveAttribute('aria-keyshortcuts', 'Control+B Meta+B');

  field.setSelectionRange(5, 5);
  await userEvent.click(screen.getByRole('button', { name: 'Toggle bold formatting' }));
  expect(field).toHaveValue('Read this carefully.');
  expect(await screen.findByText(/Select one or more words/)).toBeInTheDocument();

  field.setSelectionRange(5, 9);
  await userEvent.click(screen.getByRole('button', { name: 'Toggle bold formatting' }));
  expect(field).toHaveValue('Read **this** carefully.');
  expect(screen.getByTestId('survey-instructions-preview').querySelector('strong')).toHaveTextContent('this');

  field.setSelectionRange(7, 11);
  fireEvent.keyDown(field, { key: 'b', ctrlKey: true });
  expect(field).toHaveValue('Read this carefully.');

  field.setSelectionRange(5, 9);
  fireEvent.keyDown(field, { key: 'b', metaKey: true });
  expect(field).toHaveValue('Read **this** carefully.');
  await userEvent.click(screen.getByRole('button', { name: /save instructions/i }));
  expect(api.put).toHaveBeenLastCalledWith('/surveys/survey-bold/instructions', {
    instructions: 'Read **this** carefully.',
    expectedInstructions: 'Read this carefully.',
  });
});

test('uses the respondent grammar for a safe, author-visible formatted preview', async () => {
  api.get.mockResolvedValue(response('Review **<script>literal</script>** and *single stars*.'));
  const { container } = render(<SurveyInstructionsEditor surveyId="survey-preview" />);
  const preview = await screen.findByTestId('survey-instructions-preview');
  expect(screen.getByText('Formatted preview')).toBeInTheDocument();
  expect(preview.querySelector('strong')).toHaveTextContent('<script>literal</script>');
  expect(preview.textContent).toBe('Review <script>literal</script> and *single stars*.');
  expect(container.querySelector('script')).toBeNull();
});

test('bolds each nonempty line separately instead of creating multiline markup', async () => {
  render(<SurveyInstructionsEditor surveyId="survey-multiline" />);
  expect(await screen.findByText(/Current derived default/)).toBeInTheDocument();
  await userEvent.click(screen.getByRole('radio', { name: /use custom instructions/i }));
  const field = screen.getByLabelText('Custom survey instructions');
  fireEvent.change(field, { target: { value: 'First line\n\nSecond line' } });
  field.setSelectionRange(0, field.value.length);
  await userEvent.click(screen.getByRole('button', { name: 'Toggle bold formatting' }));
  expect(field).toHaveValue('**First line**\n\n**Second line**');
  await userEvent.click(screen.getByRole('button', { name: 'Toggle bold formatting' }));
  expect(field).toHaveValue('First line\n\nSecond line');

  fireEvent.change(field, { target: { value: 'Fields marked * are required' } });
  field.setSelectionRange(0, field.value.length);
  await userEvent.click(screen.getByRole('button', { name: 'Toggle bold formatting' }));
  expect(field).toHaveValue('**Fields marked * are required**');
});

test('maps normalized textarea offsets to a CRLF API value before formatting and saving', async () => {
  const persisted = 'First line\r\nSecond line';
  api.get.mockResolvedValue(response(persisted));
  render(<SurveyInstructionsEditor surveyId="survey-crlf" />);
  const field = await screen.findByLabelText('Custom survey instructions');
  expect(field.value).toBe('First line\nSecond line');

  const start = field.value.indexOf('Second');
  field.setSelectionRange(start, start + 'Second'.length);
  await userEvent.click(screen.getByRole('button', { name: 'Toggle bold formatting' }));
  expect(field.value).toBe('First line\n**Second** line');

  await userEvent.click(screen.getByRole('button', { name: /save instructions/i }));
  expect(api.put).toHaveBeenLastCalledWith('/surveys/survey-crlf/instructions', {
    instructions: 'First line\r\n**Second** line',
    expectedInstructions: persisted,
  });
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
  expect(api.put).toHaveBeenCalledWith('/surveys/survey-a/instructions', {
    instructions: 'Draft A',
    expectedInstructions: 'Original A',
  });
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

test('shows read-only messaging, disables updates, and reloads authoritative content when discarding a locked draft', async () => {
  api.get
    .mockResolvedValueOnce(response(null))
    .mockResolvedValueOnce(response('Latest locked value'));
  const dirty = vi.fn();
  const { rerender } = render(<SurveyInstructionsEditor surveyId="survey-a" onDirtyChange={dirty} />);
  expect(await screen.findByText(/Current derived default: Derived default/)).toBeInTheDocument();
  await userEvent.click(screen.getByRole('radio', { name: /hide the instruction block/i }));

  rerender(<SurveyInstructionsEditor surveyId="survey-a" readOnly readOnlyMessage="Instructions are read-only while this survey is launched." onDirtyChange={dirty} />);
  expect(await screen.findByText(/read-only while this survey is launched/i)).toBeInTheDocument();
  expect(screen.getByRole('radio', { name: /use the derived default/i })).toBeDisabled();
  expect(screen.getByRole('button', { name: /save instructions/i })).toBeDisabled();
  expect(screen.getByRole('button', { name: /undo changes/i })).toBeEnabled();
  await userEvent.click(screen.getByRole('button', { name: /undo changes/i }));
  expect(await screen.findByDisplayValue('Latest locked value')).toBeInTheDocument();
  expect(dirty).toHaveBeenLastCalledWith('survey-a', 'instructions', false);
});

test('retains a stale draft and reloads the latest value before allowing an explicit retry', async () => {
  api.get
    .mockResolvedValueOnce(response('Original'))
    .mockResolvedValueOnce(response('Newer value'));
  api.put.mockRejectedValueOnce({ response: { data: { error: 'instructions_conflict', message: 'Instructions changed.' } } });
  render(<SurveyInstructionsEditor surveyId="survey-a" />);
  const field = await screen.findByDisplayValue('Original');
  fireEvent.change(field, { target: { value: 'Stale draft' } });
  await userEvent.click(screen.getByRole('button', { name: /save instructions/i }));

  expect(await screen.findByText('Instructions changed.')).toBeInTheDocument();
  expect(screen.getByDisplayValue('Stale draft')).toBeInTheDocument();
  expect(api.put).toHaveBeenLastCalledWith('/surveys/survey-a/instructions', {
    instructions: 'Stale draft',
    expectedInstructions: 'Original',
  });

  await userEvent.click(screen.getByRole('button', { name: 'Reload latest' }));
  await waitFor(() => expect(api.get).toHaveBeenCalledTimes(2));
  expect(screen.getByDisplayValue('Stale draft')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: /save instructions/i }));
  expect(api.put).toHaveBeenLastCalledWith('/surveys/survey-a/instructions', {
    instructions: 'Stale draft',
    expectedInstructions: 'Newer value',
  });
});

test('automatically reloads when an in-flight response becomes stale by generation', async () => {
  const stale = deferred();
  api.get
    .mockReturnValueOnce(stale.promise)
    .mockResolvedValueOnce(response('Authoritative after save'));
  render(<SurveyInstructionsEditor surveyId="survey-generation-retry" />);
  advanceSurveyOperationGeneration('instructions', 'survey-generation-retry');
  stale.resolve(response('Stale value'));
  expect(await screen.findByDisplayValue('Authoritative after save')).toBeInTheDocument();
  expect(screen.queryByDisplayValue('Stale value')).not.toBeInTheDocument();
  expect(api.get).toHaveBeenCalledTimes(2);
});

test('keeps editing disabled after a load error and enables it only after retry', async () => {
  api.get
    .mockRejectedValueOnce(new Error('load failed'))
    .mockResolvedValueOnce(response('Persisted'));
  render(<SurveyInstructionsEditor surveyId="survey-load-error" />);
  expect(await screen.findByText(/Unable to load survey instructions/)).toBeInTheDocument();
  expect(screen.getByRole('radio', { name: /use custom instructions/i })).toBeDisabled();
  expect(screen.getByRole('button', { name: /save instructions/i })).toBeDisabled();
  await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
  expect(await screen.findByDisplayValue('Persisted')).toBeInTheDocument();
  expect(screen.getByRole('radio', { name: /use custom instructions/i })).toBeEnabled();
});
