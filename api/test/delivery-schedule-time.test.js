'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { localToInstant, nextReminder, scheduleFields } = require('../delivery-schedule-time');

test('IANA timezone launch stores the correct UTC instant and rejects invalid input', () => {
  const fields = scheduleFields({ startLocal: '2026-10-01T10:30', closeLocal: '2026-10-07T10:30', timezone: 'America/New_York', reminderEveryDays: 1 }, new Date('2026-09-29'));
  assert.equal(fields.startAt.toISOString(), '2026-10-01T14:30:00.000Z');
  assert.throws(() => scheduleFields({ ...fields, timezone: 'Not/A_Zone' }), /IANA timezone/);
  assert.throws(() => localToInstant('2026-02-30T09:00', 'UTC'), /invalid/);
  assert.throws(() => localToInstant('2026-03-08T02:30', 'America/New_York'), /Nonexistent/);
  assert.throws(() => localToInstant('2026-11-01T01:30', 'America/New_York'), /Ambiguous/);
});

test('calendar-day cadence uses wall time across spring gap and fall overlap only once', () => {
  const spring = nextReminder('2026-03-07T02:30', 'America/New_York', 1, '2026-03-11T00:00:00Z');
  assert.equal(spring.local, '2026-03-08T02:30');
  assert.equal(spring.at.toISOString(), '2026-03-08T07:00:00.000Z');
  const fall = nextReminder('2026-10-31T01:30', 'America/New_York', 1, '2026-11-05T00:00:00Z');
  assert.equal(fall.at.toISOString(), '2026-11-01T05:30:00.000Z');
  assert.equal(nextReminder('2026-11-04T01:30', 'America/New_York', 1, '2026-11-05T00:00:00Z'), null);
  // A skipped whole date (IANA dateline transition) also advances to the first valid minute.
  assert.equal(localToInstant('2011-12-30T10:00', 'Pacific/Apia', { gap: 'next' }).toISOString(), '2011-12-30T10:00:00.000Z');
});
