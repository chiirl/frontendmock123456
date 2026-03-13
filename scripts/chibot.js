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
    max: 200,
    seedScan: 180,
    seedPages: 60,
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
    if (arg === '--seed-scan') {
      opts.seedScan = Number(argv[i + 1] || opts.seedScan);
      i += 1;
      continue;
    }
    if (arg === '--seed-pages') {
      opts.seedPages = Number(argv[i + 1] || opts.seedPages);
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
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const maxAttempts = 4;
  let lastStatus = 'network';

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const res = await fetch(url, {
      headers: {
        'user-agent': 'chibot/1.0 (+chiirl)'
      }
    });
    lastStatus = res.status;
    if (res.ok) return res.text();

    if (res.status === 429 || (res.status >= 500 && res.status < 600)) {
      await sleep(500 * attempt * attempt);
      continue;
    }
    break;
  }
  throw new Error(`Fetch failed ${lastStatus} for ${url}`);
}

function extractEventUrlsFromListing(html) {
  const urls = new Set();
  const reserved = new Set([
    'discover',
    'pricing',
    'help',
    'create',
    'signin',
    'ios',
    'chicago',
    'new-york',
    'los-angeles'
  ]);
  const re = /href="\/([a-z0-9][a-z0-9-]{2,})(?:\?[^\"]*)?"/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const slug = String(m[1] || '').toLowerCase();
    if (reserved.has(slug)) continue;
    urls.add(`https://luma.com/${slug}`);
  }
  return [...urls];
}

function extractCalendarUrlsFromListing(html) {
  const urls = new Set();
  const re = /href="\/([^"\/?#]+)\?k=c"/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const slug = m[1];
    // Ignore obvious non-calendar paths.
    if (['discover', 'pricing', 'signin', 'help', 'create'].includes(slug.toLowerCase())) continue;
    urls.add(`https://luma.com/${slug}?k=c`);
  }
  return [...urls];
}

function extractSeedPagesFromHtml(html) {
  const out = new Set();
  const calendarRe = /href="(\/[^"?#]+\\?k=c)"/gi;
  let m;
  while ((m = calendarRe.exec(html)) !== null) {
    out.add(`https://luma.com${m[1]}`);
  }

  const userRe = /href="(\/user\/[^"?#]+)"/gi;
  while ((m = userRe.exec(html)) !== null) {
    out.add(`https://luma.com${m[1]}`);
  }
  return [...out];
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
  const includeRules = [
    ['ai', /\bai\b|\bartificial intelligence\b|\bllm(s)?\b|\bgenai\b/],
    ['startup', /\bstartup(s)?\b|\bstart-up(s)?\b|\bincubator\b|\baccelerator\b/],
    ['founder', /\bfounder(s)?\b|\bcofounder(s)?\b|\bco-founder(s)?\b|\bentrepreneur(s)?\b/],
    ['tech', /\btech\b|\bdeveloper(s)?\b|\bengineering\b|\bsoftware\b/],
    ['hackathon', /\bhackathon(s)?\b|\bbuildathon(s)?\b/],
    ['healthtech', /\bhealthtech\b|\bdigital health\b/],
    ['venture', /\bvc\b|\bventure\b|\binvestor(s)?\b|\bfundraising\b/],
    ['community meetup', /\bmeetup(s)?\b|\bnetworking\b|\bcommunity\b/]
  ];
  const excludeRules = EXCLUDE_KEYWORDS.map((k) => [k, new RegExp(`\\b${k.replace(/\s+/g, '\\\\s+')}\\b`)]);

  const includeHits = includeRules
    .filter(([, re]) => re.test(hay))
    .map(([label]) => label);
  const excludeHits = excludeRules
    .filter(([, re]) => re.test(hay))
    .map(([label]) => label);

  const relevant = includeHits.length > 0 && excludeHits.length === 0;
  const ambiguous = includeHits.length > 0 && excludeHits.length > 0;

  return { relevant, ambiguous, includeHits, excludeHits };
}

function isChicagoAreaEvent(event) {
  const addr = event?.location?.address || {};
  const name = String(event?.location?.name || '').toLowerCase();
  const street = String(typeof addr === 'string' ? addr : addr.streetAddress || '').toLowerCase();
  const locality = String(typeof addr === 'string' ? '' : addr.addressLocality || '').toLowerCase();
  const region = String(typeof addr === 'string' ? '' : addr.addressRegion || '').toLowerCase();

  const text = `${name} ${street} ${locality} ${region}`;
  if (/\bchicago\b|\bchicagoland\b|\bschaumburg\b|\bevanston\b|\boak park\b/.test(text)) {
    return true;
  }
  if (region === 'illinois' && (locality === 'chicago' || locality === 'schaumburg')) {
    return true;
  }

  const lat = Number(event?.location?.geo?.latitude ?? event?.location?.latitude);
  const lon = Number(event?.location?.geo?.longitude ?? event?.location?.longitude);
  if (!Number.isNaN(lat) && !Number.isNaN(lon)) {
    // Rough Chicago metro bounding box.
    if (lat >= 41.3 && lat <= 42.4 && lon >= -88.4 && lon <= -87.3) {
      return true;
    }
  }

  return false;
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
  const tags = inferEventTags(title, description);
  if (tags.includes('AI')) {
    return 'AI';
  }
  if (tags.includes('Startup') || tags.includes('Founder') || tags.includes('Venture')) {
    return 'Startup';
  }
  return 'Tech';
}

function inferEventTags(title, description) {
  const hay = `${title || ''} ${description || ''}`.toLowerCase();
  const tags = [];
  const hasAny = (patterns) => patterns.some((re) => re.test(hay));
  const rules = [
    ['AI', [/\bai\b/, /\bartificial intelligence\b/, /\bllm(s)?\b/, /\bgenai\b/, /\bmachine learning\b/, /\bdeepmind\b/, /\bclaude\b/, /\bopenai\b/]],
    ['Startup', [/\bstartup(s)?\b/, /\bstart-up(s)?\b/, /\bearly stage\b/, /\bincubator\b/, /\baccelerator\b/]],
    ['Founder', [/\bfounder(s)?\b/, /\bcofounder(s)?\b/, /\bco-founder(s)?\b/, /\bentrepreneur(s)?\b/]],
    ['Venture', [/\bvc\b/, /\bventure\b/, /\bangel investor(s)?\b/, /\bfundraising\b/, /\bpitch\b/]],
    ['Hackathon', [/\bhackathon(s)?\b/, /\bbuildathon(s)?\b/]],
    ['Developer', [/\bdeveloper(s)?\b/, /\bengineering\b/, /\bsoftware engineer(s)?\b/, /\bcoding\b/, /\bcode\b/]],
    ['HealthTech', [/\bhealthtech\b/, /\bdigital health\b/, /\bhealthcare ai\b/]],
    ['FinTech', [/\bfintech\b/, /\bcrypto\b/, /\bdefi\b/, /\bweb3\b/, /\bblockchain\b/]],
    ['Data', [/\bdata science\b/, /\banalytics\b/, /\bdata engineer(s)?\b/, /\bdata\b/]],
    ['Product', [/\bproduct manager(s)?\b/, /\bproduct\b/, /\bux\b/, /\bdesign\b/]],
    ['Networking', [/\bmeetup(s)?\b/, /\bnetworking\b/, /\bcommunity\b/, /\bmixer\b/]],
    ['Workshop', [/\bworkshop(s)?\b/, /\bmasterclass(es)?\b/, /\bbootcamp(s)?\b/]],
    ['Panel', [/\bpanel(s)?\b/, /\bfireside chat\b/, /\broundtable(s)?\b/, /\bdiscussion(s)?\b/]]
  ];

  for (const [tag, patterns] of rules) {
    if (hasAny(patterns)) tags.push(tag);
  }

  // Ensure we always have at least one useful umbrella tag.
  if (!tags.includes('Tech')) tags.push('Tech');

  // Deduplicate with stable order.
  return [...new Set(tags)];
}

function mapToRow(event, fallbackUrl, fallbackImage, includeTagsColumn) {
  const mode = String(event.eventAttendanceMode || '').toLowerCase();
  const online = mode.includes('online') ? 'TRUE' : 'FALSE';
  const tags = inferEventTags(event.name, event.description);
  const primary = inferTechCategory(event.name, event.description);
  const row = {
    title: event.name || null,
    start_datetime: event.startDate || null,
    Online: online,
    tech_category: primary,
    image_url: Array.isArray(event.image) ? event.image[0] : fallbackImage,
    eventUrl: event['@id'] || fallbackUrl,
    location: normalizeLocation(event.location),
    google_maps_url: null
  };
  if (includeTagsColumn) {
    row.tags = [primary, ...tags.filter((t) => t !== primary)].slice(0, 12);
  } else {
    // Backward-compatible fallback if tags column doesn't exist yet.
    row.tech_category = [primary, ...tags.filter((t) => t !== primary)].slice(0, 6).join('|');
  }

  return row;
}

async function loadCandidateUrls(opts) {
  if (opts.urls.length > 0) {
    return [...new Set(opts.urls.map(canonicalizeEventUrl).filter(Boolean))];
  }

  const listingUrl = `https://luma.com/${opts.city}`;
  const html = await fetchText(listingUrl);
  const directEventUrls = extractEventUrlsFromListing(html);
  const calendarUrls = extractCalendarUrlsFromListing(html).slice(0, 20);
  const allUrls = new Set(directEventUrls);

  for (const calendarUrl of calendarUrls) {
    try {
      const calendarHtml = await fetchText(calendarUrl);
      const calEventUrls = extractEventUrlsFromListing(calendarHtml);
      for (const u of calEventUrls) allUrls.add(u);
    } catch {
      // Ignore broken calendar pages and continue.
    }
  }

  return [...allUrls].slice(0, opts.max);
}

async function loadSeedUrlsFromDb(supabase, scanLimit) {
  const out = new Set();
  const tables = [
    process.env.SUPABASE_TABLE || 'beta_chiirl_events',
    process.env.SUPABASE_INACCURATE_TABLE || 'CTC Current Events'
  ];
  const ctcW3WBoost = [];

  for (const table of tables) {
    const { data, error } = await supabase
      .from(table)
      .select('eventUrl,title')
      .limit(2000);
    if (error) continue;

    for (const row of data || []) {
      const normalized = canonicalizeEventUrl(String(row.eventUrl || '').trim());
      if (!normalized) continue;
      out.add(normalized);

      const marker = `${row.title || ''} ${row.eventUrl || ''}`.toLowerCase();
      if (/\bw3w\b|what ?3 ?words|grassroots tech|chicago tech community|ctc/.test(marker)) {
        ctcW3WBoost.push(normalized);
      }
    }
  }

  const prioritized = [...new Set([...ctcW3WBoost, ...out])];
  return prioritized.slice(0, scanLimit);
}

async function expandCandidatesFromSeeds(baseUrls, seedPageUrls, max) {
  const all = new Set(baseUrls.map(canonicalizeEventUrl).filter(Boolean));
  const queue = [...seedPageUrls];

  for (const url of queue) {
    try {
      const html = await fetchText(url);
      const eventUrls = extractEventUrlsFromListing(html);
      for (const eventUrl of eventUrls) {
        const canonical = canonicalizeEventUrl(eventUrl);
        if (canonical) all.add(canonical);
      }
      if (all.size >= max) break;
    } catch {
      // Ignore failed seed pages.
    }
  }

  return [...all].slice(0, max);
}

async function fetchEventRows(urls, includeTagsColumn) {
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
      if (!isChicagoAreaEvent(event)) {
        skipped.push({ url, reason: 'not in Chicago area' });
        continue;
      }

      rows.push(mapToRow(event, url, ogImage, includeTagsColumn));
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

async function hasTagsColumn(supabase, table) {
  const { error } = await supabase.from(table).select('tags').limit(1);
  return !error;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const writeKey = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  const table = process.env.SUPABASE_TABLE || 'beta_chiirl_events';

  if (!process.env.SUPABASE_URL || !writeKey) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_SECRET_KEY in .env');
  }

  const supabase = createClient(process.env.SUPABASE_URL, writeKey);

  let cityCandidateUrls = [];
  try {
    cityCandidateUrls = await loadCandidateUrls(opts);
  } catch (err) {
    console.log(`City listing unavailable (${err.message}); continuing with DB seeds.`);
  }
  const dbSeedEventUrls = await loadSeedUrlsFromDb(supabase, opts.seedScan);
  const seedPageUrls = new Set();

  for (const eventUrl of dbSeedEventUrls) {
    try {
      const html = await fetchText(eventUrl);
      const pages = extractSeedPagesFromHtml(html);
      for (const p of pages) seedPageUrls.add(p);
    } catch {
      // Ignore individual failed event pages while mining seeds.
    }
    if (seedPageUrls.size >= opts.seedPages) break;
  }

  const candidateUrls = await expandCandidatesFromSeeds(
    [...new Set([...cityCandidateUrls, ...dbSeedEventUrls])],
    [...seedPageUrls].slice(0, opts.seedPages),
    opts.max
  );
  console.log(`Found ${candidateUrls.length} candidate URLs (city+db-seeds).`);
  console.log(`Seed event pages scanned: ${dbSeedEventUrls.length}; seed community pages: ${seedPageUrls.size}`);

  const includeTagsColumn = await hasTagsColumn(supabase, table);
  if (!includeTagsColumn) {
    console.log('No `tags` column detected; storing richer tags in `tech_category` pipe format.');
  }

  const { rows: hydratedRows, skipped } = await fetchEventRows(candidateUrls, includeTagsColumn);
  console.log(`Relevant rows: ${hydratedRows.length}`);
  console.log(`Skipped rows: ${skipped.length}`);
  if (skipped.length > 0) {
    console.log('Skip summary (first 10):');
    skipped.slice(0, 10).forEach((s) => {
      console.log(`- ${s.url} :: ${s.reason}`);
    });
  }

  if (hydratedRows.length === 0) {
    console.log('No relevant events found.');
    return;
  }

  if (opts.dryRun) {
    console.log('Dry run payload:');
    console.log(JSON.stringify(hydratedRows, null, 2));
    return;
  }

  const normalizedRows = hydratedRows.filter((r) => r.title && r.start_datetime && r.eventUrl);
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
