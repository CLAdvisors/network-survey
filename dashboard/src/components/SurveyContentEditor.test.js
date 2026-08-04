import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import SurveyContentEditor from './SurveyContentEditor';
import api from '../api/axios';

vi.mock('../api/axios', () => ({
  default: { get: vi.fn(), put: vi.fn() },
}));

beforeEach(() => {
  vi.clearAllMocks();
  api.get.mockResolvedValue({ data: { instructions: 'First line\nSecond line' } });
  api.put.mockResolvedValue({ data: { instructions: 'Updated' } });
});

test('loads, resets, and saves multiline survey instructions', async () => {
  render(<SurveyContentEditor surveyId="survey-1" />);

  const input = await screen.findByLabelText('Instructions shown to respondents');
  expect(input).toHaveValue('First line\nSecond line');
  expect(api.get).toHaveBeenCalledWith('/survey-content/survey-1');

  await userEvent.clear(input);
  await userEvent.type(input, 'Changed instructions');
  await userEvent.click(screen.getByRole('button', { name: 'Reset' }));
  expect(input).toHaveValue('First line\nSecond line');

  await userEvent.clear(input);
  await userEvent.type(input, 'Updated');
  await userEvent.click(screen.getByRole('button', { name: 'Save' }));

  await waitFor(() => expect(api.put).toHaveBeenCalledWith('/survey-content/survey-1', { instructions: 'Updated' }));
  expect(await screen.findByText('Survey instructions saved.')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
});

test('disables editing from an unknown baseline after load failure and safely retries', async () => {
  api.get.mockRejectedValueOnce(new Error('network'));
  render(<SurveyContentEditor surveyId="survey-2" />);

  expect(await screen.findByText(/Failed to load survey instructions/i)).toBeInTheDocument();
  expect(screen.getByLabelText('Instructions shown to respondents')).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  expect(api.put).not.toHaveBeenCalled();

  await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
  await waitFor(() => expect(screen.getByLabelText('Instructions shown to respondents')).toHaveValue('First line\nSecond line'));
  await waitFor(() => expect(screen.getByLabelText('Instructions shown to respondents')).not.toBeDisabled());
  expect(api.get).toHaveBeenCalledTimes(2);
});
