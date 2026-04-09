const { parseEventDate, chicagoDateKey, CHICAGO_TIMEZONE, formatChiirlTimeShort } = require('../utils/dates');
const { escapeHtml, encodeFilterValues } = require('../utils/format');
const { MODERN_STYLES } = require('../styles');

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
  <style>${MODERN_STYLES}</style>
</head>
<body>
  <header class="site-header">
    <div class="wordmark">CHI<svg xmlns="http://www.w3.org/2000/svg" viewBox="98 180 104 120" height="0.85em" style="display:inline;vertical-align:middle;position:relative;top:-2px;"><path d="M150,180l11,41l41,-11l-30,30l30,30l-41,-11l-11,41l-11,-41l-41,11l30,-30l-30,-30l41,11z" fill="#E4002B"/></svg><span>IRL</span></div>
    <div class="header-right">
      <button class="theme-toggle" id="theme-toggle" type="button" title="Toggle color theme">\u2600</button>
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
      <button class="filter-group-btn" type="button" data-modern-filter-btn="${group.key}">${escapeHtml(group.label)} \u25be</button>
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
            btn.textContent = labels[key] + ': ' + first + (values[key].length > 1 ? ' +' + (values[key].length - 1) : '') + ' \\u25be';
          } else {
            btn.textContent = labels[key] + ' \\u25be';
          }
        });
      }

      function updateChips(values) {
        var items = [];
        keys.forEach(function (key) { values[key].forEach(function (val) { items.push({ key: key, value: val }); }); });
        chipsWrap.innerHTML = items.map(function (item) {
          var label = item.value === 'irl' ? 'IRL' : item.value === 'online' ? 'Online' : item.value;
          return '<button class="chip-modern" type="button" data-chip-key="' + item.key + '" data-chip-value="' + item.value + '">' + labels[item.key] + ': ' + label + ' \\u00d7</button>';
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
        btn.textContent = dark ? '\\u2600' : '\\u263d';
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

module.exports = { renderModernEventsHtml };
