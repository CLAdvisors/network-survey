import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import EmailNotificationEditor from './EmailNotificationEditor';
import api from '../api/axios';

vi.mock('../api/axios', () => ({
  default: { get: vi.fn(), post: vi.fn() },
}));

beforeEach(() => {
  vi.clearAllMocks();
  api.get.mockResolvedValue({
    data: {
      notifications: { English: 'Hello, "team"! Don’t remove punctuation.' },
      subjects: { English: 'You’re invited!' },
    },
  });
  api.post.mockResolvedValue({ data: { success: true } });
});

test('loads subject and text, protects language changes while dirty, and saves JSON unchanged', async () => {
  render(<EmailNotificationEditor surveyId="survey-1" />);

  const subject = await screen.findByLabelText('Email subject');
  const text = screen.getByLabelText('Notification text');
  expect(subject).toHaveValue('You’re invited!');
  expect(text).toHaveValue('Hello, "team"! Don’t remove punctuation.');

  await userEvent.clear(subject);
  await userEvent.type(subject, 'Reminder: don’t forget!');
  await userEvent.clear(text);
  await userEvent.type(text, 'Hi, "friend" — please respond!');

  expect(screen.getByLabelText('Language')).toBeDisabled();
  await userEvent.click(screen.getByRole('button', { name: 'Save' }));

  await waitFor(() => expect(api.post).toHaveBeenCalledWith('/survey-notifications/survey-1', {
    language: 'English',
    subject: 'Reminder: don’t forget!',
    text: 'Hi, "friend" — please respond!',
  }, expect.objectContaining({ signal: expect.any(AbortSignal) })));
  expect(screen.getByLabelText('Language')).not.toBeDisabled();
});

test('handles absent notification maps without undefined errors', async () => {
  api.get.mockResolvedValueOnce({ data: {} });
  render(<EmailNotificationEditor surveyId="empty-survey" />);
  expect(await screen.findByLabelText('Email subject')).toHaveValue('');
  expect(screen.getByLabelText('Notification text')).toHaveValue('');
});

test('rejects a CSV without a recognized text or message header before saving', async () => {
  const { container } = render(<EmailNotificationEditor surveyId="survey-1" />);
  await screen.findByLabelText('Email subject');
  const file = new File(['Language,Subject,Body\nEnglish,Hello,Wrong column'], 'bad.csv', { type: 'text/csv' });

  await userEvent.upload(container.querySelector('input[type="file"]'), file);

  expect(await screen.findByText(/recognized Text or Message header/i)).toBeInTheDocument();
  expect(api.post).not.toHaveBeenCalled();
});

test('an in-flight CSV import cannot update state after surveyId changes', async () => {
  let resolveImport;
  const importRequest = new Promise((resolve) => { resolveImport = resolve; });
  api.get.mockImplementation(async (url) => ({
    data: url.endsWith('survey-2')
      ? { notifications: { English: 'Survey two text' }, subjects: { English: 'Survey two subject' } }
      : { notifications: { English: 'Survey one text' }, subjects: { English: 'Survey one subject' } },
  }));
  api.post.mockReturnValueOnce(importRequest);
  const onBusyChange = vi.fn();
  const { container, rerender } = render(
    <EmailNotificationEditor surveyId="survey-1" onBusyChange={onBusyChange} />
  );
  expect(await screen.findByLabelText('Email subject')).toHaveValue('Survey one subject');

  const file = new File(['Language,Message\nEnglish,Imported old text'], 'valid.csv', { type: 'text/csv' });
  await userEvent.upload(container.querySelector('input[type="file"]'), file);
  await waitFor(() => expect(api.post).toHaveBeenCalled());
  await waitFor(() => expect(onBusyChange).toHaveBeenCalledWith(true));

  rerender(<EmailNotificationEditor surveyId="survey-2" onBusyChange={onBusyChange} />);
  expect(await screen.findByLabelText('Email subject')).toHaveValue('Survey two subject');
  resolveImport({ data: { success: true } });

  await waitFor(() => expect(screen.getByLabelText('Notification text')).toHaveValue('Survey two text'));
  expect(screen.queryByText('Email notifications imported.')).not.toBeInTheDocument();
});
