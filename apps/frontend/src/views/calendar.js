const {
  parseEventDate,
  chicagoDateKey,
  chicagoDateParts,
  parseMonthParam,
  formatMonthParam,
  shiftMonthParam,
  CHICAGO_TIMEZONE
} = require('../utils/dates');

function buildCalendarModel(events, monthParam, referenceDate = new Date()) {
  const ref = chicagoDateParts(referenceDate);
  const parsed = parseMonthParam(monthParam);
  const year = parsed?.year || ref.year;
  const month = parsed?.month || ref.month;
  const monthParamResolved = formatMonthParam(year, month);

  const first = new Date(Date.UTC(year, month - 1, 1, 12, 0, 0));
  const firstWeekday = first.getUTCDay(); // Sun=0
  const gridStart = new Date(first);
  gridStart.setUTCDate(gridStart.getUTCDate() - firstWeekday);

  const eventMap = new Map();
  for (const e of events) {
    const dt = parseEventDate(e.start_datetime);
    if (!dt) continue;
    const key = chicagoDateKey(dt);
    if (!eventMap.has(key)) eventMap.set(key, []);
    eventMap.get(key).push(e);
  }

  const monthLabel = new Intl.DateTimeFormat('en-US', {
    timeZone: CHICAGO_TIMEZONE,
    month: 'long',
    year: 'numeric'
  }).format(first);

  const weeks = [];
  for (let w = 0; w < 6; w += 1) {
    const row = [];
    for (let d = 0; d < 7; d += 1) {
      const cell = new Date(gridStart);
      cell.setUTCDate(gridStart.getUTCDate() + (w * 7) + d);
      const p = chicagoDateParts(cell);
      const key = chicagoDateKey(cell);
      const inMonth = p.year === year && p.month === month;
      row.push({
        key,
        day: p.day,
        inMonth,
        isToday: key === chicagoDateKey(referenceDate),
        events: (eventMap.get(key) || []).sort((a, b) => {
          const ta = parseEventDate(a.start_datetime)?.getTime() || 0;
          const tb = parseEventDate(b.start_datetime)?.getTime() || 0;
          return ta - tb;
        })
      });
    }
    weeks.push(row);
  }

  return {
    monthLabel,
    monthParam: monthParamResolved,
    prevMonthParam: shiftMonthParam(monthParamResolved, -1),
    nextMonthParam: shiftMonthParam(monthParamResolved, 1),
    weeks
  };
}

module.exports = { buildCalendarModel };
