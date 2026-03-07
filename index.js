const express = require('express');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const app = express();
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

app.get('/api/events', async (req, res) => {
  const { data, error } = await supabase
    .from('CTC Current Events')
    .select('*');

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

app.get('/', async (req, res) => {
  const { data: events, error } = await supabase
    .from('CTC Current Events')
    .select('*')
    .order('start_datetime', { ascending: true });

  if (error) return res.status(500).send('Error loading events');

  const now = new Date();
  const upcoming = events.filter(e => {
    if (!e.start_datetime) return false;
    const eventDate = new Date(e.start_datetime.replace(' CST', ' GMT-0600').replace(' CDT', ' GMT-0500'));
    return eventDate >= now;
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
  </style>
</head>
<body>
  <h1>CHIIRL | Chicago In Real Life</h1>
  <ul>
    ${deduped.map(e => `
      <li>
        ${e.image_url ? `<img src="${e.image_url}" alt="">` : ''}
        <div><a href="${e.eventUrl || '#'}">${e.title}</a>
        <span class="tag">(${e.Online === 'TRUE' ? 'Online' : 'IRL'})</span><br>
        <span class="date">${formatDate(e.start_datetime)}</span>
        <span class="loc">${e.location || ''}</span>
        ${e.google_maps_url && e.Online !== 'TRUE' ? ` - <a href="${e.google_maps_url}">map</a>` : ''}
        </div>
      </li>
    `).join('')}
  </ul>
</body>
</html>`;

  res.send(html);
});

app.listen(3000, () => console.log('Server running on http://localhost:3000'));
