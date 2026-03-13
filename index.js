const express = require('express');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const app = express();
const supabaseReadKey =
  process.env.SUPABASE_PUBLISHABLE_KEY ||
  process.env.SUPABASE_ANON_KEY ||
  process.env.SUPABASE_KEY;
if (!process.env.SUPABASE_URL || !supabaseReadKey) {
  throw new Error('Missing SUPABASE_URL or SUPABASE_PUBLISHABLE_KEY');
}
const supabase = createClient(process.env.SUPABASE_URL, supabaseReadKey);
const REAL_TABLE_NAME = process.env.SUPABASE_TABLE || 'beta_chiirl_events';
const INACCURATE_TABLE_NAME = process.env.SUPABASE_INACCURATE_TABLE || 'CTC Current Events';

function getSource(req) {
  return req.query.source === 'inaccurate' ? 'inaccurate' : 'real';
}

function getTableName(source) {
  return source === 'inaccurate' ? INACCURATE_TABLE_NAME : REAL_TABLE_NAME;
}

function buildUrl(path, source, params = {}) {
  const query = new URLSearchParams({ source });
  Object.entries(params).forEach(([k, v]) => {
    if (v != null && v !== '') query.set(k, v);
  });
  const qs = query.toString();
  return qs ? `${path}?${qs}` : path;
}

app.get('/api/events', async (req, res) => {
  const source = getSource(req);
  const tableName = getTableName(source);
  const { data, error } = await supabase
    .from(tableName)
    .select('*');

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

app.get('/', async (req, res) => {
  const source = getSource(req);
  const tableName = getTableName(source);
  const { data: events, error } = await supabase
    .from(tableName)
    .select('*')
    .order('start_datetime', { ascending: true });

  if (error) return res.status(500).send('Error loading events');

  const now = new Date();
  const todayChicago = new Date(now.toLocaleString('en-US', { timeZone: 'America/Chicago' }));
  todayChicago.setHours(0, 0, 0, 0);
  const upcoming = events.filter(e => {
    if (!e.start_datetime) return false;
    const eventDate = new Date(e.start_datetime.replace(/ [A-Z]{3,4}$/, ''));
    return eventDate >= todayChicago;
  });

  function formatDate(raw) {
    if (!raw) return '';
    const d = new Date(raw.replace(' CST', ' GMT-0600').replace(' CDT', ' GMT-0500'));
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    let hours = d.getHours();
    const ampm = hours >= 12 ? 'pm' : 'am';
    hours = hours % 12 || 12;
    const mins = d.getMinutes().toString().padStart(2, '0');
    return `${days[d.getDay()]}, ${months[d.getMonth()]} ${d.getDate()} ${hours}:${mins}${ampm}`;
  }

  const seen = new Set();
  const deduped = upcoming.filter(e => {
    const key = `${e.title}|${e.start_datetime}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const categoryFilter = req.query.category || '';
  const modeFilter = req.query.mode || '';
  const filtered = deduped.filter(e => {
    if (categoryFilter && e.tech_category !== categoryFilter) return false;
    if (modeFilter === 'online' && e.Online !== 'TRUE') return false;
    if (modeFilter === 'irl' && e.Online === 'TRUE') return false;
    return true;
  });

  const categories = [...new Set(deduped.map(e => e.tech_category).filter(Boolean))].sort();

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>CHIIRL | Chicago In Real Life</title>
  <style>
    body { font-family: arial, helvetica, sans-serif; font-size: 14px; background: #f0f0e8; color: #222; margin: 0; padding: 10px; }
    a { color: #00c; }
    a:visited { color: #551a8b; }
    h1 { font-size: 18px; background: #800080; color: #fff; padding: 4px 8px; margin-bottom: 8px; }
    ul { list-style: none; padding: 0; max-width: 800px; }
    li { padding: 4px 0; border-bottom: 1px solid #ccc; display: flex; align-items: center; gap: 8px; }
    li img { width: 50px; height: 50px; object-fit: cover; border-radius: 4px; flex-shrink: 0; }
    .date { color: #666; font-size: 12px; }
    .loc { color: #888; font-size: 12px; }
    .tag { font-size: 11px; color: #555; }
    .tabs { margin-bottom: 10px; max-width: 800px; }
    .tabs a { display: inline-block; padding: 4px 10px; margin-right: 4px; font-size: 12px; text-decoration: none; border: 1px solid #999; color: #222; background: #e8e8e0; }
    .tabs a.active { background: #800080; color: #fff; border-color: #800080; }
    .tabs a:visited { color: #222; }
    .tabs a.active:visited { color: #fff; }
    .filters { margin-bottom: 10px; max-width: 800px; }
    .filters a { display: inline-block; padding: 2px 8px; margin: 2px; font-size: 12px; text-decoration: none; border: 1px solid #999; color: #222; background: #e8e8e0; }
    .filters a.active { background: #800080; color: #fff; border-color: #800080; }
    .filters a:visited { color: #222; }
    .filters a.active:visited { color: #fff; }
  </style>
</head>
<body>
  <h1>CHIIRL | Chicago In Real Life</h1>
  <div class="tabs">
    <a href="${buildUrl('/', 'real', { category: categoryFilter, mode: modeFilter })}"${source === 'real' ? ' class="active"' : ''}>Real Data</a>
    <a href="${buildUrl('/', 'inaccurate', { category: categoryFilter, mode: modeFilter })}"${source === 'inaccurate' ? ' class="active"' : ''}>Inaccurate Data</a>
  </div>
  <p><a href="${buildUrl('/archive', source)}">archive</a> | <a href="${buildUrl('/raw', source)}">raw table</a></p>
  <div class="filters">
    <a href="${buildUrl('/', source)}"${!categoryFilter && !modeFilter ? ' class="active"' : ''}>All</a>
    <a href="${buildUrl('/', source, { mode: 'irl' })}"${modeFilter === 'irl' ? ' class="active"' : ''}>IRL</a>
    <a href="${buildUrl('/', source, { mode: 'online' })}"${modeFilter === 'online' ? ' class="active"' : ''}>Online</a>
    |
    ${categories.map(c => `<a href="${buildUrl('/', source, { category: c, mode: modeFilter })}"${categoryFilter === c ? ' class="active"' : ''}>${c}</a>`).join('')}
  </div>
  <ul>
    ${filtered.map(e => `
      <li>
        ${e.image_url ? `<img src="${e.image_url}" alt="">` : ''}
        <div><a href="${e.eventUrl || '#'}">${e.title}</a>
        <span class="tag">(${e.Online === 'TRUE' ? 'Online' : 'IRL'})</span><br>
        <span class="date">${formatDate(e.start_datetime)}</span>
        <span class="loc">${e.location || ''}</span>
        ${e.google_maps_url && e.Online !== 'TRUE' ? ` - <a href="${e.google_maps_url}">map</a>` : ''}
        - <a href="${buildUrl('/event', source, { title: e.title, date: e.start_datetime || '' })}">raw</a>
        </div>
      </li>
    `).join('')}
  </ul>
</body>
</html>`;

  res.send(html);
});

app.get('/event', async (req, res) => {
  const { title, date } = req.query;
  const source = getSource(req);
  const tableName = getTableName(source);
  if (!title) return res.status(400).send('Missing title');

  let query = supabase.from(tableName).select('*').eq('title', title);
  if (date) query = query.eq('start_datetime', date);
  const { data, error } = await query;

  if (error) return res.status(500).send('Error loading event');
  const event = data && data[0];
  if (!event) return res.status(404).send('Event not found');

  const fields = Object.entries(event).filter(([, v]) => v != null && v !== '');

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${event.title} | CHIIRL</title>
  <style>
    body { font-family: arial, helvetica, sans-serif; font-size: 14px; background: #f0f0e8; color: #222; margin: 0; padding: 10px; }
    a { color: #00c; }
    h1 { font-size: 18px; background: #800080; color: #fff; padding: 4px 8px; margin-bottom: 8px; }
    .tabs { margin-bottom: 10px; max-width: 800px; }
    .tabs a { display: inline-block; padding: 4px 10px; margin-right: 4px; font-size: 12px; text-decoration: none; border: 1px solid #999; color: #222; background: #e8e8e0; }
    .tabs a.active { background: #800080; color: #fff; border-color: #800080; }
    .tabs a:visited { color: #222; }
    .tabs a.active:visited { color: #fff; }
    table { border-collapse: collapse; max-width: 800px; }
    th, td { border: 1px solid #999; padding: 4px 8px; text-align: left; vertical-align: top; }
    th { background: #ddd; width: 150px; }
    td { max-width: 600px; word-wrap: break-word; }
  </style>
</head>
<body>
  <h1>${event.title}</h1>
  <div class="tabs">
    <a href="${buildUrl('/event', 'real', { title, date })}"${source === 'real' ? ' class="active"' : ''}>Real Data</a>
    <a href="${buildUrl('/event', 'inaccurate', { title, date })}"${source === 'inaccurate' ? ' class="active"' : ''}>Inaccurate Data</a>
  </div>
  <p><a href="${buildUrl('/', source)}">back</a></p>
  <table>
    ${fields.map(([k, v]) => `<tr><th>${k}</th><td>${v}</td></tr>`).join('')}
  </table>
</body>
</html>`;

  res.send(html);
});

app.get('/archive', async (req, res) => {
  const source = getSource(req);
  const tableName = getTableName(source);
  const { data: events, error } = await supabase
    .from(tableName)
    .select('*')
    .order('start_datetime', { ascending: false });

  if (error) return res.status(500).send('Error loading events');

  const currentYear = new Date().getFullYear();
  function formatDate(raw) {
    if (!raw) return '';
    const d = new Date(raw.replace(' CST', ' GMT-0600').replace(' CDT', ' GMT-0500'));
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    let hours = d.getHours();
    const ampm = hours >= 12 ? 'pm' : 'am';
    hours = hours % 12 || 12;
    const mins = d.getMinutes().toString().padStart(2, '0');
    const year = d.getFullYear() < currentYear ? ` ${d.getFullYear()}` : '';
    return `${days[d.getDay()]}, ${months[d.getMonth()]} ${d.getDate()}${year} ${hours}:${mins}${ampm}`;
  }

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>CHIIRL | Archive</title>
  <style>
    body { font-family: arial, helvetica, sans-serif; font-size: 14px; background: #f0f0e8; color: #222; margin: 0; padding: 10px; }
    a { color: #00c; }
    a:visited { color: #551a8b; }
    h1 { font-size: 18px; background: #800080; color: #fff; padding: 4px 8px; margin-bottom: 8px; }
    ul { list-style: none; padding: 0; max-width: 800px; }
    li { padding: 4px 0; border-bottom: 1px solid #ccc; display: flex; align-items: center; gap: 8px; }
    li img { width: 50px; height: 50px; object-fit: cover; border-radius: 4px; flex-shrink: 0; }
    .date { color: #666; font-size: 12px; }
    .loc { color: #888; font-size: 12px; }
    .tag { font-size: 11px; color: #555; }
    .tabs { margin-bottom: 10px; max-width: 800px; }
    .tabs a { display: inline-block; padding: 4px 10px; margin-right: 4px; font-size: 12px; text-decoration: none; border: 1px solid #999; color: #222; background: #e8e8e0; }
    .tabs a.active { background: #800080; color: #fff; border-color: #800080; }
    .tabs a:visited { color: #222; }
    .tabs a.active:visited { color: #fff; }
  </style>
</head>
<body>
  <h1>CHIIRL | Archive</h1>
  <div class="tabs">
    <a href="${buildUrl('/archive', 'real')}"${source === 'real' ? ' class="active"' : ''}>Real Data</a>
    <a href="${buildUrl('/archive', 'inaccurate')}"${source === 'inaccurate' ? ' class="active"' : ''}>Inaccurate Data</a>
  </div>
  <p><a href="${buildUrl('/', source)}">back to upcoming</a></p>
  <ul>
    ${events.map(e => `
      <li>
        ${e.image_url ? `<img src="${e.image_url}" alt="">` : ''}
        <div><a href="${e.eventUrl || '#'}">${e.title}</a>
        <span class="tag">(${e.Online === 'TRUE' ? 'Online' : 'IRL'})</span><br>
        <span class="date">${formatDate(e.start_datetime)}</span>
        <span class="loc">${e.location || ''}</span>
        - <a href="${buildUrl('/event', source, { title: e.title, date: e.start_datetime || '' })}">raw</a>
        </div>
      </li>
    `).join('')}
  </ul>
</body>
</html>`;

  res.send(html);
});

app.get('/raw', async (req, res) => {
  const source = getSource(req);
  const tableName = getTableName(source);
  const { data: events, error } = await supabase
    .from(tableName)
    .select('*')
    .order('start_datetime', { ascending: true });

  if (error) return res.status(500).send('Error loading events');

  const cols = Object.keys(events[0] || {});

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>CHIIRL | Raw Data</title>
  <style>
    body { font-family: arial, helvetica, sans-serif; font-size: 12px; background: #f0f0e8; color: #222; margin: 0; padding: 10px; }
    a { color: #00c; }
    h1 { font-size: 18px; background: #800080; color: #fff; padding: 4px 8px; margin-bottom: 8px; }
    .tabs { margin-bottom: 10px; max-width: 100%; }
    .tabs a { display: inline-block; padding: 4px 10px; margin-right: 4px; font-size: 12px; text-decoration: none; border: 1px solid #999; color: #222; background: #e8e8e0; }
    .tabs a.active { background: #800080; color: #fff; border-color: #800080; }
    .tabs a:visited { color: #222; }
    .tabs a.active:visited { color: #fff; }
    table { border-collapse: collapse; width: 100%; }
    th, td { border: 1px solid #999; padding: 3px 6px; text-align: left; max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    th { background: #ddd; position: sticky; top: 0; }
    tr:nth-child(even) { background: #e8e8e0; }
  </style>
</head>
<body>
  <h1>CHIIRL | Raw Data</h1>
  <div class="tabs">
    <a href="${buildUrl('/raw', 'real')}"${source === 'real' ? ' class="active"' : ''}>Real Data</a>
    <a href="${buildUrl('/raw', 'inaccurate')}"${source === 'inaccurate' ? ' class="active"' : ''}>Inaccurate Data</a>
  </div>
  <p><a href="${buildUrl('/', source)}">back</a></p>
  <table>
    <tr>${cols.map(c => `<th>${c}</th>`).join('')}</tr>
    ${events.map(e => `<tr>${cols.map(c => `<td>${e[c] != null ? e[c] : ''}</td>`).join('')}</tr>`).join('')}
  </table>
</body>
</html>`;

  res.send(html);
});

app.listen(3000, () => console.log('Server running on http://localhost:3000'));
