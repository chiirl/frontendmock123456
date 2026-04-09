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
  CLASSIC_THEME_VARS,
  CLASSIC_PAGE_STYLES,
  EVENT_DETAIL_STYLES,
  ARCHIVE_STYLES,
  RAW_TABLE_STYLES
} = require('./styles/classic');
const { deduplicateEvents, filterUpcoming } = require('./utils/events');
const { renderModernEventsHtml } = require('./views/modern');
const { buildEmailDraft, buildEmailDraftHtml } = require('./views/email');
const { buildCalendarModel } = require('./views/calendar');

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

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
    ${CLASSIC_THEME_VARS}
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
          return '<button class="chip" type="button" data-chip-key="' + item.key + '" data-chip-value="' + item.value + '">' + labels[item.key] + ': ' + label + ' \u00d7</button>';
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
