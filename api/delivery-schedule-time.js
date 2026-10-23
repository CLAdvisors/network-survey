'use strict';

const LOCAL_DATE_TIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

function localParts(instant, zone, formatter = new Intl.DateTimeFormat('en-US-u-ca-gregory', {
    timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  })) {
  const parts = Object.fromEntries(formatter.formatToParts(instant).map(part => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

function parseLocal(local) {
  const match = LOCAL_DATE_TIME.exec(String(local || ''));
  if (!match) throw new Error('Provide date and time as YYYY-MM-DDTHH:mm.');
  const [year, month, day, hour, minute] = match.slice(1).map(Number);
  const utc = Date.UTC(year, month - 1, day, hour, minute);
  if (!Number.isFinite(utc) || utc < 0 || new Date(utc).toISOString().slice(0, 16) !== local) throw new Error('Local date or time is invalid.');
  return utc;
}

// Scan possible offsets at one-minute resolution. A nonexistent DST wall time has
// zero matches; a repeated wall time has two and needs an explicit user choice.
function localToInstant(local, zone, { overlap = 'reject', gap = 'reject' } = {}) {
  const naive = parseLocal(local);
  let formatter;
  try { formatter = new Intl.DateTimeFormat('en-US-u-ca-gregory', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }); formatter.format(new Date()); }
  catch { throw new Error('Use a valid IANA timezone.'); }
  let first = null;
  let matches = 0;
  let next = null;
  for (let offset = -14 * 60; offset <= 14 * 60; offset++) {
    const time = naive + offset * 60000;
    const wall = localParts(new Date(time), zone, formatter);
    if (gap === 'next' && wall > local && (!next || wall < next.wall || (wall === next.wall && time < next.time))) next = { wall, time };
    if (wall !== local) continue;
    if (first === null) first = time;
    matches += 1;
    if (matches > 1 && overlap === 'reject') throw new Error('Ambiguous local time at daylight-saving transition; choose another time.');
    if (matches > 1) break;
  }
  if (first === null) {
    if (gap === 'next' && next) return new Date(next.time);
    throw new Error('Nonexistent local time at daylight-saving transition; choose another time.');
  }
  return new Date(first);
}

function nextLocalDay(local, days) {
  const naive = parseLocal(local);
  const next = new Date(naive);
  next.setUTCDate(next.getUTCDate() + days);
  return next.toISOString().slice(0, 16);
}

function scheduleFields({ startLocal, closeLocal, timezone, reminderEveryDays }, now = new Date()) {
  if (!Number.isSafeInteger(reminderEveryDays) || reminderEveryDays < 1 || reminderEveryDays > 30) throw new Error('Reminder cadence must be 1–30 days.');
  if (typeof timezone !== 'string' || timezone.length > 100) throw new Error('Use a valid IANA timezone.');
  const startAt = localToInstant(startLocal, timezone);
  const closeAt = localToInstant(closeLocal, timezone);
  if (startAt <= now || closeAt <= startAt || closeAt > new Date(startAt.getTime() + 365 * 86400000)) throw new Error('Schedule a future launch and a later close within one year.');
  return { startAt, closeAt, timezone, startLocal, closeLocal, reminderEveryDays };
}

function nextReminder(local, zone, days, closeAt) {
  const following = nextLocalDay(local, days);
  const instant = localToInstant(following, zone, { overlap: 'earlier', gap: 'next' });
  return instant < new Date(closeAt) ? { local: following, at: instant } : null;
}

module.exports = { localToInstant, localParts, nextLocalDay, nextReminder, scheduleFields };
