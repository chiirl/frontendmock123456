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
  buildUrl
};
