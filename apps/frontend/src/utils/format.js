function escapeHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
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

function normalizeFilterValue(value) {
  return String(value || '').trim().toLowerCase();
}

function parseFilterList(value) {
  if (Array.isArray(value)) return [...new Set(value.flatMap(parseFilterList))];
  return [...new Set(String(value || '').split(',').map((item) => item.trim()).filter(Boolean))];
}

function serializeFilterList(values) {
  return parseFilterList(values).join(',');
}

function encodeFilterValues(values) {
  return getArrayValues(values)
    .map(normalizeFilterValue)
    .join('|');
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

module.exports = {
  escapeHtml,
  getArrayValues,
  getEventTags,
  getEventTaxonomyValues,
  normalizeFilterValue,
  parseFilterList,
  serializeFilterList,
  encodeFilterValues,
  buildTaxonomyOptions,
  buildFilterOptions,
  renderTaxonomyList,
  renderLogoStyles,
  renderThemeStyles,
  buildUrl
};
