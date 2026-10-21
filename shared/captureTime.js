export function validZone(zone) {
  try { new Intl.DateTimeFormat('en', { timeZone: zone }); return typeof zone === 'string' && zone.length > 0; } catch { return false; }
}

export function validDate(date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) return false;
  const d = new Date(`${date}T00:00:00Z`);
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === date;
}

export function localDateTime(iso, zone) {
  if (!iso || !validZone(zone)) return '';
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(iso)).map(p => [p.type, p.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}

// Return no instant for a skipped or repeated wall-clock time; the review must resolve it.
export function zonedInstant(local, zone) {
  if (!validZone(zone) || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(local || '') || !validDate(local.slice(0, 10))) return null;
  const nominal = Date.parse(local + ':00Z');
  if (!Number.isFinite(nominal)) return null;
  const offsets = new Set();
  for (const delta of [-36, -12, 0, 12, 36]) {
    const instant = nominal + delta * 3600000;
    offsets.add(Date.parse(localDateTime(instant, zone) + ':00Z') - instant);
  }
  const matches = [...offsets].map(offset => nominal - offset).filter(ms => localDateTime(ms, zone) === local);
  return matches.length === 1 ? new Date(matches[0]).toISOString() : null;
}

export function suggestedReminder(date, time, zone, now = Date.now()) {
  if (!validDate(date)) return null;
  const deadline = zonedInstant(`${date}T${time || '09:00'}`, zone);
  if (!deadline) return null;
  const at = Date.parse(deadline) - (time ? 3600000 : 0);
  return at > now ? new Date(at).toISOString() : null;
}
