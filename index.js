const path = require('path');
const express = require('express');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();
const {
  clearSessionCookies,
  createPublicClient,
  ensureProfile,
  getSessionContext,
  setSessionCookies,
  updateProfile
} = require('./auth');

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
  if (req.query.view === 'email') return 'email';
  if (req.query.view === 'calendar') return 'calendar';
  return 'events';
}

function buildUrl(path, params = {}) {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v != null && v !== '') query.set(k, v);
  });
  const qs = query.toString();
  return qs ? `${path}?${qs}` : path;
}

function buildAppBaseUrl(req) {
  if (process.env.APP_BASE_URL) return process.env.APP_BASE_URL.replace(/\/+$/, '');
  const proto = req.get('x-forwarded-proto') || req.protocol || 'http';
  return `${proto}://${req.get('host')}`;
}

function getSafeNextPath(value) {
  const next = String(value || '').trim();
  if (!next.startsWith('/')) return '/me';
  if (next.startsWith('//')) return '/me';
  return next;
}

function renderAuthLinks(auth) {
  if (auth?.user) {
    const label = escapeHtml(auth.profile?.display_name || auth.user.email || 'My Profile');
    return `<p><a href="/me">${label}</a></p>`;
  }
  return '<p><a href="/auth">Sign in</a></p>';
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

app.get('/logo.png', (req, res) => {
  res.sendFile(path.join(__dirname, 'Logo_on_light_bg.png'));
});

app.get('/api/events', async (req, res) => {
  const { data, error } = await supabase
    .from(EVENTS_TABLE_NAME)
    .select('*');

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

app.get('/api/me', async (req, res) => {
  try {
    const auth = await getSessionContext(req, res);
    if (!auth.user) return res.status(401).json({ error: 'Not signed in' });
    const profile = auth.profile || await ensureProfile(auth.user);
    return res.json({
      user: {
        id: auth.user.id,
        email: auth.user.email
      },
      profile
    });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

app.get('/auth', async (req, res) => {
  const auth = await getSessionContext(req, res);
  if (auth.user) return res.redirect('/me');

  const message = String(req.query.message || '');
  const error = String(req.query.error || '');
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>CHIIRL | Sign In</title>
  <style>
    ${renderLogoStyles()}
    ${renderThemeStyles()}
    body { font-family: arial, helvetica, sans-serif; font-size: 14px; background: #f0f0e8; color: #222; margin: 0; padding: 10px; }
    form { max-width: 460px; background: #fff; border: 1px solid #bbb; padding: 12px; }
    label { display: block; margin-bottom: 6px; font-weight: bold; }
    input[type="email"] { width: 100%; box-sizing: border-box; padding: 8px; margin-bottom: 10px; }
    .note { max-width: 460px; margin-bottom: 10px; }
    .msg { max-width: 460px; padding: 8px 10px; border: 1px solid #bbb; margin-bottom: 10px; background: #fff; }
    .err { border-color: #b33; background: #fff0f0; }
  </style>
</head>
<body>
  <img class="site-logo" src="/logo.png" alt="CHIIRL | Chicago In Real Life">
  <h1>CHIIRL | Sign In</h1>
  <p><a href="/">back to events</a></p>
  ${message ? `<p class="msg">${escapeHtml(message)}</p>` : ''}
  ${error ? `<p class="msg err">${escapeHtml(error)}</p>` : ''}
  <p class="note">Enter your email and CHIIRL will send you a Supabase magic link. Your profile record is created the first time you finish sign-in.</p>
  <form method="post" action="/auth/sign-in">
    <label for="email">Email</label>
    <input id="email" name="email" type="email" autocomplete="email" required>
    <button type="submit">Send magic link</button>
  </form>
</body>
</html>`;
  res.send(html);
});

app.post('/auth/sign-in', async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  if (!email) {
    return res.redirect('/auth?error=Email%20is%20required');
  }

  try {
    const supabaseAuth = createPublicClient();
    const redirectTo = `${buildAppBaseUrl(req)}/auth/callback?next=${encodeURIComponent('/me')}`;
    const { error } = await supabaseAuth.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: redirectTo }
    });
    if (error) {
      return res.redirect(`/auth?error=${encodeURIComponent(error.message)}`);
    }
    return res.redirect(`/auth?message=${encodeURIComponent(`Magic link sent to ${email}`)}`);
  } catch (error) {
    return res.redirect(`/auth?error=${encodeURIComponent(error.message)}`);
  }
});

app.get('/auth/callback', async (req, res) => {
  const code = String(req.query.code || '');
  const tokenHash = String(req.query.token_hash || '');
  const type = String(req.query.type || 'email');
  const next = getSafeNextPath(req.query.next);
  if (!code && !tokenHash) {
    return res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>CHIIRL | Finishing Sign In</title>
</head>
<body>
  <p>Finishing sign-in...</p>
  <script>
    (async function () {
      var hash = new URLSearchParams(window.location.hash.slice(1));
      var accessToken = hash.get('access_token');
      var refreshToken = hash.get('refresh_token');
      if (!accessToken || !refreshToken) {
        document.body.innerHTML =
          '<p>Auth callback is missing a server-readable token.</p>' +
          '<p>Update the Supabase Magic Link email template to use <code>{{ .RedirectTo }}</code> and append <code>token_hash</code> plus <code>type=email</code>.</p>';
        return;
      }

      var response = await fetch('/auth/callback/session?next=${encodeURIComponent(next)}', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          access_token: accessToken,
          refresh_token: refreshToken
        })
      });
      var result = await response.json().catch(function () { return {}; });
      if (!response.ok || !result.next) {
        document.body.innerHTML =
          '<p>Unable to finish sign-in.</p>' +
          '<p>Please request a new magic link or verify the Supabase email template.</p>';
        return;
      }
      window.location.replace(result.next);
    })();
  </script>
</body>
</html>`);
  }

  try {
    const supabaseAuth = createPublicClient();
    const result = code
      ? await supabaseAuth.auth.exchangeCodeForSession(code)
      : await supabaseAuth.auth.verifyOtp({
          token_hash: tokenHash,
          type
        });
    const { data, error } = result;
    if (error || !data?.session?.user) {
      throw error || new Error('Unable to create session');
    }
    setSessionCookies(res, data.session);
    await ensureProfile(data.session.user);
    return res.redirect(next);
  } catch (error) {
    return res.redirect(`/auth?error=${encodeURIComponent(error.message)}`);
  }
});

app.post('/auth/callback/session', async (req, res) => {
  const next = getSafeNextPath(req.query.next);
  const accessToken = String(req.body.access_token || '');
  const refreshToken = String(req.body.refresh_token || '');
  if (!accessToken || !refreshToken) {
    return res.status(400).json({ error: 'Missing access_token or refresh_token' });
  }

  try {
    const supabaseAuth = createPublicClient();
    const { data, error } = await supabaseAuth.auth.setSession({
      access_token: accessToken,
      refresh_token: refreshToken
    });
    if (error || !data?.session?.user) {
      throw error || new Error('Unable to create session');
    }
    setSessionCookies(res, data.session);
    await ensureProfile(data.session.user);
    return res.json({ next });
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
});

app.post('/auth/sign-out', async (req, res) => {
  clearSessionCookies(res);
  res.redirect('/');
});

app.get('/me', async (req, res) => {
  try {
    const auth = await getSessionContext(req, res);
    if (!auth.user) return res.redirect('/auth');

    const profile = auth.profile || await ensureProfile(auth.user);
    const message = String(req.query.message || '');
    const error = String(req.query.error || '');
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>CHIIRL | My Profile</title>
  <style>
    ${renderLogoStyles()}
    ${renderThemeStyles()}
    body { font-family: arial, helvetica, sans-serif; font-size: 14px; background: #f0f0e8; color: #222; margin: 0; padding: 10px; }
    .card { max-width: 640px; background: #fff; border: 1px solid #bbb; padding: 12px; margin-bottom: 12px; }
    label { display: block; margin-bottom: 6px; font-weight: bold; }
    input[type="text"] { width: 100%; box-sizing: border-box; padding: 8px; margin-bottom: 10px; }
    .row { margin-bottom: 8px; }
    .msg { max-width: 640px; padding: 8px 10px; border: 1px solid #bbb; margin-bottom: 10px; background: #fff; }
    .err { border-color: #b33; background: #fff0f0; }
    code { background: #eee; padding: 1px 4px; }
  </style>
</head>
<body>
  <img class="site-logo" src="/logo.png" alt="CHIIRL | Chicago In Real Life">
  <h1>CHIIRL | My Profile</h1>
  <p><a href="/">back to events</a></p>
  ${message ? `<p class="msg">${escapeHtml(message)}</p>` : ''}
  ${error ? `<p class="msg err">${escapeHtml(error)}</p>` : ''}
  <div class="card">
    <div class="row"><strong>Email:</strong> ${escapeHtml(auth.user.email || '')}</div>
    <div class="row"><strong>Profile ID:</strong> <code>${escapeHtml(profile.id)}</code></div>
    <div class="row"><strong>Profile Type:</strong> ${escapeHtml(profile.profile_type || 'person')}</div>
  </div>
  <form class="card" method="post" action="/me/profile">
    <label for="display_name">Display Name</label>
    <input id="display_name" name="display_name" type="text" maxlength="80" value="${escapeHtml(profile.display_name || '')}" required>
    <label for="username">Username</label>
    <input id="username" name="username" type="text" maxlength="40" value="${escapeHtml(profile.username || '')}" pattern="[a-z0-9_\\-]*">
    <button type="submit">Save profile</button>
  </form>
  <form method="post" action="/auth/sign-out">
    <button type="submit">Sign out</button>
  </form>
</body>
</html>`;
    return res.send(html);
  } catch (error) {
    return res.status(500).send(`Error loading profile: ${escapeHtml(error.message)}`);
  }
});

app.post('/me/profile', async (req, res) => {
  try {
    const auth = await getSessionContext(req, res);
    if (!auth.user) return res.redirect('/auth');

    const displayName = String(req.body.display_name || '').trim();
    const username = String(req.body.username || '').trim();
    if (!displayName) {
      return res.redirect('/me?error=Display%20name%20is%20required');
    }
    if (username && !/^[a-z0-9_-]+$/.test(username)) {
      return res.redirect('/me?error=Username%20may%20only%20use%20lowercase%20letters,%20numbers,%20hyphens,%20and%20underscores');
    }

    await ensureProfile(auth.user);
    await updateProfile(auth.user.id, {
      display_name: displayName,
      username
    });
    return res.redirect('/me?message=Profile%20saved');
  } catch (error) {
    const msg = error.code === '23505' ? 'Username already taken' : error.message;
    return res.redirect(`/me?error=${encodeURIComponent(msg)}`);
  }
});

app.get('/', async (req, res) => {
  const auth = await getSessionContext(req, res);
  const view = getView(req);
  const monthParam = String(req.query.month || '');
  const audienceFilter = String(req.query.audience || '');
  const industryFilter = String(req.query.industry || '');
  const topicFilter = String(req.query.topic || '');
  const activityFilter = String(req.query.activity || '');
  const modeFilter = String(req.query.mode || '');
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
    audience: audienceFilter,
    industry: industryFilter,
    topic: topicFilter,
    activity: activityFilter,
    mode: modeFilter
  };

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Chicago In Real Life | The Top Tech & Startup Events</title>
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
    .filters { margin-bottom: 10px; max-width: 800px; }
    pre.email-draft { max-width: 900px; white-space: pre-wrap; background: #fff; border: 1px solid #bbb; padding: 10px; font-family: "Courier New", monospace; line-height: 1.4; }
    .subtools { margin-bottom: 10px; max-width: 900px; font-size: 12px; }
    .copy-btn { font-size: 12px; padding: 2px 8px; }
    .calendar-wrap { max-width: 1000px; }
    .calendar-head { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
    .calendar-head .month { font-weight: bold; min-width: 180px; }
    table.calendar { width: 100%; border-collapse: collapse; table-layout: fixed; background: #fff; }
    table.calendar th, table.calendar td { border: 1px solid #bbb; vertical-align: top; padding: 6px; }
    table.calendar th { background: #ddd; font-size: 12px; }
    table.calendar td { height: 120px; font-size: 12px; }
    .day-num { font-weight: bold; margin-bottom: 4px; }
    .day-muted { color: #999; background: #fafafa; }
    .cal-event { margin: 2px 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .cal-event a { text-decoration: underline; }
    .cal-time { color: #666; margin-right: 4px; }
  </style>
</head>
<body>
  <img class="site-logo" src="/logo.png" alt="CHIIRL | Chicago In Real Life">
  <h1>Chicago In Real Life | The Top Tech & Startup Events</h1>
  ${renderAuthLinks(auth)}
  <div class="tabs">
    <a href="${buildUrl('/', currentFilters)}"${view === 'events' ? ' class="active"' : ''}>Events</a>
    <a href="${buildUrl('/', { view: 'email', ...currentFilters })}"${view === 'email' ? ' class="active"' : ''}>Email Draft</a>
    <a href="${buildUrl('/', { view: 'calendar', month: calendar.monthParam, ...currentFilters })}"${view === 'calendar' ? ' class="active"' : ''}>Calendar</a>
  </div>
  <p><a href="${buildUrl('/archive')}">archive</a> | <a href="${buildUrl('/raw')}">raw table</a></p>
  ${view === 'events' ? `<form class="filters" id="event-filters" method="get" action="/">
    <input type="hidden" name="view" value="events">
    <div>
      <label for="audience">Audience</label>
      <select id="audience" name="audience">
        <option value="">All audiences</option>
        ${audienceOptions.map((value) => `<option value="${escapeHtml(value)}" data-base-label="${escapeHtml(value)}"${audienceFilter === value ? ' selected' : ''}>${escapeHtml(value)}</option>`).join('')}
      </select>
    </div>
    <div>
      <label for="industry">Industry</label>
      <select id="industry" name="industry">
        <option value="">All industries</option>
        ${industryOptions.map((value) => `<option value="${escapeHtml(value)}" data-base-label="${escapeHtml(value)}"${industryFilter === value ? ' selected' : ''}>${escapeHtml(value)}</option>`).join('')}
      </select>
    </div>
    <div>
      <label for="topic">Topic</label>
      <select id="topic" name="topic">
        <option value="">All topics</option>
        ${topicOptions.map((value) => `<option value="${escapeHtml(value)}" data-base-label="${escapeHtml(value)}"${topicFilter === value ? ' selected' : ''}>${escapeHtml(value)}</option>`).join('')}
      </select>
    </div>
    <div>
      <label for="activity">Activity</label>
      <select id="activity" name="activity">
        <option value="">All activities</option>
        ${activityOptions.map((value) => `<option value="${escapeHtml(value)}" data-base-label="${escapeHtml(value)}"${activityFilter === value ? ' selected' : ''}>${escapeHtml(value)}</option>`).join('')}
      </select>
    </div>
    <div>
      <label for="mode">Mode</label>
      <select id="mode" name="mode">
        <option value="">All modes</option>
        <option value="irl"${modeFilter === 'irl' ? ' selected' : ''}>IRL</option>
        <option value="online"${modeFilter === 'online' ? ' selected' : ''}>Online</option>
      </select>
    </div>
    <div class="filter-actions">
      <a class="clear-link" href="${buildUrl('/')}">Clear</a>
    </div>
  </form>` : view === 'email' ? `<div class="subtools"><a href="${buildUrl('/email.txt')}">plain text route</a> <button class="copy-btn" onclick="navigator.clipboard.writeText(document.getElementById('email-draft').innerText)">copy</button></div>` : ''}
  ${view === 'events' ? `<ul id="event-list">
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
      var form = document.getElementById('event-filters');
      var list = document.getElementById('event-list');
      if (!form || !list) return;

      var keys = ['audience', 'industry', 'topic', 'activity', 'mode'];
      var rows = Array.prototype.slice.call(list.querySelectorAll('li'));

      function matches(rowValue, selectedValue) {
        if (!selectedValue) return true;
        return String(rowValue || '').split('|').includes(selectedValue);
      }

      function rowMatchesFilters(row, values, skipKey) {
        return (!values.audience || skipKey === 'audience' || matches(row.dataset.audience, values.audience)) &&
          (!values.industry || skipKey === 'industry' || matches(row.dataset.industry, values.industry)) &&
          (!values.topic || skipKey === 'topic' || matches(row.dataset.topic, values.topic)) &&
          (!values.activity || skipKey === 'activity' || matches(row.dataset.activity, values.activity)) &&
          (!values.mode || skipKey === 'mode' || matches(row.dataset.mode, values.mode));
      }

      function getRowValues(row, key) {
        return String(row.dataset[key] || '').split('|').filter(Boolean);
      }

      function updateOptions(values) {
        keys.forEach(function (key) {
          var control = form.elements[key];
          if (!control) return;

          var counts = {};
          rows.forEach(function (row) {
            if (!rowMatchesFilters(row, values, key)) return;
            getRowValues(row, key).forEach(function (value) {
              counts[value] = (counts[value] || 0) + 1;
            });
          });

          Array.prototype.forEach.call(control.options, function (option) {
            if (!option.value) return;
            var baseLabel = option.getAttribute('data-base-label') || option.value;
            var count = counts[option.value] || 0;
            option.textContent = count > 0 ? (baseLabel + ' (' + count + ')') : baseLabel;
            option.hidden = count === 0 && option.value !== values[key];
          });
        });
      }

      function syncUrl(values) {
        var params = new URLSearchParams(window.location.search);
        params.set('view', 'events');
        keys.forEach(function (key) {
          if (values[key]) params.set(key, values[key]);
          else params.delete(key);
        });
        var query = params.toString();
        window.history.replaceState({}, '', query ? ('/?' + query) : '/');
      }

      function applyFilters() {
        var values = {};
        keys.forEach(function (key) {
          var control = form.elements[key];
          values[key] = control ? String(control.value || '').trim().toLowerCase() : '';
        });

        rows.forEach(function (row) {
          var visible = rowMatchesFilters(row, values);
          row.style.display = visible ? '' : 'none';
        });

        updateOptions(values);
        syncUrl(values);
      }

      keys.forEach(function (key) {
        var control = form.elements[key];
        if (control) control.addEventListener('change', applyFilters);
      });

      form.addEventListener('submit', function (event) {
        event.preventDefault();
        applyFilters();
      });

      applyFilters();
    })();
  </script>` : view === 'email' ? `<pre id="email-draft" class="email-draft">${emailDraftHtml}</pre>` : `
  <div class="calendar-wrap">
    <div class="calendar-head">
      <a href="${buildUrl('/', { view: 'calendar', month: calendar.prevMonthParam })}">&larr; Prev</a>
      <span class="month">${escapeHtml(calendar.monthLabel)}</span>
      <a href="${buildUrl('/', { view: 'calendar', month: calendar.nextMonthParam })}">Next &rarr;</a>
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
  ${renderAuthLinks(await getSessionContext(req, res))}
  <p><a href="${buildUrl('/')}">back</a></p>
  <table>
    ${fields.map(([k, v]) => `<tr><th>${k}</th><td>${v}</td></tr>`).join('')}
  </table>
</body>
</html>`;

  res.send(html);
});

app.get('/archive', async (req, res) => {
  const auth = await getSessionContext(req, res);
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
  ${renderAuthLinks(auth)}
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
  const auth = await getSessionContext(req, res);
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
  ${renderAuthLinks(auth)}
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
