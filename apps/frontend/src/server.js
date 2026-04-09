const path = require('path');
const express = require('express');

const { supabase, EVENTS_TABLE_NAME } = require('./db');
const { parseEventDate, formatChiirlTimeShort, formatChicagoDateTime, chicagoDateKey } = require('./utils/dates');
const {
  escapeHtml,
  buildUrl,
  parseFilterList,
  serializeFilterList,
  encodeFilterValues,
  buildFilterOptions,
  renderTaxonomyList
} = require('./utils/format');
const {
  LOGO_STYLES,
  BASE_STYLES,
  CLASSIC_PAGE_STYLES,
  EVENT_DETAIL_STYLES,
  ARCHIVE_STYLES,
  RAW_TABLE_STYLES
} = require('./styles');
const { deduplicateEvents, filterUpcoming } = require('./utils/events');
const { renderModernEventsHtml } = require('./views/modern');
const { buildEmailDraft, buildEmailDraftHtml } = require('./views/email');
const { buildCalendarModel } = require('./views/calendar');

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(express.static(path.join(__dirname, 'public')));

function getView(req) {
  if (req.path === '/email') return 'email';
  if (req.path.startsWith('/calendar')) return 'calendar';
  return 'events';
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

  const allDeduped = deduplicateEvents(events);
  const deduped = deduplicateEvents(filterUpcoming(events));

  const audienceOptions = buildFilterOptions(deduped, 'audience');
  const industryOptions = buildFilterOptions(deduped, 'industry');
  const topicOptions = buildFilterOptions(deduped, 'topic');
  const activityOptions = buildFilterOptions(deduped, 'activity');
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
    ${LOGO_STYLES}
    ${BASE_STYLES}
    ${CLASSIC_PAGE_STYLES}
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
  <script src="/js/classic-filters.js"></script>` : view === 'email' ? `<pre id="email-draft" class="email-draft">${emailDraftHtml}</pre>` : `
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
  <script src="/js/theme-toggle.js"></script>
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

  const allDeduped = deduplicateEvents(events || []);
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
    ${LOGO_STYLES}
    ${BASE_STYLES}
    ${EVENT_DETAIL_STYLES}
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
    ${LOGO_STYLES}
    ${BASE_STYLES}
    ${ARCHIVE_STYLES}
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
    ${LOGO_STYLES}
    ${BASE_STYLES}
    ${RAW_TABLE_STYLES}
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
