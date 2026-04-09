const { parseEventDate, chicagoDateKey, CHICAGO_TIMEZONE } = require('../utils/dates');
const { formatChiirlTimeShort } = require('../utils/dates');
const { escapeHtml, encodeFilterValues } = require('../utils/format');

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
