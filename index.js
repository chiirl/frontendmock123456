const express = require('express');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const app = express();
const supabaseReadKey =
  process.env.SUPABASE_PUBLISHABLE_KEY ||
  process.env.SUPABASE_ANON_KEY ||
  process.env.SUPABASE_KEY;
if (!process.env.SUPABASE_URL || !supabaseReadKey) {
  throw new Error('Missing SUPABASE_URL or SUPABASE_PUBLISHABLE_KEY');
}
const supabase = createClient(process.env.SUPABASE_URL, supabaseReadKey);
const REAL_TABLE_NAME = process.env.SUPABASE_TABLE || 'beta_chiirl_events';
const INACCURATE_TABLE_NAME = process.env.SUPABASE_INACCURATE_TABLE || 'CTC Current Events';
const CHICAGO_TIMEZONE = 'America/Chicago';

function getSource(req) {
  return req.query.source === 'inaccurate' ? 'inaccurate' : 'real';
}

function getView(req) {
  if (req.query.view === 'email') return 'email';
  if (req.query.view === 'calendar') return 'calendar';
  return 'events';
}

function getTableName(source) {
  return source === 'inaccurate' ? INACCURATE_TABLE_NAME : REAL_TABLE_NAME;
}

function buildUrl(path, source, params = {}) {
  const query = new URLSearchParams({ source });
  Object.entries(params).forEach(([k, v]) => {
    if (v != null && v !== '') query.set(k, v);
  });
  const qs = query.toString();
  return qs ? `${path}?${qs}` : path;
}

function getEventTags(event) {
  if (!event) return [];

  const clean = (x) => String(x || '').trim();
  const uniq = (arr) => [...new Set(arr.map(clean).filter(Boolean))];

  if (Array.isArray(event.tags)) return uniq(event.tags);

  if (typeof event.tags === 'string' && event.tags.trim()) {
    try {
      const parsed = JSON.parse(event.tags);
      if (Array.isArray(parsed)) return uniq(parsed);
    } catch {
      // fall through to delimiter parsing
    }
    return uniq(event.tags.split(/[|,]/));
  }

  if (typeof event.tech_category === 'string' && event.tech_category.trim()) {
    return uniq(event.tech_category.split('|'));
  }

  return [];
}

function parseEventDate(raw) {
  if (!raw) return null;
  const asDate = new Date(raw);
  if (!Number.isNaN(asDate.getTime())) return asDate;

  const withOffset = raw
    .replace(' CST', ' GMT-0600')
    .replace(' CDT', ' GMT-0500');
  const fallback = new Date(withOffset);
  return Number.isNaN(fallback.getTime()) ? null : fallback;
}

function chicagoDateKey(d) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: CHICAGO_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(d);
}

function chicagoDateParts(d) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: CHICAGO_TIMEZONE,
    weekday: 'long',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(d);
  const pick = (type) => parts.find((p) => p.type === type)?.value || '';
  return {
    weekday: pick('weekday'),
    year: Number(pick('year')),
    month: Number(pick('month')),
    day: Number(pick('day'))
  };
}

function formatChiirlTimeShort(raw) {
  const d = parseEventDate(raw);
  if (!d) return '';
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: CHICAGO_TIMEZONE,
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  }).formatToParts(d);
  const pick = (type) => parts.find((p) => p.type === type)?.value || '';
  const hour = pick('hour');
  const minute = pick('minute');
  const ap = (pick('dayPeriod') || '').toLowerCase().startsWith('p') ? 'p' : 'a';
  if (!hour) return '';
  return minute === '00' ? `${hour}${ap}` : `${hour}${minute}${ap}`;
}

function escapeHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function parseMonthParam(monthParam) {
  const m = String(monthParam || '').match(/^(\d{4})-(\d{2})$/);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  if (!year || month < 1 || month > 12) return null;
  return { year, month };
}

function formatMonthParam(year, month) {
  return `${year}-${String(month).padStart(2, '0')}`;
}

function shiftMonthParam(monthParam, delta) {
  const parsed = parseMonthParam(monthParam);
  if (!parsed) return '';
  const d = new Date(Date.UTC(parsed.year, parsed.month - 1 + delta, 1, 12, 0, 0));
  return formatMonthParam(d.getUTCFullYear(), d.getUTCMonth() + 1);
}

function buildCalendarModel(events, monthParam, referenceDate = new Date()) {
  const ref = chicagoDateParts(referenceDate);
  const parsed = parseMonthParam(monthParam);
  const year = parsed?.year || ref.year;
  const month = parsed?.month || ref.month;
  const monthParamResolved = formatMonthParam(year, month);

  const first = new Date(Date.UTC(year, month - 1, 1, 12, 0, 0));
  const nextMonthFirst = new Date(Date.UTC(year, month, 1, 12, 0, 0));
  const firstWeekday = first.getUTCDay(); // Sun=0
  const gridStart = new Date(first);
  gridStart.setUTCDate(gridStart.getUTCDate() - firstWeekday);

  const eventMap = new Map();
  for (const e of events) {
    const dt = parseEventDate(e.start_datetime);
    if (!dt) continue;
    const key = chicagoDateKey(dt);
    if (!eventMap.has(key)) eventMap.set(key, []);
    eventMap.get(key).push(e);
  }

  const monthLabel = new Intl.DateTimeFormat('en-US', {
    timeZone: CHICAGO_TIMEZONE,
    month: 'long',
    year: 'numeric'
  }).format(first);

  const weeks = [];
  for (let w = 0; w < 6; w += 1) {
    const row = [];
    for (let d = 0; d < 7; d += 1) {
      const cell = new Date(gridStart);
      cell.setUTCDate(gridStart.getUTCDate() + (w * 7) + d);
      const p = chicagoDateParts(cell);
      const key = chicagoDateKey(cell);
      const inMonth = p.year === year && p.month === month;
      row.push({
        key,
        day: p.day,
        inMonth,
        isToday: key === chicagoDateKey(referenceDate),
        events: (eventMap.get(key) || []).sort((a, b) => {
          const ta = parseEventDate(a.start_datetime)?.getTime() || 0;
          const tb = parseEventDate(b.start_datetime)?.getTime() || 0;
          return ta - tb;
        })
      });
    }
    weeks.push(row);
  }

  return {
    monthLabel,
    monthParam: monthParamResolved,
    prevMonthParam: shiftMonthParam(monthParamResolved, -1),
    nextMonthParam: shiftMonthParam(monthParamResolved, 1),
    weeks
  };
}

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

function formatChicagoDateTime(raw, includeYearIfPast = false) {
  const d = parseEventDate(raw);
  if (!d) return '';

  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: CHICAGO_TIMEZONE,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  }).formatToParts(d);

  const val = (type) => parts.find((p) => p.type === type)?.value || '';
  const weekday = val('weekday');
  const month = val('month');
  const day = val('day');
  const year = val('year');
  const hour = val('hour');
  const minute = val('minute');
  const period = (val('dayPeriod') || '').toLowerCase();

  const nowYear = new Intl.DateTimeFormat('en-US', {
    timeZone: CHICAGO_TIMEZONE,
    year: 'numeric'
  }).format(new Date());
  const yearSuffix = includeYearIfPast && year && year < nowYear ? ` ${year}` : '';

  return `${weekday}, ${month} ${day}${yearSuffix} ${hour}:${minute}${period}`;
}

app.get('/api/events', async (req, res) => {
  const source = getSource(req);
  const tableName = getTableName(source);
  const { data, error } = await supabase
    .from(tableName)
    .select('*');

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

app.get('/', async (req, res) => {
  const requestedSource = getSource(req);
  const view = getView(req);
  const source = view === 'calendar' ? 'real' : requestedSource;
  const monthParam = String(req.query.month || '');
  const tableName = getTableName(source);
  const { data: events, error } = await supabase
    .from(tableName)
    .select('*')
    .order('start_datetime', { ascending: true });

  if (error) return res.status(500).send('Error loading events');

  const todayKey = chicagoDateKey(new Date());
  const allDeduped = events.filter((e) => !!parseEventDate(e.start_datetime)).filter((e, idx, arr) => {
    const key = `${e.title}|${e.start_datetime}`;
    return arr.findIndex((x) => `${x.title}|${x.start_datetime}` === key) === idx;
  });
  const upcoming = events.filter(e => {
    if (!e.start_datetime) return false;
    const eventDate = parseEventDate(e.start_datetime);
    if (!eventDate) return false;
    return chicagoDateKey(eventDate) >= todayKey;
  });

  const seen = new Set();
  const deduped = upcoming.filter(e => {
    const key = `${e.title}|${e.start_datetime}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const tagFilter = req.query.tag || req.query.category || '';
  const modeFilter = req.query.mode || '';
  const filtered = deduped.filter(e => {
    if (tagFilter) {
      const tags = getEventTags(e);
      if (!tags.includes(tagFilter)) return false;
    }
    if (modeFilter === 'online' && e.Online !== 'TRUE') return false;
    if (modeFilter === 'irl' && e.Online === 'TRUE') return false;
    return true;
  });

  const tags = [...new Set(deduped.flatMap(getEventTags))].sort();
  const emailDraft = buildEmailDraft(allDeduped);
  const emailDraftHtml = buildEmailDraftHtml(allDeduped);
  const calendar = buildCalendarModel(allDeduped, monthParam);

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>CHIIRL | Chicago In Real Life</title>
  <style>
    body { font-family: arial, helvetica, sans-serif; font-size: 14px; background: #f0f0e8; color: #222; margin: 0; padding: 10px; }
    a { color: #00c; }
    a:visited { color: #551a8b; }
    h1 { font-size: 18px; background: #800080; color: #fff; padding: 4px 8px; margin-bottom: 8px; }
    ul { list-style: none; padding: 0; max-width: 800px; }
    li { padding: 4px 0; border-bottom: 1px solid #ccc; display: flex; align-items: center; gap: 8px; }
    li img { width: 50px; height: 50px; object-fit: cover; border-radius: 4px; flex-shrink: 0; }
    .date { color: #666; font-size: 12px; }
    .loc { color: #888; font-size: 12px; }
    .tag { font-size: 11px; color: #555; }
    .tabs { margin-bottom: 10px; max-width: 800px; }
    .tabs a { display: inline-block; padding: 4px 10px; margin-right: 4px; font-size: 12px; text-decoration: none; border: 1px solid #999; color: #222; background: #e8e8e0; }
    .tabs a.active { background: #800080; color: #fff; border-color: #800080; }
    .tabs a:visited { color: #222; }
    .tabs a.active:visited { color: #fff; }
    .filters { margin-bottom: 10px; max-width: 800px; }
    .filters a { display: inline-block; padding: 2px 8px; margin: 2px; font-size: 12px; text-decoration: none; border: 1px solid #999; color: #222; background: #e8e8e0; }
    .filters a.active { background: #800080; color: #fff; border-color: #800080; }
    .filters a:visited { color: #222; }
    .filters a.active:visited { color: #fff; }
    pre.email-draft { max-width: 900px; white-space: pre-wrap; background: #fff; border: 1px solid #bbb; padding: 10px; font-family: "Courier New", monospace; line-height: 1.4; }
    .subtools { margin-bottom: 10px; max-width: 900px; font-size: 12px; }
    .copy-btn { font-size: 12px; padding: 2px 8px; }
    .calendar-wrap { max-width: 1000px; }
    .calendar-head { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
    .calendar-head .month { font-weight: bold; min-width: 180px; }
    .calendar-head a { text-decoration: none; border: 1px solid #999; background: #e8e8e0; color: #222; padding: 2px 8px; font-size: 12px; }
    table.calendar { width: 100%; border-collapse: collapse; table-layout: fixed; background: #fff; }
    table.calendar th, table.calendar td { border: 1px solid #bbb; vertical-align: top; padding: 6px; }
    table.calendar th { background: #ddd; font-size: 12px; }
    table.calendar td { height: 120px; font-size: 12px; }
    .day-num { font-weight: bold; margin-bottom: 4px; }
    .day-muted { color: #999; background: #fafafa; }
    .day-today { outline: 2px solid #800080; outline-offset: -2px; }
    .cal-event { margin: 2px 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .cal-event a { text-decoration: underline; }
    .cal-time { color: #666; margin-right: 4px; }
  </style>
</head>
<body>
  <h1>CHIIRL | Chicago In Real Life</h1>
  <div class="tabs">
    <a href="${buildUrl('/', 'real', { tag: tagFilter, mode: modeFilter, view, month: view === 'calendar' ? calendar.monthParam : '' })}"${source === 'real' ? ' class="active"' : ''}>Real Data</a>
    <a href="${buildUrl('/', 'inaccurate', { tag: tagFilter, mode: modeFilter, view, month: view === 'calendar' ? calendar.monthParam : '' })}"${source === 'inaccurate' ? ' class="active"' : ''}>Inaccurate Data</a>
    <a href="${buildUrl('/', source, { view: 'email' })}"${view === 'email' ? ' class="active"' : ''}>Email Draft</a>
    <a href="${buildUrl('/', source, { view: 'calendar', month: calendar.monthParam })}"${view === 'calendar' ? ' class="active"' : ''}>Calendar</a>
  </div>
  <p><a href="${buildUrl('/archive', source)}">archive</a> | <a href="${buildUrl('/raw', source)}">raw table</a></p>
  ${view === 'events' ? `<div class="filters">
    <a href="${buildUrl('/', source)}"${!tagFilter && !modeFilter ? ' class="active"' : ''}>All</a>
    <a href="${buildUrl('/', source, { mode: 'irl', tag: tagFilter })}"${modeFilter === 'irl' ? ' class="active"' : ''}>IRL</a>
    <a href="${buildUrl('/', source, { mode: 'online', tag: tagFilter })}"${modeFilter === 'online' ? ' class="active"' : ''}>Online</a>
    |
    ${tags.map(t => `<a href="${buildUrl('/', source, { tag: t, mode: modeFilter })}"${tagFilter === t ? ' class="active"' : ''}>${t}</a>`).join('')}
  </div>` : view === 'email' ? `<div class="subtools"><a href="${buildUrl('/email.txt', source)}">plain text route</a> <button class="copy-btn" onclick="navigator.clipboard.writeText(document.getElementById('email-draft').innerText)">copy</button></div>` : ''}
  ${view === 'events' ? `<ul>
    ${filtered.map(e => `
      <li>
        ${e.image_url ? `<img src="${e.image_url}" alt="">` : ''}
        <div><a href="${e.eventUrl || '#'}">${e.title}</a>
        <span class="tag">(${e.Online === 'TRUE' ? 'Online' : 'IRL'})</span><br>
        <span class="date">${formatChicagoDateTime(e.start_datetime)}</span>
        <span class="loc">${e.location || ''}</span>
        ${e.google_maps_url && e.Online !== 'TRUE' ? ` - <a href="${e.google_maps_url}">map</a>` : ''}
        - <a href="${buildUrl('/event', source, { title: e.title, date: e.start_datetime || '' })}">raw</a>
        </div>
      </li>
    `).join('')}
  </ul>` : view === 'email' ? `<pre id="email-draft" class="email-draft">${emailDraftHtml}</pre>` : `
  <div class="calendar-wrap">
    <div class="calendar-head">
      <a href="${buildUrl('/', source, { view: 'calendar', month: calendar.prevMonthParam })}">&larr; Prev</a>
      <span class="month">${escapeHtml(calendar.monthLabel)}</span>
      <a href="${buildUrl('/', source, { view: 'calendar', month: calendar.nextMonthParam })}">Next &rarr;</a>
    </div>
    <table class="calendar">
      <thead>
        <tr>
          <th>Sun</th><th>Mon</th><th>Tue</th><th>Wed</th><th>Thu</th><th>Fri</th><th>Sat</th>
        </tr>
      </thead>
      <tbody>
        ${calendar.weeks.map((week) => `
          <tr>
            ${week.map((cell) => `
              <td class="${cell.inMonth ? '' : 'day-muted'} ${cell.isToday ? 'day-today' : ''}">
                <div class="day-num">${cell.day}</div>
                ${cell.events.map((e) => `
                  <div class="cal-event">
                    <span class="cal-time">${escapeHtml(formatChiirlTimeShort(e.start_datetime))}</span>
                    <a href="${escapeHtml(e.eventUrl || '#')}" target="_blank" rel="noopener noreferrer">${escapeHtml(e.title || '')}</a>
                  </div>
                `).join('')}
              </td>
            `).join('')}
          </tr>
        `).join('')}
      </tbody>
    </table>
  </div>`}
</body>
</html>`;

  res.send(html);
});

app.get('/email.txt', async (req, res) => {
  const source = getSource(req);
  const tableName = getTableName(source);
  const { data: events, error } = await supabase
    .from(tableName)
    .select('*')
    .order('start_datetime', { ascending: true });

  if (error) return res.status(500).send('Error loading events');

  const allDeduped = (events || [])
    .filter((e) => !!parseEventDate(e.start_datetime))
    .filter((e, idx, arr) => {
      const key = `${e.title}|${e.start_datetime}`;
      return arr.findIndex((x) => `${x.title}|${x.start_datetime}` === key) === idx;
    });

  res.type('text/plain').send(buildEmailDraft(allDeduped));
});

app.get('/event', async (req, res) => {
  const { title, date } = req.query;
  const source = getSource(req);
  const tableName = getTableName(source);
  if (!title) return res.status(400).send('Missing title');

  let query = supabase.from(tableName).select('*').eq('title', title);
  if (date) query = query.eq('start_datetime', date);
  const { data, error } = await query;

  if (error) return res.status(500).send('Error loading event');
  const event = data && data[0];
  if (!event) return res.status(404).send('Event not found');

  const fields = Object.entries(event).filter(([, v]) => v != null && v !== '');

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${event.title} | CHIIRL</title>
  <style>
    body { font-family: arial, helvetica, sans-serif; font-size: 14px; background: #f0f0e8; color: #222; margin: 0; padding: 10px; }
    a { color: #00c; }
    h1 { font-size: 18px; background: #800080; color: #fff; padding: 4px 8px; margin-bottom: 8px; }
    .tabs { margin-bottom: 10px; max-width: 800px; }
    .tabs a { display: inline-block; padding: 4px 10px; margin-right: 4px; font-size: 12px; text-decoration: none; border: 1px solid #999; color: #222; background: #e8e8e0; }
    .tabs a.active { background: #800080; color: #fff; border-color: #800080; }
    .tabs a:visited { color: #222; }
    .tabs a.active:visited { color: #fff; }
    table { border-collapse: collapse; max-width: 800px; }
    th, td { border: 1px solid #999; padding: 4px 8px; text-align: left; vertical-align: top; }
    th { background: #ddd; width: 150px; }
    td { max-width: 600px; word-wrap: break-word; }
  </style>
</head>
<body>
  <h1>${event.title}</h1>
  <div class="tabs">
    <a href="${buildUrl('/event', 'real', { title, date })}"${source === 'real' ? ' class="active"' : ''}>Real Data</a>
    <a href="${buildUrl('/event', 'inaccurate', { title, date })}"${source === 'inaccurate' ? ' class="active"' : ''}>Inaccurate Data</a>
  </div>
  <p><a href="${buildUrl('/', source)}">back</a></p>
  <table>
    ${fields.map(([k, v]) => `<tr><th>${k}</th><td>${v}</td></tr>`).join('')}
  </table>
</body>
</html>`;

  res.send(html);
});

app.get('/archive', async (req, res) => {
  const source = getSource(req);
  const tableName = getTableName(source);
  const { data: events, error } = await supabase
    .from(tableName)
    .select('*')
    .order('start_datetime', { ascending: false });

  if (error) return res.status(500).send('Error loading events');

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>CHIIRL | Archive</title>
  <style>
    body { font-family: arial, helvetica, sans-serif; font-size: 14px; background: #f0f0e8; color: #222; margin: 0; padding: 10px; }
    a { color: #00c; }
    a:visited { color: #551a8b; }
    h1 { font-size: 18px; background: #800080; color: #fff; padding: 4px 8px; margin-bottom: 8px; }
    ul { list-style: none; padding: 0; max-width: 800px; }
    li { padding: 4px 0; border-bottom: 1px solid #ccc; display: flex; align-items: center; gap: 8px; }
    li img { width: 50px; height: 50px; object-fit: cover; border-radius: 4px; flex-shrink: 0; }
    .date { color: #666; font-size: 12px; }
    .loc { color: #888; font-size: 12px; }
    .tag { font-size: 11px; color: #555; }
    .tabs { margin-bottom: 10px; max-width: 800px; }
    .tabs a { display: inline-block; padding: 4px 10px; margin-right: 4px; font-size: 12px; text-decoration: none; border: 1px solid #999; color: #222; background: #e8e8e0; }
    .tabs a.active { background: #800080; color: #fff; border-color: #800080; }
    .tabs a:visited { color: #222; }
    .tabs a.active:visited { color: #fff; }
  </style>
</head>
<body>
  <h1>CHIIRL | Archive</h1>
  <div class="tabs">
    <a href="${buildUrl('/archive', 'real')}"${source === 'real' ? ' class="active"' : ''}>Real Data</a>
    <a href="${buildUrl('/archive', 'inaccurate')}"${source === 'inaccurate' ? ' class="active"' : ''}>Inaccurate Data</a>
  </div>
  <p><a href="${buildUrl('/', source)}">back to upcoming</a></p>
  <ul>
    ${events.map(e => `
      <li>
        ${e.image_url ? `<img src="${e.image_url}" alt="">` : ''}
        <div><a href="${e.eventUrl || '#'}">${e.title}</a>
        <span class="tag">(${e.Online === 'TRUE' ? 'Online' : 'IRL'})</span><br>
        <span class="date">${formatChicagoDateTime(e.start_datetime, true)}</span>
        <span class="loc">${e.location || ''}</span>
        - <a href="${buildUrl('/event', source, { title: e.title, date: e.start_datetime || '' })}">raw</a>
        </div>
      </li>
    `).join('')}
  </ul>
</body>
</html>`;

  res.send(html);
});

app.get('/raw', async (req, res) => {
  const source = getSource(req);
  const tableName = getTableName(source);
  const { data: events, error } = await supabase
    .from(tableName)
    .select('*')
    .order('start_datetime', { ascending: true });

  if (error) return res.status(500).send('Error loading events');

  const cols = Object.keys(events[0] || {});

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>CHIIRL | Raw Data</title>
  <style>
    body { font-family: arial, helvetica, sans-serif; font-size: 12px; background: #f0f0e8; color: #222; margin: 0; padding: 10px; }
    a { color: #00c; }
    h1 { font-size: 18px; background: #800080; color: #fff; padding: 4px 8px; margin-bottom: 8px; }
    .tabs { margin-bottom: 10px; max-width: 100%; }
    .tabs a { display: inline-block; padding: 4px 10px; margin-right: 4px; font-size: 12px; text-decoration: none; border: 1px solid #999; color: #222; background: #e8e8e0; }
    .tabs a.active { background: #800080; color: #fff; border-color: #800080; }
    .tabs a:visited { color: #222; }
    .tabs a.active:visited { color: #fff; }
    table { border-collapse: collapse; width: 100%; }
    th, td { border: 1px solid #999; padding: 3px 6px; text-align: left; max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    th { background: #ddd; position: sticky; top: 0; }
    tr:nth-child(even) { background: #e8e8e0; }
  </style>
</head>
<body>
  <h1>CHIIRL | Raw Data</h1>
  <div class="tabs">
    <a href="${buildUrl('/raw', 'real')}"${source === 'real' ? ' class="active"' : ''}>Real Data</a>
    <a href="${buildUrl('/raw', 'inaccurate')}"${source === 'inaccurate' ? ' class="active"' : ''}>Inaccurate Data</a>
  </div>
  <p><a href="${buildUrl('/', source)}">back</a></p>
  <table>
    <tr>${cols.map(c => `<th>${c}</th>`).join('')}</tr>
    ${events.map(e => `<tr>${cols.map(c => `<td>${e[c] != null ? e[c] : ''}</td>`).join('')}</tr>`).join('')}
  </table>
</body>
</html>`;

  res.send(html);
});

app.listen(3000, () => console.log('Server running on http://localhost:3000'));
