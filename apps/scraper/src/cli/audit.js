#!/usr/bin/env node
const { createReadClient, getEventsTable } = require('../db/supabase');

const CHICAGO_TZ = 'America/Chicago';

function chicagoTodayKey() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: CHICAGO_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(new Date());
}

function eventDateKey(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: CHICAGO_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(date);
}

function normalizeTitle(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function isOnline(row) {
  const online = String(row?.Online || '').trim().toLowerCase();
  const location = String(row?.location || '').trim().toLowerCase();
  return online === 'true' || location.includes('online');
}

function isChicagoIrl(row) {
  if (isOnline(row)) return false;
  const location = String(row?.location || '').trim().toLowerCase();
  if (!location) return false;
  if (location.includes('chicago')) return true;
  if (location.includes('register to see address')) return true;
  return false;
}

async function main() {
  const supabase = createReadClient();
  const table = getEventsTable();
  const today = chicagoTodayKey();

  const { data, error } = await supabase
    .from(table)
    .select('id,title,start_datetime,location,image_url,eventUrl,Online')
    .gte('start_datetime', today)
    .order('start_datetime', { ascending: true });

  if (error) throw error;

  const upcoming = data || [];
  const dupes = new Map();
  for (const row of upcoming) {
    const key = `${eventDateKey(row.start_datetime)}::${normalizeTitle(row.title)}`;
    if (!dupes.has(key)) dupes.set(key, []);
    dupes.get(key).push(row);
  }

  const duplicateGroups = [...dupes.values()].filter((rows) => rows.length > 1);
  const onlineRows = upcoming.filter(isOnline);
  const nonChicagoRows = upcoming.filter((row) => !isChicagoIrl(row));
  const missingImageRows = upcoming.filter((row) => !String(row.image_url || '').trim());
  const missingUrlRows = upcoming.filter((row) => !String(row.eventUrl || '').trim());

  const report = {
    table,
    upcoming_count: upcoming.length,
    duplicate_group_count: duplicateGroups.length,
    online_count: onlineRows.length,
    non_chicago_count: nonChicagoRows.length,
    missing_image_count: missingImageRows.length,
    missing_event_url_count: missingUrlRows.length,
    duplicate_groups: duplicateGroups.map((rows) => rows.map((row) => ({
      id: row.id,
      title: row.title,
      start_datetime: row.start_datetime,
      eventUrl: row.eventUrl
    }))),
    online_rows: onlineRows,
    non_chicago_rows: nonChicagoRows,
    missing_image_rows: missingImageRows,
    missing_event_url_rows: missingUrlRows
  };

  console.log(JSON.stringify(report, null, 2));
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
