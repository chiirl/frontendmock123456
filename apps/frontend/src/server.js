const path = require('path');
const express = require('express');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: path.resolve(__dirname, '../../../.env') });

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
const supabaseReadKey =
  process.env.SUPABASE_PUBLISHABLE_KEY ||
  process.env.SUPABASE_ANON_KEY ||
  process.env.SUPABASE_KEY;
if (!process.env.SUPABASE_URL || !supabaseReadKey) {
  throw new Error('Missing SUPABASE_URL or SUPABASE_PUBLISHABLE_KEY');
}
const supabase = createClient(process.env.SUPABASE_URL, supabaseReadKey);
const EVENTS_TABLE_NAME = process.env.SUPABASE_TABLE || 'beta_chiirl_events';
const CHICAGO_TIMEZONE = 'America/Chicago';

function getView(req) {
  if (req.path === '/email') return 'email';
  if (req.path.startsWith('/calendar')) return 'calendar';
  return 'events';
}

function buildUrl(path, params = {}) {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (Array.isArray(v)) {
      const joined = v.map((item) => String(item || '').trim()).filter(Boolean).join(',');
      if (joined) query.set(k, joined);
      return;
    }
    if (v != null && v !== '') query.set(k, v);
  });
  const qs = query.toString();
  return qs ? `${path}?${qs}` : path;
}

function renderLogoStyles() {
  return 'img.site-logo { display: block; width: min(100%, 540px); height: auto; margin: 0 0 12px; }';
}

function renderThemeStyles() {
  return `
    a { color: #1d6f93; }
    a:visited { color: #1d6f93; }
    h1 { font-size: 18px; background: #41b6e6; color: #fff; padding: 4px 8px; margin-bottom: 8px; }
    button { padding: 8px 10px; background: #41b6e6; color: #fff; border: 1px solid #1d6f93; }
    .tabs a { display: inline-block; padding: 4px 10px; margin-right: 4px; font-size: 12px; text-decoration: none; border: 1px solid #1d6f93; color: #fff; background: #41b6e6; }
    .tabs a.active { background: #1d6f93; color: #fff; border-color: #1d6f93; }
    .tabs a:visited { color: #fff; }
    .tabs a.active:visited { color: #fff; }
    .filters { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 8px; align-items: end; background: #fff; border: 1px solid #bbb; padding: 10px; }
    .filters label { display: block; font-size: 12px; font-weight: bold; margin-bottom: 4px; }
    .filters select { width: 100%; box-sizing: border-box; padding: 6px; border: 1px solid #999; background: #fff; }
    .filters .filter-actions { display: flex; gap: 8px; align-items: center; }
    .filters .clear-link { font-size: 12px; }
    .calendar-head a { text-decoration: none; border: 1px solid #1d6f93; background: #41b6e6; color: #fff; padding: 2px 8px; font-size: 12px; }
    .day-today { outline: 2px solid #41b6e6; outline-offset: -2px; }
  `;
}

function getArrayValues(value) {
  const clean = (x) => String(x || '').trim();
  const uniq = (arr) => [...new Set(arr.map(clean).filter(Boolean))];
  if (Array.isArray(value)) return uniq(value);
  if (typeof value === 'string' && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return uniq(parsed);
    } catch {
      // fall through to delimiter parsing
    }
    return uniq(value.split(/[|,]/));
  }
  return [];
}

function getEventTags(event) {
  if (!event) return [];
  if (Array.isArray(event.tags) || (typeof event.tags === 'string' && event.tags.trim())) {
    return getArrayValues(event.tags);
  }

  if (typeof event.tech_category === 'string' && event.tech_category.trim()) {
    return getArrayValues(event.tech_category);
  }

  return [];
}

function getEventTaxonomyValues(event, key) {
  return getArrayValues(event?.[key]);
}

function parseFilterList(value) {
  if (Array.isArray(value)) return [...new Set(value.flatMap(parseFilterList))];
  return [...new Set(String(value || '').split(',').map((item) => item.trim()).filter(Boolean))];
}

function serializeFilterList(values) {
  return parseFilterList(values).join(',');
}

function buildTaxonomyOptions(events, key) {
  return [...new Set(events.flatMap((event) => getEventTaxonomyValues(event, key)))].sort();
}

function buildFilterOptions(events, key) {
  const options = buildTaxonomyOptions(events, key);
  if (key === 'audience') {
    return options.filter((value) => normalizeFilterValue(value) !== 'all');
  }
  return options;
}

function renderTaxonomyList(event) {
  const fields = [
    ['Audience', getEventTaxonomyValues(event, 'audience')],
    ['Industry', getEventTaxonomyValues(event, 'industry')],
    ['Topic', getEventTaxonomyValues(event, 'topic')],
    ['Activity', getEventTaxonomyValues(event, 'activity')]
  ].filter(([, values]) => values.length > 0);

  if (fields.length === 0) return '';
  return fields
    .map(([label, values]) => `<span class="tag"><strong>${label}:</strong> ${escapeHtml(values.join(', '))}</span>`)
    .join('<br>');
}

function normalizeFilterValue(value) {
  return String(value || '').trim().toLowerCase();
}

function encodeFilterValues(values) {
  return getArrayValues(values)
    .map(normalizeFilterValue)
    .join('|');
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

function renderModernEventsHtml(deduped, currentFilters, audienceOptions, industryOptions, topicOptions, activityOptions, toggleUrl) {
  const byDay = new Map();
  for (const e of deduped) {
    const dt = parseEventDate(e.start_datetime);
    if (!dt) continue;
    const key = chicagoDateKey(dt);
    if (!byDay.has(key)) {
      const label = new Intl.DateTimeFormat('en-US', {
        timeZone: CHICAGO_TIMEZONE,
        weekday: 'long',
        month: 'long',
        day: 'numeric'
      }).format(dt);
      const badge = new Intl.DateTimeFormat('en-US', {
        timeZone: CHICAGO_TIMEZONE,
        month: 'short',
        day: 'numeric'
      }).format(dt).toUpperCase();
      byDay.set(key, { label, badge, events: [] });
    }
    byDay.get(key).events.push(e);
  }

  const filterGroups = [
    { key: 'audience', label: 'Audience', options: audienceOptions },
    { key: 'industry', label: 'Industry', options: industryOptions },
    { key: 'topic', label: 'Topic', options: topicOptions },
    { key: 'activity', label: 'Activity', options: activityOptions },
    { key: 'mode', label: 'Mode', options: ['irl', 'online'] }
  ];

  const dayHtml = [...byDay.values()].map((day) => {
    const cards = day.events.map((e) => {
      const mode = e.Online === 'TRUE' ? 'online' : 'irl';
      const time = escapeHtml(formatChiirlTimeShort(e.start_datetime));
      const title = escapeHtml(e.title || '');
      const href = escapeHtml(e.eventUrl || '#');
      const loc = escapeHtml(e.location ? e.location.split(',')[0].trim() : '');
      const img = e.image_url ? escapeHtml(e.image_url) : '';
      const badge = escapeHtml(day.badge);
      return `
      <a class="card" href="${href}" target="_blank" rel="noopener noreferrer"
        data-audience="${escapeHtml(encodeFilterValues(e.audience))}"
        data-industry="${escapeHtml(encodeFilterValues(e.industry))}"
        data-topic="${escapeHtml(encodeFilterValues(e.topic))}"
        data-activity="${escapeHtml(encodeFilterValues(e.activity))}"
        data-mode="${mode}"
      >
        <div class="card-img-wrap">
          ${img ? `<img src="${img}" alt="" loading="lazy">` : '<div class="card-img-placeholder"></div>'}
          <div class="card-date-badge">${badge}</div>
          <span class="pill ${mode === 'online' ? 'pill-online' : 'pill-irl'}">${mode === 'online' ? 'Online' : 'IRL'}</span>
        </div>
        <div class="card-body">
          ${time ? `<div class="card-time">${time}</div>` : ''}
          <h3 class="card-title">${title}</h3>
          ${loc ? `<p class="card-loc">${loc}</p>` : ''}
        </div>
      </a>`;
    }).join('');
    return `
    <section class="day-section">
      <h2 class="day-heading">${escapeHtml(day.label)}</h2>
      <div class="card-grid">${cards}</div>
    </section>`;
  }).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Chicago In Real Life | The Top Tech &amp; Startup Events</title>
  <script>!function(){var s=localStorage.getItem('chiirl-theme'),d=window.matchMedia('(prefers-color-scheme:dark)').matches;document.documentElement.className='theme-'+(s||(d?'dark':'light'));}();</script>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
  <style>
    html.theme-dark {
      --bg: #0d0d14; --text: #e8e8f0; --hdr-bg: rgba(13,13,20,0.9); --hdr-border: rgba(255,255,255,0.07);
      --wordmark: #fff; --hero-sub: #666; --muted: #444; --surface: #181825;
      --border: rgba(255,255,255,0.1); --border-faint: rgba(255,255,255,0.06); --border-day: rgba(255,255,255,0.05);
      --btn-bg: rgba(255,255,255,0.05); --btn-border: rgba(255,255,255,0.1); --btn-text: #bbb;
      --btn-hover-bg: rgba(255,255,255,0.09); --btn-hover-border: rgba(255,255,255,0.2); --btn-hover-text: #fff;
      --clear: #444; --clear-hover: #aaa; --dd-shadow: 0 20px 60px rgba(0,0,0,0.7);
      --item-text: #ccc; --item-hover-bg: rgba(255,255,255,0.05); --item-hover-text: #fff; --cnt: #444;
      --day-text: #444; --card: #12121e; --card-img: #1a1a2e;
      --card-shadow: 0 16px 40px rgba(0,0,0,0.55); --badge-bg: rgba(13,13,20,0.82); --badge-text: #fff;
      --card-title: #e0e0ee; --card-loc: #555; --empty: #333;
      --toggle-border: rgba(255,255,255,0.15); --toggle-text: #888;
      --accent: #00d4ff; --accent-text: #00d4ff;
      --placeholder: linear-gradient(135deg,#1a1a2e 0%,#16213e 60%,#0f3460 100%);
    }
    html.theme-light {
      --bg: #f5f5f9; --text: #1a1a2e; --hdr-bg: rgba(245,245,249,0.95); --hdr-border: rgba(0,0,0,0.08);
      --wordmark: #1a1a2e; --hero-sub: #777; --muted: #999; --surface: #fff;
      --border: rgba(0,0,0,0.1); --border-faint: rgba(0,0,0,0.08); --border-day: rgba(0,0,0,0.08);
      --btn-bg: rgba(0,0,0,0.04); --btn-border: rgba(0,0,0,0.1); --btn-text: #555;
      --btn-hover-bg: rgba(0,0,0,0.08); --btn-hover-border: rgba(0,0,0,0.18); --btn-hover-text: #1a1a2e;
      --clear: #aaa; --clear-hover: #333; --dd-shadow: 0 8px 32px rgba(0,0,0,0.15);
      --item-text: #444; --item-hover-bg: rgba(0,0,0,0.04); --item-hover-text: #1a1a2e; --cnt: #aaa;
      --day-text: #aaa; --card: #fff; --card-img: #eaeaf4;
      --card-shadow: 0 8px 24px rgba(0,0,0,0.1); --badge-bg: rgba(255,255,255,0.9); --badge-text: #1a1a2e;
      --card-title: #1a1a2e; --card-loc: #999; --empty: #aaa;
      --toggle-border: rgba(0,0,0,0.15); --toggle-text: #666;
      --accent: #00d4ff; --accent-text: #007899;
      --placeholder: linear-gradient(135deg,#e8e8f4 0%,#dde0ee 60%,#d0d8ec 100%);
    }
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'Inter', system-ui, sans-serif; background: var(--bg); color: var(--text); min-height: 100vh; }
    a { color: inherit; text-decoration: none; }

    .site-header {
      display: flex; align-items: center; justify-content: space-between;
      padding: 18px 28px;
      border-bottom: 1px solid var(--hdr-border);
      position: sticky; top: 0;
      background: var(--hdr-bg);
      backdrop-filter: blur(14px);
      z-index: 100;
    }
    .wordmark { font-size: 20px; font-weight: 800; letter-spacing: -0.5px; color: var(--wordmark); }
    .wordmark span { color: var(--accent); }
    .header-right { display: flex; align-items: center; gap: 8px; }
    .view-toggle {
      font-size: 13px; font-weight: 500;
      padding: 7px 16px;
      border: 1px solid var(--toggle-border);
      border-radius: 20px; color: var(--toggle-text);
      transition: border-color 0.2s, color 0.2s;
    }
    .view-toggle:hover { border-color: var(--accent); color: var(--accent); }
    .theme-toggle {
      appearance: none; background: transparent; font: inherit; cursor: pointer;
      font-size: 16px; border: 1px solid var(--toggle-border); border-radius: 20px;
      color: var(--toggle-text); padding: 5px 12px; transition: border-color 0.2s, color 0.2s; line-height: 1;
    }
    .theme-toggle:hover { border-color: var(--accent); color: var(--accent); }

    .hero-strip { padding: 36px 28px 20px; max-width: 1100px; margin: 0 auto; }
    .hero-strip h1 { font-size: clamp(28px, 5vw, 44px); font-weight: 800; line-height: 1.1; letter-spacing: -1.5px; }
    .hero-strip h1 em { font-style: normal; color: var(--accent); }
    .hero-strip p { margin-top: 8px; font-size: 15px; color: var(--hero-sub); }
    .results-count-modern { font-size: 13px; color: var(--muted); margin-top: 6px; }

    .filter-bar {
      padding: 0 28px 14px; max-width: 1100px; margin: 0 auto;
      display: flex; flex-wrap: wrap; gap: 6px; align-items: center;
    }
    .filter-dropdown-wrap { position: relative; }
    .filter-group-btn {
      appearance: none;
      background: var(--btn-bg);
      border: 1px solid var(--btn-border);
      color: var(--btn-text); font: inherit; font-size: 13px; font-weight: 500;
      padding: 7px 16px; border-radius: 20px; cursor: pointer;
      transition: background 0.15s, border-color 0.15s, color 0.15s;
    }
    .filter-group-btn:hover { background: var(--btn-hover-bg); border-color: var(--btn-hover-border); color: var(--btn-hover-text); }
    .filter-group-btn.active { background: var(--accent); border-color: var(--accent); color: #000; }
    .clear-modern-btn {
      appearance: none; background: transparent; border: none;
      color: var(--clear); font: inherit; font-size: 13px; cursor: pointer; padding: 7px 10px;
      transition: color 0.15s;
    }
    .clear-modern-btn:hover { color: var(--clear-hover); }

    .filter-dropdown {
      display: none; position: absolute; top: calc(100% + 8px); left: 0;
      min-width: 210px; background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 12px;
      box-shadow: var(--dd-shadow);
      padding: 8px; z-index: 50;
      max-height: 55vh; overflow-y: auto;
    }
    .filter-dropdown.open { display: block; }
    .filter-dropdown-item {
      display: flex; align-items: center; gap: 10px;
      padding: 8px 10px; border-radius: 8px; cursor: pointer;
      font-size: 13px; transition: background 0.1s; color: var(--item-text);
    }
    .filter-dropdown-item:hover { background: var(--item-hover-bg); color: var(--item-hover-text); }
    .filter-dropdown-item input { accent-color: var(--accent); width: 15px; height: 15px; flex-shrink: 0; cursor: pointer; }
    .opt-count { margin-left: auto; color: var(--cnt); font-size: 12px; }

    .active-chips-modern {
      padding: 0 28px 12px; max-width: 1100px; margin: 0 auto;
      display: flex; flex-wrap: wrap; gap: 6px;
    }
    .chip-modern {
      appearance: none;
      background: rgba(0,212,255,0.1);
      border: 1px solid rgba(0,212,255,0.25);
      color: var(--accent); font: inherit; font-size: 12px; font-weight: 500;
      padding: 4px 12px; border-radius: 20px; cursor: pointer;
      transition: background 0.15s;
    }
    .chip-modern:hover { background: rgba(0,212,255,0.18); }

    .events-container { max-width: 1100px; margin: 0 auto; padding: 0 28px 60px; }
    .day-section { margin-bottom: 44px; }
    .day-section.hidden { display: none; }
    .day-heading {
      font-size: 11px; font-weight: 700; text-transform: uppercase;
      letter-spacing: 2px; color: var(--day-text);
      padding-bottom: 12px;
      border-bottom: 1px solid var(--border-day);
      margin-bottom: 16px;
    }

    .card-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; }
    @media (max-width: 900px) { .card-grid { grid-template-columns: repeat(2, 1fr); } }
    @media (max-width: 560px) {
      .card-grid { grid-template-columns: 1fr; }
      .hero-strip, .filter-bar, .active-chips-modern, .events-container { padding-left: 16px; padding-right: 16px; }
      .site-header { padding: 14px 16px; }
    }

    .card {
      background: var(--card);
      border: 1px solid var(--border-faint);
      border-radius: 14px; overflow: hidden;
      display: flex; flex-direction: column;
      transition: transform 0.2s, box-shadow 0.2s, border-color 0.2s;
    }
    .card:hover {
      transform: translateY(-4px);
      box-shadow: var(--card-shadow);
      border-color: rgba(0,212,255,0.22);
    }
    .card.hidden { display: none; }
    .card-img-wrap {
      position: relative; width: 100%; aspect-ratio: 16/9;
      background: var(--card-img); flex-shrink: 0;
    }
    .card-img-wrap img { width: 100%; height: 100%; object-fit: cover; display: block; }
    .card-img-placeholder { width: 100%; height: 100%; background: var(--placeholder); }
    .card-date-badge {
      position: absolute; top: 10px; left: 10px;
      background: var(--badge-bg);
      backdrop-filter: blur(6px);
      color: var(--badge-text); font-size: 11px; font-weight: 700;
      letter-spacing: 0.5px; padding: 4px 8px; border-radius: 6px;
    }
    .pill {
      position: absolute; bottom: 10px; right: 10px;
      font-size: 11px; font-weight: 600;
      padding: 3px 9px; border-radius: 20px;
    }
    .pill-irl { background: rgba(0,212,255,0.15); color: var(--accent); border: 1px solid rgba(0,212,255,0.3); }
    .pill-online { background: rgba(167,139,250,0.15); color: #a78bfa; border: 1px solid rgba(167,139,250,0.3); }
    .card-body { padding: 14px 16px 18px; display: flex; flex-direction: column; gap: 5px; flex: 1; }
    .card-time { font-size: 12px; color: var(--accent-text); font-weight: 600; letter-spacing: 0.3px; }
    .card-title { font-size: 14px; font-weight: 600; line-height: 1.38; color: var(--card-title); }
    .card-loc { font-size: 12px; color: var(--card-loc); margin-top: auto; padding-top: 4px; }
    .empty-state { text-align: center; padding: 80px 24px; color: var(--empty); font-size: 15px; }
  </style>
</head>
<body>
  <header class="site-header">
    <div class="wordmark">CHI<svg xmlns="http://www.w3.org/2000/svg" viewBox="98 180 104 120" height="0.85em" style="display:inline;vertical-align:middle;position:relative;top:-2px;"><path d="M150,180l11,41l41,-11l-30,30l30,30l-41,-11l-11,41l-11,-41l-41,11l30,-30l-30,-30l41,11z" fill="#E4002B"/></svg><span>IRL</span></div>
    <div class="header-right">
      <button class="theme-toggle" id="theme-toggle" type="button" title="Toggle color theme">☀</button>
      <a href="${escapeHtml(toggleUrl)}" class="view-toggle">Classic View</a>
    </div>
  </header>

  <div class="hero-strip">
    <h1>Chicago Tech &amp;<br><em>Startup Events</em></h1>
    <p>The best IRL and online events happening in Chicago.</p>
    <div class="results-count-modern" id="results-count-modern"></div>
  </div>

  <div class="filter-bar" id="filter-bar-modern">
    ${filterGroups.map((group) => `
    <div class="filter-dropdown-wrap">
      <button class="filter-group-btn" type="button" data-modern-filter-btn="${group.key}">${escapeHtml(group.label)} ▾</button>
      <div class="filter-dropdown" data-modern-filter-panel="${group.key}">
        ${group.options.map((value) => {
    const display = value === 'irl' ? 'IRL' : value === 'online' ? 'Online' : value;
    const active = currentFilters[group.key] && currentFilters[group.key].split(',').map((s) => s.trim()).includes(value);
    return `<label class="filter-dropdown-item">
            <input type="checkbox" data-modern-filter-key="${group.key}" value="${escapeHtml(value)}"${active ? ' checked' : ''}>
            <span>${escapeHtml(display)}</span>
            <span class="opt-count"></span>
          </label>`;
  }).join('')}
      </div>
    </div>`).join('')}
    <button class="clear-modern-btn" type="button" id="clear-modern-filters">Clear all</button>
  </div>

  <div class="active-chips-modern" id="active-chips-modern"></div>

  <div class="events-container" id="events-container">
    ${dayHtml || '<div class="empty-state">No upcoming events found.</div>'}
  </div>

  <script>
    (function () {
      var filterBar = document.getElementById('filter-bar-modern');
      var container = document.getElementById('events-container');
      var chipsWrap = document.getElementById('active-chips-modern');
      var resultsCount = document.getElementById('results-count-modern');
      if (!filterBar || !container) return;

      var keys = ['audience', 'industry', 'topic', 'activity', 'mode'];
      var labels = { audience: 'Audience', industry: 'Industry', topic: 'Topic', activity: 'Activity', mode: 'Mode' };
      var cards = Array.prototype.slice.call(container.querySelectorAll('.card'));
      var daySections = Array.prototype.slice.call(container.querySelectorAll('.day-section'));

      function getChecked(key) {
        return Array.prototype.slice.call(filterBar.querySelectorAll('input[data-modern-filter-key="' + key + '"]:checked')).map(function (i) { return i.value.trim().toLowerCase(); });
      }
      function currentValues() {
        var v = {}; keys.forEach(function (k) { v[k] = getChecked(k); }); return v;
      }
      function matches(rowVal, selected) {
        if (!selected.length) return true;
        var vals = String(rowVal || '').split('|').filter(Boolean);
        return selected.some(function (s) { return vals.includes(s); });
      }
      function cardVisible(card, values) {
        return keys.every(function (k) { return matches(card.dataset[k], values[k]); });
      }

      function applyFilters() {
        var values = currentValues();
        var visible = 0;
        cards.forEach(function (card) {
          var show = cardVisible(card, values);
          card.classList.toggle('hidden', !show);
          if (show) visible += 1;
        });
        daySections.forEach(function (section) {
          var hasVisible = Array.prototype.some.call(section.querySelectorAll('.card'), function (c) { return !c.classList.contains('hidden'); });
          section.classList.toggle('hidden', !hasVisible);
        });
        resultsCount.textContent = visible + ' event' + (visible === 1 ? '' : 's');
        updateChips(values);
        updateButtons(values);
        syncUrl(values);
      }

      function updateButtons(values) {
        keys.forEach(function (key) {
          var btn = filterBar.querySelector('[data-modern-filter-btn="' + key + '"]');
          if (!btn) return;
          var active = values[key].length > 0;
          btn.classList.toggle('active', active);
          if (active) {
            var first = values[key][0] === 'irl' ? 'IRL' : values[key][0] === 'online' ? 'Online' : values[key][0];
            btn.textContent = labels[key] + ': ' + first + (values[key].length > 1 ? ' +' + (values[key].length - 1) : '') + ' \u25be';
          } else {
            btn.textContent = labels[key] + ' \u25be';
          }
        });
      }

      function updateChips(values) {
        var items = [];
        keys.forEach(function (key) { values[key].forEach(function (val) { items.push({ key: key, value: val }); }); });
        chipsWrap.innerHTML = items.map(function (item) {
          var label = item.value === 'irl' ? 'IRL' : item.value === 'online' ? 'Online' : item.value;
          return '<button class="chip-modern" type="button" data-chip-key="' + item.key + '" data-chip-value="' + item.value + '">' + labels[item.key] + ': ' + label + ' \u00d7</button>';
        }).join('');
      }

      function syncUrl(values) {
        var params = new URLSearchParams();
        params.set('view', 'modern');
        keys.forEach(function (key) { if (values[key].length) params.set(key, values[key].join(',')); });
        window.history.replaceState({}, '', '/?' + params.toString());
      }

      keys.forEach(function (key) {
        var btn = filterBar.querySelector('[data-modern-filter-btn="' + key + '"]');
        var panel = filterBar.querySelector('[data-modern-filter-panel="' + key + '"]');
        if (btn && panel) {
          btn.addEventListener('click', function (e) {
            e.stopPropagation();
            var isOpen = panel.classList.contains('open');
            Array.prototype.forEach.call(filterBar.querySelectorAll('.filter-dropdown'), function (p) { p.classList.remove('open'); });
            if (!isOpen) panel.classList.add('open');
          });
        }
        Array.prototype.forEach.call(filterBar.querySelectorAll('input[data-modern-filter-key="' + key + '"]'), function (input) {
          input.addEventListener('change', applyFilters);
        });
      });

      document.addEventListener('click', function (e) {
        if (!filterBar.contains(e.target)) {
          Array.prototype.forEach.call(filterBar.querySelectorAll('.filter-dropdown'), function (p) { p.classList.remove('open'); });
        }
      });

      document.getElementById('clear-modern-filters').addEventListener('click', function () {
        Array.prototype.forEach.call(filterBar.querySelectorAll('input[type="checkbox"]'), function (i) { i.checked = false; });
        Array.prototype.forEach.call(filterBar.querySelectorAll('.filter-dropdown'), function (p) { p.classList.remove('open'); });
        applyFilters();
      });

      chipsWrap.addEventListener('click', function (e) {
        var btn = e.target.closest('.chip-modern');
        if (!btn) return;
        var key = btn.getAttribute('data-chip-key');
        var val = btn.getAttribute('data-chip-value');
        var input = filterBar.querySelector('input[data-modern-filter-key="' + key + '"][value="' + val + '"]');
        if (input) { input.checked = false; applyFilters(); }
      });

      applyFilters();
    })();
    (function() {
      var btn = document.getElementById('theme-toggle');
      function sync() {
        var dark = document.documentElement.classList.contains('theme-dark');
        btn.textContent = dark ? '☀' : '☽';
        btn.title = dark ? 'Switch to light mode' : 'Switch to dark mode';
      }
      sync();
      btn.addEventListener('click', function() {
        var dark = document.documentElement.classList.contains('theme-dark');
        var t = dark ? 'light' : 'dark';
        document.documentElement.className = 'theme-' + t;
        localStorage.setItem('chiirl-theme', t);
        sync();
      });
    })();
  </script>
</body>
</html>`;
}

app.get('/logo.png', (req, res) => {
  res.sendFile(path.resolve(__dirname, '../../../Logo_on_light_bg.png'));
});

app.get('/api/events', async (req, res) => {
  const { data, error } = await supabase
    .from(EVENTS_TABLE_NAME)
    .select('*');

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

app.get(['/', '/email', '/calendar/:month?'], async (req, res) => {
  const view = getView(req);
  const monthParam = String(req.params.month || '');
  const audienceFilter = parseFilterList(req.query.audience);
  const industryFilter = parseFilterList(req.query.industry);
  const topicFilter = parseFilterList(req.query.topic);
  const activityFilter = parseFilterList(req.query.activity);
  const modeFilter = parseFilterList(req.query.mode);
  const { data: events, error } = await supabase
    .from(EVENTS_TABLE_NAME)
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

  const audienceOptions = buildFilterOptions(deduped, 'audience');
  const industryOptions = buildFilterOptions(deduped, 'industry');
  const topicOptions = buildFilterOptions(deduped, 'topic');
  const activityOptions = buildFilterOptions(deduped, 'activity');
  const emailDraft = buildEmailDraft(allDeduped);
  const emailDraftHtml = buildEmailDraftHtml(allDeduped);
  const calendar = buildCalendarModel(allDeduped, monthParam);
  const currentFilters = {
    audience: serializeFilterList(audienceFilter),
    industry: serializeFilterList(industryFilter),
    topic: serializeFilterList(topicFilter),
    activity: serializeFilterList(activityFilter),
    mode: serializeFilterList(modeFilter)
  };

  if (view === 'events' && req.query.view === 'modern') {
    const toggleUrl = buildUrl('/', currentFilters);
    return res.send(renderModernEventsHtml(deduped, currentFilters, audienceOptions, industryOptions, topicOptions, activityOptions, toggleUrl));
  }

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Chicago In Real Life | The Top Tech & Startup Events</title>
  <script>!function(){var s=localStorage.getItem('chiirl-theme'),d=window.matchMedia('(prefers-color-scheme:dark)').matches;document.documentElement.className='theme-'+(s||(d?'dark':'light'));}();</script>
  <style>
    html.theme-light {
      --cl-bg: #f0f0e8; --cl-text: #222; --cl-link: #1d6f93;
      --cl-li-border: #ccc; --cl-date: #666; --cl-loc: #888; --cl-tag: #555;
      --cl-panel-bg: #fff; --cl-panel-border: #bbb; --cl-opt-border: #eee;
      --cl-table-bg: #fff; --cl-th-bg: #ddd; --cl-td-border: #bbb;
      --cl-muted-text: #999; --cl-muted-bg: #fafafa;
      --cl-email-bg: #fff; --cl-select-bg: #fff; --cl-select-border: #999;
      --cl-results: #666; --cl-chip-bg: #fff; --cl-chip-border: #1d6f93; --cl-chip-text: #1d6f93;
      --cl-count: #666; --cl-cal-time: #666;
    }
    html.theme-dark {
      --cl-bg: #15151f; --cl-text: #d0d0e0; --cl-link: #41b6e6;
      --cl-li-border: #333; --cl-date: #aaa; --cl-loc: #888; --cl-tag: #aaa;
      --cl-panel-bg: #1e1e2e; --cl-panel-border: #444; --cl-opt-border: #333;
      --cl-table-bg: #1e1e2e; --cl-th-bg: #252538; --cl-td-border: #444;
      --cl-muted-text: #555; --cl-muted-bg: #181828;
      --cl-email-bg: #1e1e2e; --cl-select-bg: #1e1e2e; --cl-select-border: #444;
      --cl-results: #888; --cl-chip-bg: #1e1e2e; --cl-chip-border: #41b6e6; --cl-chip-text: #41b6e6;
      --cl-count: #888; --cl-cal-time: #888;
    }
    ${renderLogoStyles()}
    ${renderThemeStyles()}
    body { font-family: arial, helvetica, sans-serif; font-size: 14px; background: var(--cl-bg); color: var(--cl-text); margin: 0; padding: 10px; }
    a { color: var(--cl-link); }
    a:visited { color: var(--cl-link); }
    ul { list-style: none; padding: 0; max-width: 800px; }
    li { padding: 4px 0; border-bottom: 1px solid var(--cl-li-border); display: flex; align-items: center; gap: 8px; }
    li img { width: 50px; height: 50px; object-fit: cover; border-radius: 4px; flex-shrink: 0; }
    .date { color: var(--cl-date); font-size: 12px; }
    .loc { color: var(--cl-loc); font-size: 12px; }
    .tag { font-size: 11px; color: var(--cl-tag); }
    .tabs { margin-bottom: 10px; max-width: 800px; }
    .filter-toolbar { display: flex; flex-wrap: wrap; gap: 0; max-width: 800px; margin-bottom: 6px; position: relative; overflow: visible; }
    .filter-btn, .clear-btn { appearance: none; border: 1px solid #1d6f93; background: #41b6e6; color: #fff; padding: 4px 10px; font: inherit; font-size: 12px; cursor: pointer; }
    .filter-btn.active { background: #1d6f93; color: #fff; }
    .filter-panel { display: none; position: absolute; left: 0; top: calc(100% + 6px); width: min(320px, calc(100vw - 20px)); max-width: calc(100vw - 20px); box-sizing: border-box; max-height: 60vh; overflow: auto; background: var(--cl-panel-bg); border: 1px solid var(--cl-panel-border); box-shadow: 0 8px 24px rgba(0, 0, 0, 0.12); padding: 10px; z-index: 20; color: var(--cl-text); }
    .filter-panel.open { display: block; }
    .filter-option { display: flex; justify-content: space-between; gap: 12px; padding: 6px 0; border-bottom: 1px solid var(--cl-opt-border); }
    .filter-option:last-child { border-bottom: 0; }
    .filter-option label { display: flex; gap: 8px; align-items: center; cursor: pointer; flex: 1; }
    .filter-count { color: var(--cl-count); font-size: 12px; white-space: nowrap; }
    .active-chips { display: flex; flex-wrap: wrap; gap: 6px; max-width: 800px; margin: 0 0 10px; }
    .chip { appearance: none; border: 1px solid var(--cl-chip-border); background: var(--cl-chip-bg); color: var(--cl-chip-text); padding: 4px 8px; font: inherit; font-size: 12px; cursor: pointer; }
    .results-count { max-width: 800px; margin: 0 0 8px; color: var(--cl-results); font-size: 12px; }
    .theme-toggle-btn { appearance: none; border: 1px solid #1d6f93; background: #41b6e6; color: #fff; padding: 4px 10px; font: inherit; font-size: 12px; cursor: pointer; margin-right: 4px; }
    html.theme-dark .theme-toggle-btn { background: #1e1e2e; border-color: #41b6e6; color: #41b6e6; }
    @media (max-width: 640px) {
      .filter-toolbar { gap: 0; }
      .filter-btn, .clear-btn { flex: 1 1 calc(50% - 6px); min-height: 34px; }
      .filter-panel { left: 0; right: 0; width: auto; min-width: 0; max-width: calc(100vw - 20px); max-height: 70vh; }
    }
    pre.email-draft { max-width: 900px; white-space: pre-wrap; background: var(--cl-email-bg); border: 1px solid var(--cl-panel-border); padding: 10px; font-family: "Courier New", monospace; line-height: 1.4; color: var(--cl-text); }
    .subtools { margin-bottom: 10px; max-width: 900px; font-size: 12px; }
    .copy-btn { font-size: 12px; padding: 2px 8px; }
    .calendar-wrap { max-width: 1000px; }
    .calendar-head { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
    .calendar-head .month { font-weight: bold; min-width: 180px; }
    table.calendar { width: 100%; border-collapse: collapse; table-layout: fixed; background: var(--cl-table-bg); color: var(--cl-text); }
    table.calendar th, table.calendar td { border: 1px solid var(--cl-td-border); vertical-align: top; padding: 6px; }
    table.calendar th { background: var(--cl-th-bg); font-size: 12px; }
    table.calendar td { height: 120px; font-size: 12px; }
    .day-num { font-weight: bold; margin-bottom: 4px; }
    .day-muted { color: var(--cl-muted-text); background: var(--cl-muted-bg); }
    .cal-event { margin: 2px 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .cal-event a { text-decoration: underline; }
    .cal-time { color: var(--cl-cal-time); margin-right: 4px; }
    html.theme-dark .filters { background: var(--cl-panel-bg); border-color: var(--cl-panel-border); color: var(--cl-text); }
    html.theme-dark .filters select { background: var(--cl-select-bg); border-color: var(--cl-select-border); color: var(--cl-text); }
  </style>
</head>
<body>
  <img class="site-logo" src="/logo.png" alt="CHIIRL | Chicago In Real Life">
  <h1>Chicago In Real Life | The Top Tech & Startup Events</h1>
  <div class="tabs" style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
    <a href="${buildUrl('/', currentFilters)}"${view === 'events' ? ' class="active"' : ''}>Events</a>
    <a href="/email"${view === 'email' ? ' class="active"' : ''}>Email Draft</a>
    <a href="/calendar${calendar.monthParam ? '/' + calendar.monthParam : ''}"${view === 'calendar' ? ' class="active"' : ''}>Calendar</a>
    <button id="theme-toggle" class="theme-toggle-btn" type="button" title="Toggle color theme">☀</button>
    ${view === 'events' ? `<a href="${buildUrl('/', { ...currentFilters, view: 'modern' })}" style="margin-left:auto;">✦ Modern View</a>` : ''}
  </div>
  <p><a href="${buildUrl('/archive')}">archive</a> | <a href="${buildUrl('/raw')}">raw table</a></p>
  ${view === 'events' ? `<div class="filter-toolbar" id="filter-toolbar">
    <button class="filter-btn" type="button" data-filter-button="audience">Audience ▼</button>
    <button class="filter-btn" type="button" data-filter-button="industry">Industry ▼</button>
    <button class="filter-btn" type="button" data-filter-button="topic">Topic ▼</button>
    <button class="filter-btn" type="button" data-filter-button="activity">Activity ▼</button>
    <button class="filter-btn" type="button" data-filter-button="mode">Mode ▼</button>
    <button class="clear-btn" type="button" id="clear-filters">Clear</button>
    <div class="filter-panel" data-filter-panel="audience">
      ${audienceOptions.map((value) => `<div class="filter-option" data-option="${escapeHtml(value)}"><label><input type="checkbox" data-filter-key="audience" value="${escapeHtml(value)}"${audienceFilter.includes(value) ? ' checked' : ''}> <span>${escapeHtml(value)}</span></label><span class="filter-count"></span></div>`).join('')}
    </div>
    <div class="filter-panel" data-filter-panel="industry">
      ${industryOptions.map((value) => `<div class="filter-option" data-option="${escapeHtml(value)}"><label><input type="checkbox" data-filter-key="industry" value="${escapeHtml(value)}"${industryFilter.includes(value) ? ' checked' : ''}> <span>${escapeHtml(value)}</span></label><span class="filter-count"></span></div>`).join('')}
    </div>
    <div class="filter-panel" data-filter-panel="topic">
      ${topicOptions.map((value) => `<div class="filter-option" data-option="${escapeHtml(value)}"><label><input type="checkbox" data-filter-key="topic" value="${escapeHtml(value)}"${topicFilter.includes(value) ? ' checked' : ''}> <span>${escapeHtml(value)}</span></label><span class="filter-count"></span></div>`).join('')}
    </div>
    <div class="filter-panel" data-filter-panel="activity">
      ${activityOptions.map((value) => `<div class="filter-option" data-option="${escapeHtml(value)}"><label><input type="checkbox" data-filter-key="activity" value="${escapeHtml(value)}"${activityFilter.includes(value) ? ' checked' : ''}> <span>${escapeHtml(value)}</span></label><span class="filter-count"></span></div>`).join('')}
    </div>
    <div class="filter-panel" data-filter-panel="mode">
      ${['irl', 'online'].map((value) => `<div class="filter-option" data-option="${escapeHtml(value)}"><label><input type="checkbox" data-filter-key="mode" value="${escapeHtml(value)}"${modeFilter.includes(value) ? ' checked' : ''}> <span>${escapeHtml(value === 'irl' ? 'IRL' : 'Online')}</span></label><span class="filter-count"></span></div>`).join('')}
    </div>
  </div>
  <div class="active-chips" id="active-chips"></div>
  <p class="results-count" id="results-count"></p>
  <ul id="event-list">
    ${deduped.map(e => `
      <li
        data-audience="${escapeHtml(encodeFilterValues(e.audience))}"
        data-industry="${escapeHtml(encodeFilterValues(e.industry))}"
        data-topic="${escapeHtml(encodeFilterValues(e.topic))}"
        data-activity="${escapeHtml(encodeFilterValues(e.activity))}"
        data-mode="${escapeHtml(e.Online === 'TRUE' ? 'online' : 'irl')}"
      >
        ${e.image_url ? `<img src="${e.image_url}" alt="">` : ''}
        <div><a href="${e.eventUrl || '#'}">${e.title}</a>
        <span class="tag">(${e.Online === 'TRUE' ? 'Online' : 'IRL'})</span><br>
        <span class="date">${formatChicagoDateTime(e.start_datetime)}</span>
        <span class="loc">${e.location || ''}</span>
        ${e.google_maps_url && e.Online !== 'TRUE' ? ` - <a href="${e.google_maps_url}">map</a>` : ''}
        - <a href="${buildUrl('/event', { title: e.title, date: e.start_datetime || '' })}">raw</a>
        ${renderTaxonomyList(e) ? `<br>${renderTaxonomyList(e)}` : ''}
        </div>
      </li>
    `).join('')}
  </ul>
  <script>
    (function () {
      var toolbar = document.getElementById('filter-toolbar');
      var list = document.getElementById('event-list');
      var chips = document.getElementById('active-chips');
      var resultsCount = document.getElementById('results-count');
      if (!toolbar || !list || !chips || !resultsCount) return;

      var keys = ['audience', 'industry', 'topic', 'activity', 'mode'];
      var labels = { audience: 'Audience', industry: 'Industry', topic: 'Topic', activity: 'Activity', mode: 'Mode' };
      var rows = Array.prototype.slice.call(list.querySelectorAll('li'));
      var buttons = {};
      var panels = {};

      keys.forEach(function (key) {
        buttons[key] = toolbar.querySelector('[data-filter-button="' + key + '"]');
        panels[key] = toolbar.querySelector('[data-filter-panel="' + key + '"]');
      });

      function matches(rowValue, selectedValue) {
        if (!selectedValue.length) return true;
        var values = String(rowValue || '').split('|').filter(Boolean);
        return selectedValue.some(function (item) { return values.includes(item); });
      }

      function rowMatchesFilters(row, values, skipKey) {
        return (skipKey === 'audience' || matches(row.dataset.audience, values.audience)) &&
          (skipKey === 'industry' || matches(row.dataset.industry, values.industry)) &&
          (skipKey === 'topic' || matches(row.dataset.topic, values.topic)) &&
          (skipKey === 'activity' || matches(row.dataset.activity, values.activity)) &&
          (skipKey === 'mode' || matches(row.dataset.mode, values.mode));
      }

      function getRowValues(row, key) {
        return String(row.dataset[key] || '').split('|').filter(Boolean);
      }

      function currentValues() {
        var values = {};
        keys.forEach(function (key) {
          values[key] = Array.prototype.slice.call(toolbar.querySelectorAll('input[data-filter-key="' + key + '"]:checked')).map(function (input) {
            return String(input.value || '').trim().toLowerCase();
          });
        });
        return values;
      }

      function updateOptions(values) {
        var categoryTotals = {};
        keys.forEach(function (key) {
          var panel = panels[key];
          if (!panel) return;

          var counts = {};
          var total = 0;
          rows.forEach(function (row) {
            if (!rowMatchesFilters(row, values, key)) return;
            if (getRowValues(row, key).length > 0) total += 1;
            getRowValues(row, key).forEach(function (value) {
              counts[value] = (counts[value] || 0) + 1;
            });
          });
          categoryTotals[key] = total;

          Array.prototype.forEach.call(panel.querySelectorAll('.filter-option'), function (option) {
            var optionValue = String(option.getAttribute('data-option') || '').trim().toLowerCase();
            var count = counts[optionValue] || 0;
            var countEl = option.querySelector('.filter-count');
            if (countEl) countEl.textContent = count > 0 ? String(count) : '';
            option.style.display = count === 0 && !values[key].includes(optionValue) ? 'none' : '';
            option.setAttribute('data-count', String(count));
          });

          Array.prototype.slice.call(panel.querySelectorAll('.filter-option'))
            .sort(function (a, b) {
              var countA = Number(a.getAttribute('data-count') || '0');
              var countB = Number(b.getAttribute('data-count') || '0');
              if (countB !== countA) return countB - countA;
              var labelA = String(a.getAttribute('data-option') || '').toLowerCase();
              var labelB = String(b.getAttribute('data-option') || '').toLowerCase();
              return labelA.localeCompare(labelB);
            })
            .forEach(function (option) {
              panel.appendChild(option);
            });
        });
        return categoryTotals;
      }

      function syncUrl(values) {
        var params = new URLSearchParams();
        keys.forEach(function (key) {
          if (values[key].length) params.set(key, values[key].join(','));
        });
        var query = params.toString();
        window.history.replaceState({}, '', query ? ('/?' + query) : '/');
      }

      function updateButtons(values, categoryTotals) {
        keys.forEach(function (key) {
          var button = buttons[key];
          if (!button) return;
          var total = categoryTotals[key] || 0;
          if (!values[key].length) {
            button.textContent = labels[key] + ' ' + total + ' ▼';
            button.classList.remove('active');
            return;
          }
          var first = values[key][0] === 'irl' ? 'IRL' : values[key][0] === 'online' ? 'Online' : values[key][0];
          button.textContent = labels[key] + ': ' + first + (values[key].length > 1 ? ' +' + (values[key].length - 1) : '') + ' (' + total + ') ▼';
          button.classList.add('active');
        });
      }

      function updateChips(values) {
        var items = [];
        keys.forEach(function (key) {
          values[key].forEach(function (value) {
            items.push({ key: key, value: value });
          });
        });
        chips.innerHTML = items.map(function (item) {
          var label = item.value === 'irl' ? 'IRL' : item.value === 'online' ? 'Online' : item.value;
          return '<button class="chip" type="button" data-chip-key="' + item.key + '" data-chip-value="' + item.value + '">' + labels[item.key] + ': ' + label + ' ×</button>';
        }).join('');
      }

      function applyFilters() {
        var values = currentValues();
        var visibleCount = 0;
        rows.forEach(function (row) {
          var visible = rowMatchesFilters(row, values);
          row.style.display = visible ? '' : 'none';
          if (visible) visibleCount += 1;
        });

        var categoryTotals = updateOptions(values);
        updateButtons(values, categoryTotals);
        updateChips(values);
        resultsCount.textContent = visibleCount + ' event' + (visibleCount === 1 ? '' : 's');
        syncUrl(values);
      }

      function closePanels(exceptKey) {
        keys.forEach(function (key) {
          if (!panels[key]) return;
          panels[key].classList.toggle('open', key === exceptKey && !panels[key].classList.contains('open'));
        });
      }

      keys.forEach(function (key) {
        var button = buttons[key];
        if (button) {
          button.addEventListener('click', function () {
            var willOpen = !panels[key].classList.contains('open');
            keys.forEach(function (otherKey) {
              if (panels[otherKey]) panels[otherKey].classList.remove('open');
            });
            if (willOpen && panels[key]) panels[key].classList.add('open');
          });
        }
        Array.prototype.forEach.call(toolbar.querySelectorAll('input[data-filter-key="' + key + '"]'), function (input) {
          input.addEventListener('change', applyFilters);
        });
      });

      document.getElementById('clear-filters').addEventListener('click', function () {
        Array.prototype.forEach.call(toolbar.querySelectorAll('input[type="checkbox"]'), function (input) {
          input.checked = false;
        });
        keys.forEach(function (key) {
          if (panels[key]) panels[key].classList.remove('open');
        });
        applyFilters();
      });

      chips.addEventListener('click', function (event) {
        var button = event.target.closest('.chip');
        if (!button) return;
        var key = button.getAttribute('data-chip-key');
        var value = button.getAttribute('data-chip-value');
        var input = toolbar.querySelector('input[data-filter-key="' + key + '"][value="' + value + '"]');
        if (input) {
          input.checked = false;
          applyFilters();
        }
      });

      document.addEventListener('click', function (event) {
        if (!toolbar.contains(event.target)) {
          keys.forEach(function (key) {
            if (panels[key]) panels[key].classList.remove('open');
          });
        }
      });

      applyFilters();
    })();
  </script>` : view === 'email' ? `<pre id="email-draft" class="email-draft">${emailDraftHtml}</pre>` : `
  <div class="calendar-wrap">
    <div class="calendar-head">
      <a href="/calendar/${calendar.prevMonthParam}">&larr; Prev</a>
      <span class="month">${escapeHtml(calendar.monthLabel)}</span>
      <a href="/calendar/${calendar.nextMonthParam}">Next &rarr;</a>
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
  <script>
    (function() {
      var btn = document.getElementById('theme-toggle');
      if (!btn) return;
      function sync() {
        var dark = document.documentElement.classList.contains('theme-dark');
        btn.textContent = dark ? '☀' : '☽';
        btn.title = dark ? 'Switch to light mode' : 'Switch to dark mode';
      }
      sync();
      btn.addEventListener('click', function() {
        var dark = document.documentElement.classList.contains('theme-dark');
        var t = dark ? 'light' : 'dark';
        document.documentElement.className = 'theme-' + t;
        localStorage.setItem('chiirl-theme', t);
        sync();
      });
    })();
  </script>
</body>
</html>`;

  res.send(html);
});

app.get('/email.txt', async (req, res) => {
  const { data: events, error } = await supabase
    .from(EVENTS_TABLE_NAME)
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
  if (!title) return res.status(400).send('Missing title');

  let query = supabase.from(EVENTS_TABLE_NAME).select('*').eq('title', title);
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
    ${renderLogoStyles()}
    ${renderThemeStyles()}
    body { font-family: arial, helvetica, sans-serif; font-size: 14px; background: #f0f0e8; color: #222; margin: 0; padding: 10px; }
    .tabs { margin-bottom: 10px; max-width: 800px; }
    table { border-collapse: collapse; max-width: 800px; }
    th, td { border: 1px solid #999; padding: 4px 8px; text-align: left; vertical-align: top; }
    th { background: #ddd; width: 150px; }
    td { max-width: 600px; word-wrap: break-word; }
  </style>
</head>
<body>
  <img class="site-logo" src="/logo.png" alt="CHIIRL | Chicago In Real Life">
  <h1>${event.title}</h1>
  <p><a href="${buildUrl('/')}">back</a></p>
  <table>
    ${fields.map(([k, v]) => `<tr><th>${k}</th><td>${v}</td></tr>`).join('')}
  </table>
</body>
</html>`;

  res.send(html);
});

app.get('/archive', async (req, res) => {
  const { data: events, error } = await supabase
    .from(EVENTS_TABLE_NAME)
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
    ${renderLogoStyles()}
    ${renderThemeStyles()}
    body { font-family: arial, helvetica, sans-serif; font-size: 14px; background: #f0f0e8; color: #222; margin: 0; padding: 10px; }
    ul { list-style: none; padding: 0; max-width: 800px; }
    li { padding: 4px 0; border-bottom: 1px solid #ccc; display: flex; align-items: center; gap: 8px; }
    li img { width: 50px; height: 50px; object-fit: cover; border-radius: 4px; flex-shrink: 0; }
    .date { color: #666; font-size: 12px; }
    .loc { color: #888; font-size: 12px; }
    .tag { font-size: 11px; color: #555; }
    .tabs { margin-bottom: 10px; max-width: 800px; }
  </style>
</head>
<body>
  <img class="site-logo" src="/logo.png" alt="CHIIRL | Chicago In Real Life">
  <h1>CHIIRL | Archive</h1>
  <p><a href="${buildUrl('/')}">back to upcoming</a></p>
  <ul>
    ${events.map(e => `
      <li>
        ${e.image_url ? `<img src="${e.image_url}" alt="">` : ''}
        <div><a href="${e.eventUrl || '#'}">${e.title}</a>
        <span class="tag">(${e.Online === 'TRUE' ? 'Online' : 'IRL'})</span><br>
        <span class="date">${formatChicagoDateTime(e.start_datetime, true)}</span>
        <span class="loc">${e.location || ''}</span>
        - <a href="${buildUrl('/event', { title: e.title, date: e.start_datetime || '' })}">raw</a>
        </div>
      </li>
    `).join('')}
  </ul>
</body>
</html>`;

  res.send(html);
});

app.get('/raw', async (req, res) => {
  const { data: events, error } = await supabase
    .from(EVENTS_TABLE_NAME)
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
    ${renderLogoStyles()}
    ${renderThemeStyles()}
    body { font-family: arial, helvetica, sans-serif; font-size: 12px; background: #f0f0e8; color: #222; margin: 0; padding: 10px; }
    .tabs { margin-bottom: 10px; max-width: 100%; }
    table { border-collapse: collapse; width: 100%; }
    th, td { border: 1px solid #999; padding: 3px 6px; text-align: left; max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    th { background: #ddd; position: sticky; top: 0; }
    tr:nth-child(even) { background: #e8e8e0; }
  </style>
</head>
<body>
  <img class="site-logo" src="/logo.png" alt="CHIIRL | Chicago In Real Life">
  <h1>CHIIRL | Raw Data</h1>
  <p><a href="${buildUrl('/')}">back</a></p>
  <table>
    <tr>${cols.map(c => `<th>${c}</th>`).join('')}</tr>
    ${events.map(e => `<tr>${cols.map(c => `<td>${e[c] != null ? e[c] : ''}</td>`).join('')}</tr>`).join('')}
  </table>
</body>
</html>`;

  res.send(html);
});

app.listen(3000, () => console.log('Server running on http://localhost:3000'));
