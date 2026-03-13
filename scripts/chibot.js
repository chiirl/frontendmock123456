#!/usr/bin/env node
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const INCLUDE_KEYWORDS = [
  'ai',
  'artificial intelligence',
  'startup',
  'founder',
  'founders',
  'tech',
  'developer',
  'engineering',
  'hackathon',
  'healthtech',
  'vc',
  'venture',
  'investor',
  'product builder',
  'community meetup'
];

const EXCLUDE_KEYWORDS = [
  'music',
  'party',
  'mahjong',
  'ballet',
  'film',
  'showcase',
  'reception',
  'bowling',
  'bazaar',
  'concert',
  'dj',
  'comedy',
  'art exhibit'
];

function parseArgs(argv) {
  const opts = {
    city: 'chicago',
    max: 20,
    dryRun: false,
    urls: []
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--city') {
      opts.city = argv[i + 1] || opts.city;
      i += 1;
      continue;
    }
    if (arg === '--max') {
      opts.max = Number(argv[i + 1] || opts.max);
      i += 1;
      continue;
    }
    if (arg === '--dry-run') {
      opts.dryRun = true;
      continue;
    }
    if (arg === '--urls') {
      const raw = argv[i + 1] || '';
      opts.urls = raw
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      i += 1;
      continue;
    }
    if (arg.startsWith('http://') || arg.startsWith('https://')) {
      opts.urls.push(arg);
    }
  }

  return opts;
}

function canonicalizeEventUrl(input) {
  try {
    const u = new URL(input);
    if (!u.hostname.includes('luma.com')) return null;
    const id = (u.pathname || '').split('/').filter(Boolean)[0];
    if (!id) return null;
    return `https://luma.com/${id}`;
  } catch {
    return null;
  }
}

async function fetchText(url) {
  const res = await fetch(url, {
    headers: {
      'user-agent': 'chibot/1.0 (+chiirl)'
    }
  });
  if (!res.ok) throw new Error(`Fetch failed ${res.status} for ${url}`);
  return res.text();
}

function extractEventUrlsFromListing(html) {
  const ids = new Set();
  const re = /href="\/([a-z0-9]{8})(?:\?[^\"]*)?"/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    ids.add(m[1]);
  }
  return [...ids].map((id) => `https://luma.com/${id}`);
}

function extractMetaContent(html, attr, name) {
  const re = new RegExp(`<meta\\s+${attr}=["']${name}["']\\s+content=["']([^"']+)["']`, 'i');
  const m = html.match(re);
  return m ? m[1] : null;
}

function extractEventJsonLd(html) {
  const re = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const raw = m[1].trim();
    try {
      const parsed = JSON.parse(raw);
      if (parsed && parsed['@type'] === 'Event') return parsed;
      if (Array.isArray(parsed)) {
        const eventItem = parsed.find((x) => x && x['@type'] === 'Event');
        if (eventItem) return eventItem;
      }
    } catch {
      continue;
    }
  }
  return null;
}

function classifyEvent(title, description) {
  const hay = `${title || ''} ${description || ''}`.toLowerCase();
  const includeHits = INCLUDE_KEYWORDS.filter((k) => hay.includes(k));
  const excludeHits = EXCLUDE_KEYWORDS.filter((k) => hay.includes(k));

  const relevant = includeHits.length > 0 && excludeHits.length === 0;
  const ambiguous = includeHits.length > 0 && excludeHits.length > 0;

  return { relevant, ambiguous, includeHits, excludeHits };
}

function normalizeLocation(location) {
  if (!location) return null;
  if (typeof location.address === 'string') {
    const parts = [location.name, location.address].filter(Boolean);
    return parts.join(', ');
  }

  const address = location.address || {};
  const parts = [
    location.name,
    address.streetAddress,
    address.addressLocality,
    address.addressRegion
  ].filter(Boolean);

  if (parts.length > 0) return parts.join(', ');
  return location.name || null;
}

function inferTechCategory(title, description) {
  const hay = `${title || ''} ${description || ''}`.toLowerCase();
  if (hay.includes('ai') || hay.includes('artificial intelligence') || hay.includes('llm')) {
    return 'AI';
  }
  if (hay.includes('startup') || hay.includes('founder') || hay.includes('venture') || hay.includes('investor')) {
    return 'Startup';
  }
  return 'Tech';
}

function mapToRow(event, fallbackUrl, fallbackImage) {
  const mode = String(event.eventAttendanceMode || '').toLowerCase();
  const online = mode.includes('online') ? 'TRUE' : 'FALSE';

  return {
    title: event.name || null,
    start_datetime: event.startDate || null,
    Online: online,
    tech_category: inferTechCategory(event.name, event.description),
    image_url: Array.isArray(event.image) ? event.image[0] : fallbackImage,
    eventUrl: event['@id'] || fallbackUrl,
    location: normalizeLocation(event.location),
    google_maps_url: null
  };
}

async function loadCandidateUrls(opts) {
  if (opts.urls.length > 0) {
    return [...new Set(opts.urls.map(canonicalizeEventUrl).filter(Boolean))];
  }

  const listingUrl = `https://luma.com/${opts.city}`;
  const html = await fetchText(listingUrl);
  const urls = extractEventUrlsFromListing(html);
  return urls.slice(0, opts.max);
}

async function fetchEventRows(urls) {
  const rows = [];
  const skipped = [];

  for (const url of urls) {
    try {
      const html = await fetchText(url);
      const event = extractEventJsonLd(html);
      const ogImage = extractMetaContent(html, 'property', 'og:image');
      if (!event) {
        skipped.push({ url, reason: 'missing event JSON-LD' });
        continue;
      }

      const cls = classifyEvent(event.name, event.description);
      if (!cls.relevant) {
        const reason = cls.ambiguous
          ? `ambiguous include=${cls.includeHits.join('|')} exclude=${cls.excludeHits.join('|')}`
          : 'not in target founder/startup/tech/ai scope';
        skipped.push({ url, reason });
        continue;
      }

      rows.push(mapToRow(event, url, ogImage));
    } catch (err) {
      skipped.push({ url, reason: err.message });
    }
  }

  return { rows, skipped };
}

function chunk(array, size) {
  const out = [];
  for (let i = 0; i < array.length; i += size) {
    out.push(array.slice(i, i + size));
  }
  return out;
}

async function findExistingEventUrls(supabase, table, eventUrls) {
  const existing = new Set();
  for (const part of chunk(eventUrls, 100)) {
    const { data, error } = await supabase
      .from(table)
      .select('eventUrl')
      .in('eventUrl', part);
    if (error) throw new Error(`Existing lookup failed: ${error.message}`);
    for (const row of data || []) {
      if (row.eventUrl) existing.add(row.eventUrl);
    }
  }
  return existing;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const writeKey = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  const table = process.env.SUPABASE_TABLE || 'beta_chiirl_events';

  if (!process.env.SUPABASE_URL || !writeKey) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_SECRET_KEY in .env');
  }

  const candidateUrls = await loadCandidateUrls(opts);
  console.log(`Found ${candidateUrls.length} candidate URLs.`);

  const { rows, skipped } = await fetchEventRows(candidateUrls);
  console.log(`Relevant rows: ${rows.length}`);
  console.log(`Skipped rows: ${skipped.length}`);

  if (skipped.length > 0) {
    console.log('Skip summary (first 10):');
    skipped.slice(0, 10).forEach((s) => {
      console.log(`- ${s.url} :: ${s.reason}`);
    });
  }

  if (rows.length === 0) {
    console.log('No relevant events found.');
    return;
  }

  if (opts.dryRun) {
    console.log('Dry run payload:');
    console.log(JSON.stringify(rows, null, 2));
    return;
  }

  const supabase = createClient(process.env.SUPABASE_URL, writeKey);

  const normalizedRows = rows.filter((r) => r.title && r.start_datetime && r.eventUrl);
  const existing = await findExistingEventUrls(
    supabase,
    table,
    normalizedRows.map((r) => r.eventUrl)
  );
  const toInsert = normalizedRows.filter((r) => !existing.has(r.eventUrl));

  if (toInsert.length === 0) {
    console.log('No new rows to insert (all already exist).');
    return;
  }

  const { data, error } = await supabase
    .from(table)
    .insert(toInsert)
    .select('title,start_datetime,eventUrl,tech_category');

  if (error) {
    throw new Error(`Insert failed: ${error.message}`);
  }

  console.log(`Inserted ${data.length} new events into ${table}.`);
  data.forEach((row) => {
    console.log(`- ${row.start_datetime} | ${row.tech_category} | ${row.title} | ${row.eventUrl}`);
  });
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
