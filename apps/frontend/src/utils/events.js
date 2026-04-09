const { parseEventDate, chicagoDateKey } = require('./dates');

/**
 * Deduplicate events by title + start_datetime, keeping the first occurrence.
 * Optionally filters to only events with a parseable date.
 */
function deduplicateEvents(events) {
  const seen = new Set();
  return events.filter((e) => {
    if (!parseEventDate(e.start_datetime)) return false;
    const key = `${e.title}|${e.start_datetime}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Filter events to only those on or after today (Chicago time).
 */
function filterUpcoming(events, referenceDate = new Date()) {
  const todayKey = chicagoDateKey(referenceDate);
  return events.filter((e) => {
    const dt = parseEventDate(e.start_datetime);
    if (!dt) return false;
    return chicagoDateKey(dt) >= todayKey;
  });
}

module.exports = {
  deduplicateEvents,
  filterUpcoming
};
