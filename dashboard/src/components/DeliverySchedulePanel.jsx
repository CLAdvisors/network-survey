import React from 'react';
import { Alert, Box, Button, Paper, TextField, Typography } from '@mui/material';
import api from '../api/axios';

const timezoneDefault = () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
const initialForm = { startLocal: '', closeLocal: '', timezone: timezoneDefault(), reminderEveryDays: 1 };
const message = error => error?.response?.data?.message || 'Unable to save delivery schedule.';
const formatScheduleTime = (instant, timezone) => new Intl.DateTimeFormat(undefined, {
  timeZone: timezone, year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
}).format(new Date(instant));

export default function DeliverySchedulePanel({ surveyId, lifecycleStatus }) {
  const [schedule, setSchedule] = React.useState(null);
  const [form, setForm] = React.useState(initialForm);
  const [error, setError] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  React.useEffect(() => {
    const controller = new AbortController();
    setSchedule(null);
    setForm(initialForm);
    setError('');
    if (surveyId) api.get(`/surveys/${surveyId}/delivery-schedule`, { signal: controller.signal })
      .then(({ data }) => {
        if (controller.signal.aborted) return;
        const loaded = data.schedule || null;
        setSchedule(loaded);
        if (loaded) setForm({ startLocal: loaded.startLocal, closeLocal: loaded.closeLocal, timezone: loaded.timezone, reminderEveryDays: loaded.reminderEveryDays });
      })
      .catch(err => { if (!controller.signal.aborted) setError(message(err)); });
    return () => controller.abort();
  }, [surveyId]);
  if (!['draft', 'active'].includes(lifecycleStatus) || (lifecycleStatus === 'active' && !schedule)) return null;
  const update = (name, value) => setForm(current => ({ ...current, [name]: value }));
  const save = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const response = await api.put(`/surveys/${surveyId}/delivery-schedule`, { ...form, reminderEveryDays: Number(form.reminderEveryDays), expectedVersion: schedule?.version || 0 });
      setSchedule(response.data.schedule);
    } catch (err) { setError(message(err)); }
    finally { setBusy(false); }
  };
  const cancel = async () => {
    if (!window.confirm('Cancel future scheduled sends? Queued scheduled emails not yet sent will be stopped.')) return;
    setBusy(true);
    setError('');
    try {
      const response = await api.delete(`/surveys/${surveyId}/delivery-schedule`, { data: { expectedVersion: schedule.version } });
      setSchedule(current => ({ ...current, ...response.data }));
    } catch (err) { setError(message(err)); }
    finally { setBusy(false); }
  };
  return <Paper component="section" variant="outlined" aria-label="Automatic delivery schedule" sx={{ p: 2, mt: 2 }}>
    <Typography component="h3" variant="h6">Automatic launch and reminders</Typography>
    <Typography variant="body2">Times use the selected IANA timezone. Ambiguous or nonexistent launch/close times at daylight-saving transitions must be changed; daily reminders stay at local wall time, skipping forward through a missing hour.</Typography>
    {error && <Alert severity="error">{error}</Alert>}
    {schedule && <Alert severity="info">{schedule.status === 'active' ? `Next ${schedule.nextKind}: ${formatScheduleTime(schedule.nextDueAt, schedule.timezone)} (${schedule.timezone})` : `Schedule ${schedule.status}`}</Alert>}
    {(!schedule || schedule.status === 'active') && <Box component="form" onSubmit={save} sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mt: 2 }}>
      <TextField label="Launch local date and time" type="datetime-local" value={form.startLocal} onChange={event => update('startLocal', event.target.value)} disabled={busy || lifecycleStatus === 'active'} InputLabelProps={{ shrink: true }} required />
      <TextField label="Close local date and time" type="datetime-local" value={form.closeLocal} onChange={event => update('closeLocal', event.target.value)} disabled={busy} InputLabelProps={{ shrink: true }} required />
      <TextField label="IANA timezone" value={form.timezone} onChange={event => update('timezone', event.target.value)} disabled={busy || lifecycleStatus === 'active'} required helperText="For example, America/New_York" />
      <TextField label="Reminder cadence (days)" type="number" value={form.reminderEveryDays} onChange={event => update('reminderEveryDays', event.target.value)} inputProps={{ min: 1, max: 30 }} disabled={busy} required />
      <Button type="submit" disabled={busy}>{schedule ? 'Save changes' : 'Schedule launch'}</Button>
      {schedule && <Button color="error" disabled={busy} onClick={cancel}>Cancel schedule</Button>}
    </Box>}
  </Paper>;
}
