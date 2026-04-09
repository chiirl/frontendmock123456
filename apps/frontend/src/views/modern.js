const { parseEventDate, chicagoDateKey, CHICAGO_TIMEZONE } = require('../utils/dates');

function prepareModernViewData(deduped, audienceOptions, industryOptions, topicOptions, activityOptions) {
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

  return { days: [...byDay.values()], filterGroups };
}

module.exports = { prepareModernViewData };
