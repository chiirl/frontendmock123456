const CHICAGO_TIMEZONE = 'America/Chicago';

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

module.exports = {
  CHICAGO_TIMEZONE,
  parseEventDate,
  chicagoDateKey,
  chicagoDateParts,
  formatChiirlTimeShort,
  formatChicagoDateTime,
  parseMonthParam,
  formatMonthParam,
  shiftMonthParam
};
