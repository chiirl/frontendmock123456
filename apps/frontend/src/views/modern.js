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

  <script src="/js/modern-filters.js"></script>
  <script src="/js/theme-toggle.js"></script>
</body>
</html>`;
}

module.exports = { renderModernEventsHtml };
