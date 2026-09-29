import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, test, vi } from 'vitest';
import DeliverySchedulePanel from './DeliverySchedulePanel';
import api from '../api/axios';

vi.mock('../api/axios', () => ({ default: { get: vi.fn(), put: vi.fn(), delete: vi.fn() } }));
beforeEach(() => { vi.clearAllMocks(); api.get.mockResolvedValue({ data: { schedule: null } }); });

test('admin schedule form submits explicit wall time and timezone then cancels by version', async () => {
  api.put.mockResolvedValue({ data: { schedule: { id: 'schedule-1', surveyId: 'survey-1', startLocal: '2026-10-15T09:00', closeLocal: '2026-10-21T09:00', timezone: 'America/New_York', reminderEveryDays: 1, version: 1, status: 'active', nextKind: 'initial', nextDueAt: '2026-10-15T13:00:00Z' } } });
  api.delete.mockResolvedValue({ data: { status: 'cancelled', version: 2 } });
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
  render(<DeliverySchedulePanel surveyId="survey-1" lifecycleStatus="draft" />);
  fireEvent.change(screen.getByLabelText(/Launch local date and time/), { target: { value: '2026-10-15T09:00' } });
  fireEvent.change(screen.getByLabelText(/Close local date and time/), { target: { value: '2026-10-21T09:00' } });
  fireEvent.change(screen.getByLabelText(/IANA timezone/), { target: { value: 'America/New_York' } });
  await userEvent.click(screen.getByRole('button', { name: 'Schedule launch' }));
  await waitFor(() => expect(api.put).toHaveBeenCalledWith('/surveys/survey-1/delivery-schedule', { startLocal: '2026-10-15T09:00', closeLocal: '2026-10-21T09:00', timezone: 'America/New_York', reminderEveryDays: 1, expectedVersion: 0 }));
  expect(await screen.findByText(/Next initial:.*9:00.*America\/New_York/)).toBeInTheDocument();
  await userEvent.click(await screen.findByRole('button', { name: 'Cancel schedule' }));
  expect(api.delete).toHaveBeenCalledWith('/surveys/survey-1/delivery-schedule', { data: { expectedVersion: 1 } });
  expect(await screen.findByText('Schedule cancelled')).toBeInTheDocument();
  expect(confirm).toHaveBeenCalledTimes(1);
  confirm.mockRestore();
});

test('schedule editor shows DST validation response without making an optimistic change', async () => {
  api.put.mockRejectedValue({ response: { data: { message: 'Ambiguous local time at daylight-saving transition; choose another time.' } } });
  render(<DeliverySchedulePanel surveyId="survey-1" lifecycleStatus="draft" />);
  fireEvent.change(screen.getByLabelText(/Launch local date and time/), { target: { value: '2026-11-01T01:30' } });
  fireEvent.change(screen.getByLabelText(/Close local date and time/), { target: { value: '2026-11-02T01:30' } });
  await userEvent.click(screen.getByRole('button', { name: 'Schedule launch' }));
  expect(await screen.findByText(/Ambiguous local time at daylight-saving transition/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Schedule launch' })).toBeInTheDocument();
});
