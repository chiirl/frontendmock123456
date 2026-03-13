#!/usr/bin/env node
const fs = require('fs');
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
    urls: [],
    strictUrls: false,
    meetupAuth: false,
    meetupState: '.auth/meetup-state.json'
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
    if (arg === '--meetup-auth') {
      opts.meetupAuth = true;
      continue;
    }
    if (arg === '--meetup-state') {
      opts.meetupState = argv[i + 1] || opts.meetupState;
      i += 1;
      continue;
    }
    if (arg === '--urls') {
      const raw = argv[i + 1] || '';
      opts.urls = raw
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      opts.strictUrls = true;
      i += 1;
      continue;
    }
    if (arg.startsWith('http://') || arg.startsWith('https://')) {
      opts.urls.push(arg);
      opts.strictUrls = true;
    }
  }

  return opts;
}

function canonicalizeUrl(input) {
  try {
    const u = new URL(input);
    const host = u.hostname.toLowerCase();
    if (host.includes('luma.com')) {
      const id = (u.pathname || '').split('/').filter(Boolean)[0];
      if (!id) return null;
      return `https://luma.com/${id}`;
    }
    if (host.includes('mhubchicago.com')) {
      const path = (u.pathname || '').replace(/\/+$/, '');
      return `https://www.mhubchicago.com${path}`;
    }
    if (host.includes('meetup.com')) {
      const parts = (u.pathname || '').split('/').filter(Boolean);
      const eventsIdx = parts.findIndex((p) => p.toLowerCase() === 'events');
      if (eventsIdx >= 1 && parts[eventsIdx + 1]) {
        return `https://www.meetup.com/${parts[eventsIdx - 1]}/events/${parts[eventsIdx + 1]}`;
      }
      const path = (u.pathname || '').replace(/\/+$/, '');
      return `https://www.meetup.com${path}`;
    }
    if (host.includes('eventbrite.com')) {
      const path = (u.pathname || '').replace(/\/+$/, '');
      return `https://www.eventbrite.com${path}`;
    }
    u.hash = '';
    return u.toString();
  } catch {
    return null;
  }
}

async function fetchText(url) {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const maxAttempts = 4;
  let lastStatus = 'network';

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);
    let res;
    try {
      res = await fetch(url, {
        headers: {
          'user-agent': 'chibot/1.0 (+chiirl)'
        },
        signal: controller.signal
      });
    } finally {
      clearTimeout(timeout);
    }
    const status = res.status;
    lastStatus = status;
    if (res.ok) return res.text();

    if (status === 429 || (status >= 500 && status < 600)) {
      await sleep(500 * attempt * attempt);
      continue;
    }
    break;
  }
  throw new Error(`Fetch failed ${lastStatus} for ${url}`);
}

function parseMhubStartDate(raw) {
  // Format: MM/DD/YY @ HH:MM AM
  const m = String(raw || '').match(/(\d{2})\/(\d{2})\/(\d{2})\s*@\s*(\d{1,2}):(\d{2})\s*(AM|PM)/i);
  if (!m) return null;
  const mm = Number(m[1]);
  const dd = Number(m[2]);
  const yyyy = 2000 + Number(m[3]);
  let hh = Number(m[4]);
  const min = m[5];
  const ampm = m[6].toUpperCase();
  if (ampm === 'PM' && hh !== 12) hh += 12;
  if (ampm === 'AM' && hh === 12) hh = 0;

  // Resolve real Chicago UTC offset for that calendar date.
  const probe = new Date(Date.UTC(yyyy, mm - 1, dd, 12, 0, 0));
  const tz = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago',
    timeZoneName: 'shortOffset'
  }).formatToParts(probe).find((p) => p.type === 'timeZoneName')?.value || 'GMT-6';
  const off = tz.replace('GMT', '');
  const mOff = off.match(/^([+-]?)(\d{1,2})(?::(\d{2}))?$/);
  const sign = (mOff?.[1] || '+') === '-' ? '-' : '+';
  const hhOff = String(Number(mOff?.[2] || 0)).padStart(2, '0');
  const mmOff = String(mOff?.[3] || '00').padStart(2, '0');
  const signFixed = `${sign}${hhOff}:${mmOff}`;

  return `${yyyy}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}T${String(hh).padStart(2, '0')}:${min}:00${signFixed}`;
}

function decodeHtmlEntities(s) {
  return String(s || '')
    .replace(/&amp;/g, '&')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ');
}

function extractByIdText(html, id) {
  const re = new RegExp(`<[^>]+id=["']${id}["'][^>]*>([\\s\\S]*?)<\\/[^>]+>`, 'i');
  const m = html.match(re);
  if (!m) return null;
  return decodeHtmlEntities(m[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
}

function parseMhubEvent(html, sourceUrl, includeTagsColumn) {
  const title = extractByIdText(html, 'evTitle') || decodeHtmlEntities(extractMetaContent(html, 'property', 'og:title'));
  const startRaw = extractByIdText(html, 'startDate');
  const startDatetime = parseMhubStartDate(startRaw);
  const location = extractByIdText(html, 'evLocation');
  const description = decodeHtmlEntities((extractMetaContent(html, 'name', 'description') || '').replace(/<[^>]+>/g, ' '));
  const image = extractMetaContent(html, 'property', 'og:image');
  if (!title || !startDatetime) return null;

  const tags = inferEventTags(title, description);
  const primary = inferTechCategory(title, description);
  const normalizedTags = [primary, ...tags.filter((t) => t !== primary)].slice(0, 12);
  const row = {
    title,
    start_datetime: startDatetime,
    Online: /\bvirtual\b|\bonline\b/i.test(location || '') ? 'TRUE' : 'FALSE',
    tags: normalizedTags,
    image_url: image || null,
    eventUrl: sourceUrl,
    location: location || null,
    google_maps_url: null
  };
  if (!includeTagsColumn) {
    throw new Error('Missing `tags` column on target table. Add tags text[] before running chibot.');
  }
  return row;
}

function isLumaUrl(url) {
  try {
    return new URL(url).hostname.toLowerCase().includes('luma.com');
  } catch {
    return false;
  }
}

function isMhubUrl(url) {
  try {
    return new URL(url).hostname.toLowerCase().includes('mhubchicago.com');
  } catch {
    return false;
  }
}

function isMeetupUrl(url) {
  try {
    return new URL(url).hostname.toLowerCase().includes('meetup.com');
  } catch {
    return false;
  }
}

function isEventbriteUrl(url) {
  try {
    return new URL(url).hostname.toLowerCase().includes('eventbrite.com');
  } catch {
    return false;
  }
}

async function fetchEventRows(urls, includeTagsColumn, strictUrlsMode = false) {
  const rows = [];
  const skipped = [];

  for (const url of urls) {
    try {
      const html = await fetchText(url);
      if (isMhubUrl(url)) {
        const row = parseMhubEvent(html, url, includeTagsColumn);
        if (!row) {
          skipped.push({ url, reason: 'missing mHUB title/date' });
          continue;
        }
        rows.push(row);
        continue;
      }

      if (!isLumaUrl(url) && !isMeetupUrl(url) && !isEventbriteUrl(url)) {
        skipped.push({ url, reason: 'unsupported host (only luma + meetup + mhub + eventbrite)' });
        continue;
      }

      const event = extractEventJsonLd(html);
      const ogImage = extractMetaContent(html, 'property', 'og:image');
      if (!event) {
        if (isMeetupUrl(url) && globalMeetupFallback?.enabled) {
          const row = await fetchMeetupEventViaBrowser(url, includeTagsColumn);
          if (row) {
            rows.push(row);
            continue;
          }
        }
        skipped.push({ url, reason: 'missing event JSON-LD' });
        continue;
      }

      if (!strictUrlsMode) {
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
      }

      rows.push(mapToRow(event, url, ogImage, includeTagsColumn));
    } catch (err) {
      skipped.push({ url, reason: err.message });
    }
  }

  return { rows, skipped };
}

let globalMeetupFallback = null;

async function initMeetupFallback(opts) {
  if (!opts.meetupAuth) return null;
  if (!fs.existsSync(opts.meetupState)) {
    throw new Error(`Meetup auth enabled but storage state not found: ${opts.meetupState}`);
  }

  let chromium;
  try {
    ({ chromium } = require('playwright'));
  } catch {
    throw new Error(
      'Meetup auth fallback requires playwright. Install with: npm i -D playwright && npx playwright install chromium'
    );
  }

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ storageState: opts.meetupState });
  return { enabled: true, browser, context };
}

async function closeMeetupFallback(fallback) {
  if (!fallback?.enabled) return;
  await fallback.context.close();
  await fallback.browser.close();
}

async function fetchMeetupEventViaBrowser(url, includeTagsColumn) {
  if (!globalMeetupFallback?.enabled) return null;
  const page = await globalMeetupFallback.context.newPage();
  try {
    const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    if (resp && resp.status() >= 400) return null;
    await page.waitForTimeout(1200);
    const event = await page.evaluate(() => {
      const raw = document.querySelector('#__NEXT_DATA__')?.textContent;
      if (!raw) return null;
      try {
        const next = JSON.parse(raw);
        return next?.props?.pageProps?.event || null;
      } catch {
        return null;
      }
    });
    if (!event) return null;

    const eventUrl = canonicalizeUrl(event.eventUrl || url);
    const location = event.venue
      ? [event.venue.name, event.venue.address, event.venue.city, event.venue.state].filter(Boolean).join(', ')
      : null;
    const description = event.description || '';
    const title = event.title || null;
    if (!title || !event.dateTime || !eventUrl) return null;

    const tags = inferEventTags(title, description);
    const primary = inferTechCategory(title, description);
    const normalizedTags = [primary, ...tags.filter((t) => t !== primary)].slice(0, 12);
    if (!includeTagsColumn) {
      throw new Error('Missing `tags` column on target table. Add tags text[] before running chibot.');
    }

    return {
      title,
      start_datetime: event.dateTime,
      Online: String(event.eventType || '').toUpperCase().includes('ONLINE') ? 'TRUE' : 'FALSE',
      tags: normalizedTags,
      image_url: event.featuredEventPhoto?.source || event.displayPhoto?.source || null,
      eventUrl,
      location,
      google_maps_url: null
    };
  } finally {
    await page.close();
  }
}

function canonicalizeEventUrl(input) {
  return canonicalizeUrl(input);
}

function extractMetaContent(html, attr, value) {
  const escapedValue = String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(
    `<meta[^>]*${attr}=["']${escapedValue}["'][^>]*content=["']([^"']+)["'][^>]*>`,
    'i'
  );
  const m = html.match(re);
  if (m) return decodeHtmlEntities(m[1]);

  const reReverse = new RegExp(
    `<meta[^>]*content=["']([^"']+)["'][^>]*${attr}=["']${escapedValue}["'][^>]*>`,
    'i'
  );
  const mReverse = html.match(reReverse);
  if (!mReverse) return null;
  return decodeHtmlEntities(mReverse[1]);
}

function extractEventJsonLd(html) {
  const isEventType = (value) => {
    if (!value) return false;
    if (Array.isArray(value)) return value.some((v) => isEventType(v));
    const t = String(value).toLowerCase();
    return t === 'event' || t.endsWith('event');
  };

  const findEventNode = (node) => {
    if (!node || typeof node !== 'object') return null;
    if (Array.isArray(node)) {
      for (const item of node) {
        const found = findEventNode(item);
        if (found) return found;
      }
      return null;
    }
    if (isEventType(node['@type'])) return node;
    for (const key of Object.keys(node)) {
      const found = findEventNode(node[key]);
      if (found) return found;
    }
    return null;
  };

  const re = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const raw = m[1].trim();
    try {
      const parsed = JSON.parse(raw);
      const eventItem = findEventNode(parsed);
      if (eventItem) return eventItem;
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
  const normalizedTags = [primary, ...tags.filter((t) => t !== primary)].slice(0, 12);
  const row = {
    title: event.name || null,
    start_datetime: event.startDate || null,
    Online: online,
    tags: normalizedTags,
    image_url: Array.isArray(event.image) ? event.image[0] : fallbackImage,
    eventUrl: event['@id'] || fallbackUrl,
    location: normalizeLocation(event.location),
    google_maps_url: null
  };
  if (!includeTagsColumn) {
    throw new Error('Missing `tags` column on target table. Add tags text[] before running chibot.');
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
  globalMeetupFallback = await initMeetupFallback(opts);
  if (globalMeetupFallback?.enabled) {
    console.log(`Meetup authenticated fallback enabled (state: ${opts.meetupState}).`);
  }

  try {
    let candidateUrls = [];
    if (opts.strictUrls && opts.urls.length > 0) {
      candidateUrls = [...new Set(opts.urls.map(canonicalizeUrl).filter(Boolean))];
      console.log(`Using strict URL mode with ${candidateUrls.length} candidate URLs.`);
    } else {
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

      candidateUrls = await expandCandidatesFromSeeds(
        [...new Set([...cityCandidateUrls, ...dbSeedEventUrls])],
        [...seedPageUrls].slice(0, opts.seedPages),
        opts.max
      );
      console.log(`Found ${candidateUrls.length} candidate URLs (city+db-seeds).`);
      console.log(`Seed event pages scanned: ${dbSeedEventUrls.length}; seed community pages: ${seedPageUrls.size}`);
    }

    const includeTagsColumn = await hasTagsColumn(supabase, table);
    if (!includeTagsColumn) throw new Error('Missing `tags` column on target table.');

    const { rows: hydratedRows, skipped } = await fetchEventRows(candidateUrls, includeTagsColumn, opts.strictUrls);
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
      .select('title,start_datetime,eventUrl,tags');

    if (error) {
      throw new Error(`Insert failed: ${error.message}`);
    }

    console.log(`Inserted ${data.length} new events into ${table}.`);
    data.forEach((row) => {
      console.log(`- ${row.start_datetime} | ${(row.tags || []).join(',')} | ${row.title} | ${row.eventUrl}`);
    });
  } finally {
    await closeMeetupFallback(globalMeetupFallback);
    globalMeetupFallback = null;
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
