const { parseEventDate, chicagoDateKey, chicagoDateParts } = require('../utils/dates');
const { formatChiirlTimeShort } = require('../utils/dates');
const { escapeHtml } = require('../utils/format');

function formatEmailLocation(event) {
  if (!event) return '';
  if (event.Online === 'TRUE') return 'Online';
  const raw = String(event.location || '').trim();
  if (!raw) return '';
  const parts = raw
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);
  if (parts.length <= 2) return parts.join(', ');
  return `${parts[0]}, ${parts[parts.length - 1]}`;
}

function formatNextWeekVenue(event) {
  if (!event) return '';
  if (event.Online === 'TRUE') return 'Online';
  const raw = String(event.location || '').trim();
  if (!raw) return '';
  return raw.split(',').map((x) => x.trim()).filter(Boolean)[0] || '';
}

function buildEmailDraftModel(events, referenceDate = new Date()) {
  const todayKey = chicagoDateKey(referenceDate);
  const sorted = [...events]
    .filter((e) => {
      const dt = parseEventDate(e.start_datetime);
      if (!dt) return false;
      return chicagoDateKey(dt) >= todayKey;
    })
    .sort((a, b) => {
    const ta = parseEventDate(a.start_datetime)?.getTime() || 0;
    const tb = parseEventDate(b.start_datetime)?.getTime() || 0;
    return ta - tb;
  });

  const byDay = new Map();
  for (const e of sorted) {
    const dt = parseEventDate(e.start_datetime);
    if (!dt) continue;
    const key = chicagoDateKey(dt);
    if (!byDay.has(key)) {
      const p = chicagoDateParts(dt);
      byDay.set(key, {
        label: `${String(p.month).padStart(2, '0')}.${String(p.day).padStart(2, '0')} ${p.weekday}`,
        events: []
      });
    }
    byDay.get(key).events.push(e);
  }

  return [...byDay.values()].map((day) => ({
    label: day.label,
    events: day.events.map((e) => ({
      time: formatChiirlTimeShort(e.start_datetime),
      title: e.title || '',
      location: formatEmailLocation(e),
      eventUrl: e.eventUrl || '#'
    }))
  }));
}

function buildEmailDraft(events, referenceDate = new Date()) {
  const days = buildEmailDraftModel(events, referenceDate);
  const lines = [
    'Hey CHI IRL,',
    '',
    'Hope you have a good week!',
    ''
  ];

  for (const day of days) {
    lines.push(day.label);
    lines.push('');
    for (const e of day.events) {
      lines.push(`    ${e.time}: ${e.title}${e.location ? `, ${e.location}` : ''}`);
    }
    lines.push('');
  }

  if (days.length === 0) {
    lines.push('No upcoming events found.');
  }

  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd();
}

function buildEmailDraftHtml(events, referenceDate = new Date()) {
  const days = buildEmailDraftModel(events, referenceDate);
  const lines = [
    'Hey CHI IRL,',
    '',
    'Hope you have a good week!',
    ''
  ];

  for (const day of days) {
    lines.push(escapeHtml(day.label));
    lines.push('');
    for (const e of day.events) {
      const href = escapeHtml(e.eventUrl || '#');
      const title = escapeHtml(e.title || '');
      const location = e.location ? `, ${escapeHtml(e.location)}` : '';
      lines.push(`    ${escapeHtml(e.time)}: <a href="${href}" target="_blank" rel="noopener noreferrer">${title}</a>${location}`);
    }
    lines.push('');
  }

  if (days.length === 0) lines.push('No upcoming events found.');
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd();
}

module.exports = {
  formatEmailLocation,
  formatNextWeekVenue,
  buildEmailDraftModel,
  buildEmailDraft,
  buildEmailDraftHtml
};
