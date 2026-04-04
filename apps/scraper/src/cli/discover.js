#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
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
  'venture capital',
  'investor',
  'product',
  'design',
  'security',
  'cybersecurity',
  'data science',
  'data',
  'cloud',
  'cloud native',
  'quantum',
  'book club',
  'speaker series',
  'workshop',
  'seminar',
  'bitcoin',
  'linux',
  'robotics',
  'product builder',
  'community meetup'
];

const EXCLUDE_KEYWORDS = [
  'music',
  'party',
  'mahjong',
  'ballet',
  'bowling',
  'bazaar',
  'concert',
  'dj',
  'comedy',
  'art exhibit'
];

const SCRAPE_DUMP_DIR = '.scrape-dumps';
const SEED_PAGE_CACHE_FILE = 'seed-pages-cache.json';
const CURATED_SEED_FILE = 'event-seeds.json';
const FETCH_TIMEOUT_MS = 10000;
const FETCH_TOTAL_BUDGET_MS = 15000;
const MAX_FETCH_ATTEMPTS = 3;
const DEFAULT_HOST_POLICY = { concurrency: 1, delayMs: 200 };
const HOST_POLICIES = {
  'luma.com': { concurrency: 1, delayMs: 300 },
  'lu.ma': { concurrency: 1, delayMs: 300 },
  'www.meetup.com': { concurrency: 2, delayMs: 150 },
  'meetup.com': { concurrency: 2, delayMs: 150 },
  'www.eventbrite.com': { concurrency: 2, delayMs: 150 },
  'eventbrite.com': { concurrency: 2, delayMs: 150 },
  'www.mhubchicago.com': { concurrency: 1, delayMs: 150 }
};
const LUMA_HOSTS = new Set(['luma.com', 'lu.ma']);
const _hostRuntimePolicies = new Map();
const _hostStats = new Map();

function parseArgs(argv) {
  const opts = {
    city: 'chicago',
    max: 200,
    seedScan: 180,
    seedPages: 60,
    concurrency: 8,
    dryRun: false,
    weekly: false,
    urls: [],
    strictUrls: false,
    meetupAuth: false,
    meetupState: '.auth/meetup-state.json',
    lumaConcurrency: null,
    lumaDelayMs: null
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
    if (arg === '--concurrency') {
      opts.concurrency = Number(argv[i + 1] || opts.concurrency);
      i += 1;
      continue;
    }
    if (arg === '--dry-run') {
      opts.dryRun = true;
      continue;
    }
    if (arg === '--weekly') {
      opts.weekly = true;
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
    if (arg === '--luma-concurrency') {
      opts.lumaConcurrency = Number(argv[i + 1] || opts.lumaConcurrency);
      i += 1;
      continue;
    }
    if (arg === '--luma-delay-ms') {
      opts.lumaDelayMs = Number(argv[i + 1] || opts.lumaDelayMs);
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
    if (host.includes('luma.com') || host.includes('lu.ma')) {
      const parts = (u.pathname || '').split('/').filter(Boolean);
      const id = parts[0];
      if (!id || parts.length !== 1 || id.startsWith('@') || LUMA_NON_EVENT_ROUTES.test(id)) return null;
      return `https://luma.com/${id}`;
    }
    if (host.includes('mhubchicago.com')) {
      const path = (u.pathname || '').replace(/\/+$/, '');
      return `https://www.mhubchicago.com${path}`;
    }
    if (host.includes('meetup.com')) {
      const parts = (u.pathname || '').split('/').filter(Boolean);
      const eventsIdx = parts.findIndex((p) => p.toLowerCase() === 'events');
      const eventId = parts[eventsIdx + 1];
      if (eventsIdx >= 1 && eventId && /^\d+$/.test(eventId) && !MEETUP_NON_EVENT_SEGMENTS.has(eventId.toLowerCase())) {
        return `https://www.meetup.com/${parts[eventsIdx - 1]}/events/${eventId}`;
      }
      const path = (u.pathname || '').replace(/\/+$/, '');
      return `https://www.meetup.com${path}`;
    }
    if (host.includes('eventbrite.com')) {
      const path = (u.pathname || '').replace(/\/+$/, '');
      if (!/^\/e\//.test(path)) return null;
      return `https://www.eventbrite.com${path}`;
    }
    if (host.includes('letsdofunthings.org')) {
      const path = (u.pathname || '').replace(/\/+$/, '');
      if (!/^\/events\//.test(path)) return null;
      return `https://www.letsdofunthings.org${path}`;
    }
    if (
      host.includes('startupgrind.com') ||
      host === 'fi.co' ||
      host.includes('maps.apple.com')
    ) {
      return null;
    }
    u.hash = '';
    u.search = '';
    return u.toString().replace(/\/+$/, '');
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Per-host throttle: serializes requests to the same host with a delay
// between them so concurrent workers don't burst the same domain.
// ---------------------------------------------------------------------------
const _hostLanes = new Map();

const LUMA_NON_EVENT_ROUTES = /^(chicago|new-york|sf|explore|pricing|about|blog|login|signin|signup|search|discover|create|ios|android|download|app)$/i;
const MEETUP_NON_EVENT_SEGMENTS = new Set(['calendar', 'past', 'about', 'photos']);

function getHostPolicy(host) {
  return _hostRuntimePolicies.get(host) || HOST_POLICIES[host] || DEFAULT_HOST_POLICY;
}

function getHostStats(host) {
  if (!_hostStats.has(host)) {
    _hostStats.set(host, {
      requests: 0,
      ok: 0,
      status429: 0,
      failures: 0,
      timeouts: 0,
      adapted: false,
      promoted: false
    });
  }
  return _hostStats.get(host);
}

function resetHostRuntimePolicies(opts) {
  _hostRuntimePolicies.clear();
  _hostStats.clear();

  if (opts?.lumaConcurrency || opts?.lumaDelayMs) {
    const base = HOST_POLICIES['luma.com'];
    const override = {
      concurrency: opts.lumaConcurrency || base.concurrency,
      delayMs: opts.lumaDelayMs || base.delayMs
    };
    for (const host of LUMA_HOSTS) {
      _hostRuntimePolicies.set(host, { ...override });
    }
  }
}

function maybeAdaptHostPolicy(host, status) {
  if (!LUMA_HOSTS.has(host) || status !== 429) return;

  const current = { ...getHostPolicy(host) };
  const stats = getHostStats(host);
  stats.status429 += 1;

  const next = {
    concurrency: 1,
    delayMs: Math.max(600, current.delayMs + 200)
  };

  const changed =
    current.concurrency !== next.concurrency ||
    current.delayMs !== next.delayMs;

  for (const lumaHost of LUMA_HOSTS) {
    _hostRuntimePolicies.set(lumaHost, { ...next });
  }

  if (changed && !stats.adapted) {
    console.log(
      `Luma adaptive backoff engaged after 429: concurrency ${current.concurrency} -> ${next.concurrency}, delay ${current.delayMs}ms -> ${next.delayMs}ms`
    );
  }
  stats.adapted = true;
}

function maybePromoteHostPolicy(host) {
  if (!LUMA_HOSTS.has(host)) return;
  const stats = getHostStats(host);
  if (stats.promoted || stats.status429 > 0 || stats.ok < 8) return;

  const current = { ...getHostPolicy(host) };
  if (current.concurrency >= 2 && current.delayMs <= 200) {
    stats.promoted = true;
    return;
  }

  const next = {
    concurrency: 2,
    delayMs: 200
  };

  for (const lumaHost of LUMA_HOSTS) {
    _hostRuntimePolicies.set(lumaHost, { ...next });
  }

  stats.promoted = true;
  console.log(
    `Luma adaptive ramp-up engaged after clean streak: concurrency ${current.concurrency} -> ${next.concurrency}, delay ${current.delayMs}ms -> ${next.delayMs}ms`
  );
}

async function withHostThrottle(host, fn) {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const { concurrency, delayMs } = getHostPolicy(host);
  let lanes = _hostLanes.get(host);
  if (!lanes || lanes.length !== concurrency) {
    lanes = Array.from({ length: concurrency }, () => ({
      readyAt: 0,
      promise: Promise.resolve()
    }));
    _hostLanes.set(host, lanes);
  }

  let lane = lanes[0];
  for (const candidate of lanes) {
    if (candidate.readyAt < lane.readyAt) lane = candidate;
  }

  const scheduledStart = Math.max(Date.now(), lane.readyAt);
  lane.readyAt = scheduledStart + delayMs;
  lane.promise = lane.promise
    .catch(() => {})
    .then(async () => {
      const waitMs = scheduledStart - Date.now();
      if (waitMs > 0) await sleep(waitMs);
      return fn();
    });

  return lane.promise;
}

async function fetchText(url) {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  let lastStatus = 'network';
  const startedAt = Date.now();
  let host = null;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    host = null;
  }
  if (host) {
    getHostStats(host).requests += 1;
  }

  for (let attempt = 1; attempt <= MAX_FETCH_ATTEMPTS; attempt += 1) {
    if (Date.now() - startedAt >= FETCH_TOTAL_BUDGET_MS) break;

    const attemptFetch = async () => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
      try {
        return await fetch(url, {
          headers: {
            'user-agent': 'chibot/1.0 (+chiirl)'
          },
          signal: controller.signal
        });
      } finally {
        clearTimeout(timeout);
      }
    };

    let res;
    try {
      res = host ? await withHostThrottle(host, attemptFetch) : await attemptFetch();
    } catch (error) {
      lastStatus = error.name === 'AbortError' ? 'timeout' : 'network';
      if (host) {
        const stats = getHostStats(host);
        if (lastStatus === 'timeout') stats.timeouts += 1;
        else stats.failures += 1;
      }
      if (attempt >= MAX_FETCH_ATTEMPTS) break;
      const remaining = FETCH_TOTAL_BUDGET_MS - (Date.now() - startedAt);
      const backoff = Math.min(2000 * attempt, 3000);
      if (remaining <= backoff) break;
      await sleep(backoff);
      continue;
    }

    lastStatus = res.status;
    if (res.ok) {
      if (host) {
        const stats = getHostStats(host);
        stats.ok += 1;
        maybePromoteHostPolicy(host);
      }
      return res.text();
    }

    if (res.status === 429 || (res.status >= 500 && res.status < 600)) {
      if (host) {
        if (res.status === 429) maybeAdaptHostPolicy(host, 429);
        else getHostStats(host).failures += 1;
      }
      if (attempt >= MAX_FETCH_ATTEMPTS) break;
      const remaining = FETCH_TOTAL_BUDGET_MS - (Date.now() - startedAt);
      const backoff = Math.min(2000 * attempt, 3000);
      if (remaining <= backoff) break;
      await sleep(backoff);
      continue;
    }
    if (host) {
      if (res.status === 429) maybeAdaptHostPolicy(host, 429);
      else getHostStats(host).failures += 1;
    }
    break;
  }
  throw new Error(`Fetch failed ${lastStatus} for ${url}`);
}

// ---------------------------------------------------------------------------
// Concurrency limiter — runs up to `limit` async tasks at once.
// ---------------------------------------------------------------------------
async function parallelMap(items, fn, limit = 8) {
  const results = [];
  let idx = 0;

  async function worker() {
    while (idx < items.length) {
      const i = idx++;
      results[i] = await fn(items[i], i);
    }
  }

  const workers = Array.from({ length: Math.min(limit, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

function timestampForFilename(date = new Date()) {
  return date.toISOString().replace(/[:.]/g, '-');
}

function ensureScrapeDumpDir() {
  const dir = `${process.cwd()}/${SCRAPE_DUMP_DIR}`;
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function writeScrapeDump(payload) {
  const dir = ensureScrapeDumpDir();
  const filename = `chibot-${timestampForFilename()}.json`;
  const filePath = `${dir}/${filename}`;
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  return filePath;
}

function getSeedPageCachePath() {
  return `${ensureScrapeDumpDir()}/${SEED_PAGE_CACHE_FILE}`;
}

function loadSeedPageCache() {
  const filePath = getSeedPageCachePath();
  if (!fs.existsSync(filePath)) {
    return {
      seed_pages: [],
      mined_event_urls: [],
      updated_at: null
    };
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return {
      seed_pages: Array.isArray(parsed.seed_pages) ? parsed.seed_pages : [],
      mined_event_urls: Array.isArray(parsed.mined_event_urls) ? parsed.mined_event_urls : [],
      updated_at: parsed.updated_at || null
    };
  } catch {
    return {
      seed_pages: [],
      mined_event_urls: [],
      updated_at: null
    };
  }
}

function saveSeedPageCache(payload) {
  const filePath = getSeedPageCachePath();
  const normalized = {
    seed_pages: [...new Set((payload.seed_pages || []).filter(Boolean))].sort(),
    mined_event_urls: [...new Set((payload.mined_event_urls || []).filter(Boolean))].sort(),
    updated_at: new Date().toISOString()
  };
  fs.writeFileSync(filePath, `${JSON.stringify(normalized, null, 2)}\n`, 'utf8');
  return filePath;
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
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, code) => {
      try {
        return String.fromCodePoint(Number(code));
      } catch {
        return _;
      }
    })
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => {
      try {
        return String.fromCodePoint(parseInt(hex, 16));
      } catch {
        return _;
      }
    });
}

function extractByIdText(html, id) {
  const re = new RegExp(`<[^>]+id=["']${id}["'][^>]*>([\\s\\S]*?)<\\/[^>]+>`, 'i');
  const m = html.match(re);
  if (!m) return null;
  return decodeHtmlEntities(m[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
}

function parseMhubEvent(html, sourceUrl) {
  const title = extractByIdText(html, 'evTitle') || decodeHtmlEntities(extractMetaContent(html, 'property', 'og:title'));
  const startRaw = extractByIdText(html, 'startDate');
  const startDatetime = parseMhubStartDate(startRaw);
  const location = extractByIdText(html, 'evLocation');
  const description = decodeHtmlEntities((extractMetaContent(html, 'name', 'description') || '').replace(/<[^>]+>/g, ' '));
  const image = extractMetaContent(html, 'property', 'og:image');
  if (!title || !startDatetime) return null;

  const row = {
    title,
    start_datetime: startDatetime,
    Online: /\bvirtual\b|\bonline\b/i.test(location || '') ? 'TRUE' : 'FALSE',
    ...inferEventTaxonomy(title, description, [location, sourceUrl]),
    image_url: image || null,
    eventUrl: sourceUrl,
    location: location || null,
    google_maps_url: null
  };
  return row;
}

function isLumaUrl(url) {
  try {
    const h = new URL(url).hostname.toLowerCase();
    return h.includes('luma.com') || h.includes('lu.ma');
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

// ---------------------------------------------------------------------------
// Process a single URL — returns { row } or { skip }.
// ---------------------------------------------------------------------------
async function fetchSingleEventRow(url, strictUrlsMode) {
  const html = await fetchText(url);
  if (isMhubUrl(url)) {
    const row = parseMhubEvent(html, url);
    if (!row) return { skip: { url, reason: 'missing mHUB title/date' } };
    return { row };
  }

  const event = extractEventJsonLd(html);
  const ogImage = extractMetaContent(html, 'property', 'og:image');
  if (!event) {
    if (isMeetupUrl(url) && globalMeetupFallback?.enabled) {
      const row = await fetchMeetupEventViaBrowser(url);
      if (row) return { row };
    }
    return { skip: { url, reason: 'missing event JSON-LD' } };
  }

  if (!strictUrlsMode) {
    const cls = classifyEvent(event.name, event.description);
    if (!cls.relevant) {
      const reason = cls.ambiguous
        ? `ambiguous include=${cls.includeHits.join('|')} exclude=${cls.excludeHits.join('|')}`
        : 'not in target founder/startup/tech/ai scope';
      return { skip: { url, reason } };
    }
    if (!isChicagoAreaEvent(event)) {
      return { skip: { url, reason: 'not in Chicago area' } };
    }
  }

  return { row: mapToRow(event, url, ogImage) };
}

// ---------------------------------------------------------------------------
// Fetch event rows with concurrency control.
// ---------------------------------------------------------------------------
async function fetchEventRows(urls, strictUrlsMode = false, concurrency = 8) {
  const rows = [];
  const skipped = [];
  let processed = 0;
  let lastReported = 0;
  const startedAt = Date.now();

  const reportProgress = () => {
    const elapsedSeconds = ((Date.now() - startedAt) / 1000).toFixed(1);
    console.log(
      `Fetch progress: ${processed}/${urls.length} (${Math.round((processed / Math.max(urls.length, 1)) * 100)}%) ` +
      `rows=${rows.length} skipped=${skipped.length} elapsed=${elapsedSeconds}s`
    );
  };

  const results = await parallelMap(
    urls,
    async (url) => {
      try {
        const result = await fetchSingleEventRow(url, strictUrlsMode);
        processed += 1;
        if (result.row) rows.push(result.row);
        if (result.skip) skipped.push(result.skip);
        if (processed === urls.length || processed - lastReported >= 10) {
          lastReported = processed;
          reportProgress();
        }
        return result;
      } catch (err) {
        const result = { skip: { url, reason: err.message } };
        processed += 1;
        skipped.push(result.skip);
        if (processed === urls.length || processed - lastReported >= 10) {
          lastReported = processed;
          reportProgress();
        }
        return result;
      }
    },
    concurrency
  );

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

async function fetchMeetupEventViaBrowser(url) {
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
      ? cleanLocationString([event.venue.name, event.venue.address, event.venue.city, event.venue.state].filter(Boolean).join(', '))
      : null;
    const description = event.description || '';
    const title = event.title || null;
    if (!title || !event.dateTime || !eventUrl) return null;

    return {
      title,
      start_datetime: event.dateTime,
      Online: String(event.eventType || '').toUpperCase().includes('ONLINE') ? 'TRUE' : 'FALSE',
      ...inferEventTaxonomy(title, description, [location, eventUrl, event.group?.name]),
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

function extractJsonLdEvents(html) {
  const out = [];
  const seen = new Set();
  const isEventType = (value) => {
    if (!value) return false;
    if (Array.isArray(value)) return value.some((v) => isEventType(v));
    const t = String(value).toLowerCase();
    return t === 'event' || t.endsWith('event');
  };
  const walk = (node) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      for (const item of node) walk(item);
      return;
    }
    if (isEventType(node['@type'])) {
      const key = JSON.stringify([node['@id'], node.url, node.name, node.startDate]);
      if (!seen.has(key)) {
        seen.add(key);
        out.push(node);
      }
    }
    for (const key of Object.keys(node)) walk(node[key]);
  };
  const re = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const raw = m[1].trim();
    try {
      walk(JSON.parse(raw));
    } catch {
      continue;
    }
  }
  return out;
}

function extractEventJsonLd(html) {
  return extractJsonLdEvents(html)[0] || null;
}

function classifyEvent(title, description) {
  const hay = `${title || ''} ${description || ''}`.toLowerCase();
  const includeRules = [
    ['ai', /\bai\b|\bartificial intelligence\b|\bllm(s)?\b|\bgenai\b/],
    ['startup', /\bstartup(s)?\b|\bstart-up(s)?\b|\bincubator\b|\baccelerator\b/],
    ['founder', /\bfounder(s)?\b|\bcofounder(s)?\b|\bco-founder(s)?\b|\bentrepreneur(s)?\b/],
    ['tech', /\btech\b|\bdeveloper(s)?\b|\bengineering\b|\bsoftware\b|\bdesign\b|\bproduct\b|\bcloud\b|\bsecurity\b|\bcybersecurity\b|\bdata science\b|\bdata\b|\bquantum\b|\bbitcoin\b|\blinux\b|\brobotics\b/],
    ['hackathon', /\bhackathon(s)?\b|\bbuildathon(s)?\b/],
    ['healthtech', /\bhealthtech\b|\bdigital health\b/],
    ['venture', /\bvc\b|\bventure\b|\bventure capital\b|\binvestor(s)?\b|\bfundraising\b/],
    ['community meetup', /\bmeetup(s)?\b|\bnetworking\b|\bcommunity\b|\bworkshop\b|\bseminar\b|\bspeaker series\b|\bbook club\b|\bshowcase\b|\bfilm festival\b/]
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

function cleanLocationString(loc) {
  if (!loc) return loc;
  let parts = decodeHtmlEntities(loc).split(',').map((p) => p.trim()).filter(Boolean);
  // Remove consecutive duplicate parts.
  parts = parts.filter((p, i) => i === 0 || p !== parts[i - 1]);
  // Strip embedded zip codes.
  parts = parts.map((p) => p.replace(/\s+\d{5}(-\d{4})?\b/, '').trim());
  // Remove standalone zip parts.
  parts = parts.filter((p) => !/^\d{5}(-\d{4})?$/.test(p));
  // Remove trailing US/USA.
  if (parts.length > 1 && /^(us|usa)$/i.test(parts[parts.length - 1])) parts.pop();
  if (parts.length > 0) {
    parts[parts.length - 1] = parts[parts.length - 1].replace(/,?\s*(US|USA)$/i, '').trim();
  }
  // Re-dedupe after zip strip (case-insensitive).
  parts = parts.filter((p, i) => i === 0 || p.toLowerCase() !== parts[i - 1].toLowerCase());
  // Remove trailing duplicate city+state pairs.
  if (parts.length >= 4) {
    const last2 = parts.slice(-2).map((p) => p.toLowerCase()).join('|');
    const prev2 = parts.slice(-4, -2).map((p) => p.toLowerCase()).join('|');
    if (last2 === prev2) parts = parts.slice(0, -2);
  }
  // Handle doubled content within a single part.
  parts = parts.map((p) => {
    const words = p.split(/\s+/);
    for (let len = 3; len <= Math.floor(words.length / 2); len++) {
      const suffix = words.slice(-len).join(' ');
      const prefix = words.slice(-(len * 2), -len).join(' ');
      if (suffix === prefix) return words.slice(0, words.length - len).join(' ');
    }
    return p;
  });
  return parts.filter(Boolean).join(', ');
}

function normalizeLocation(location) {
  if (!location) return null;
  let raw;
  if (typeof location.address === 'string') {
    const parts = [location.name, location.address].filter(Boolean);
    raw = parts.join(', ');
  } else {
    const address = location.address || {};
    const parts = [
      location.name,
      address.streetAddress,
      address.addressLocality,
      address.addressRegion
    ].filter(Boolean);
    raw = parts.length > 0 ? parts.join(', ') : (location.name || null);
  }
  return cleanLocationString(raw);
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function collectTaxonomy(text, rules) {
  const found = [];
  for (const [label, patterns] of rules) {
    if (patterns.some((re) => re.test(text))) found.push(label);
  }
  return unique(found);
}

function withoutNetworkingFallback(activity) {
  if (activity.length <= 1) return activity;
  return activity.filter((value) => value !== 'networking');
}

function inferEventTaxonomy(title, description, extras = []) {
  const hay = [title || '', description || '', ...extras.filter(Boolean)].join(' ').toLowerCase();

  const audience = collectTaxonomy(hay, [
    ['invite-only', [/\binvite[- ]only\b/, /\bprivate dinner\b/, /\bregister to see address\b/]],
    ['female founders', [/\bwomen in\b/, /\binternational women'?s day\b/, /\bfemale founder(s)?\b/]],
    ['minority founders', [/\bminority founder(s)?\b/, /\bunderrepresented founder(s)?\b/]],
    ['minority investors', [/\bminority investor(s)?\b/]],
    ['founders', [/\bfounder(s)?\b/, /\bstartup\b/, /\bentrepreneur(s)?\b/]],
    ['investors', [/\binvestor(s)?\b/, /\bventure\b/, /\bvc\b/, /\bangel\b/]],
    ['service-providers', [/\badvisor(s)?\b/, /\bservice provider(s)?\b/, /\bconsultant(s)?\b/, /\blegal\b/, /\btax\b/]],
    ['developers', [/\bdeveloper(s)?\b/, /\bcoding\b/, /\bengineer(s)?\b/, /\.net\b/, /\bdrupal\b/, /\bgrafana\b/, /\bsoftware\b/, /\btest(er|ing)\b/]],
    ['all', [/\bcommunity\b/, /\bmeetup\b/, /\bnetworking\b/, /\bsocial\b/]]
  ]);

  const industry = collectTaxonomy(hay, [
    ['AI', [/\bai\b/, /\bclaude\b/, /\banthropic\b/, /\bagent(s)?\b/, /\bllm(s)?\b/]],
    ['climate tech', [/\bclimate\b/, /\bclean tech\b/, /\bclean energy\b/, /\bsustainab/i]],
    ['health', [/\bhealth\b/, /\bhealthcare\b/, /\btherapy\b/, /\bmedical\b/]],
    ['biotech', [/\bbiotech\b/]],
    ['fintech', [/\bfintech\b/, /\bfinancial\b/, /\bfinra\b/, /\bbank(ing)?\b/, /\bpayments?\b/]],
    ['crypto/Web3', [/\bcrypto\b/, /\bweb3\b/, /\bblockchain\b/, /\bdefi\b/]],
    ['cybersecurity', [/\bsecurity\b/, /\bcyber\b/, /\bburbsec\b/]],
    ['data', [/\bdata\b/, /\banalytics\b/, /\bstatistical\b/]],
    ['insurtech', [/\binsurtech\b/, /\binsurance\b/]],
    ['sports', [/\bsports?\b/, /\bcubs\b/]],
    ['future of work', [/\bfuture of work\b/, /\bworkflow(s)?\b/, /\bcustomer success\b/]],
    ['hardtech', [/\bhard tech\b/, /\bmhub\b/, /\binnovation summit\b/]],
    ['legal tech', [/\blegal tech\b/, /\bintellectual property\b/]],
    ['saas', [/\bsaas\b/]],
    ['consumer', [/\bcustomer service\b/, /\bconsumer\b/]]
  ]);

  const topic = collectTaxonomy(hay, [
    ['branding', [/\bbranding\b/]],
    ['business strategy', [/\bstrategy\b/, /\bmarket\b/, /\bceo\b/, /\badoption\b/]],
    ['capital deployment', [/\bventure\b/, /\bvc\b/, /\binvestor(s)?\b/]],
    ['coding', [/\bcoding\b/, /\bbuild with\b/, /\.net\b/, /\bgrafana\b/, /\bdrupal\b/, /\bobservability\b/, /\bevals\b/, /\bsoftware\b/]],
    ['finance', [/\bfinancial\b/, /\bfinra\b/, /\btax\b/]],
    ['fundraising', [/\bfundraising\b/, /\bpitch\b/, /1 million cups/i]],
    ['GTM', [/\bgtm\b/, /\bgo-to-market\b/]],
    ['legal\/IP', [/\blegal\b/, /\bip\b/, /\bintellectual property\b/]],
    ['marketing', [/\bmarketing\b/]],
    ['organization management', [/\bleadership\b/, /\bcommunication\b/, /\bmanagement\b/]],
    ['policy', [/\bpolicy\b/]],
    ['product', [/\bproduct\b/, /\bux\b/, /\bui\b/, /\bcustomer success\b/]],
    ['recruiting', [/\brecruit/i]],
    ['sales', [/\bsales\b/]],
    ['scaling', [/\bscale\b/, /\bmaturity\b/, /\bgrowth\b/]],
    ['UIUX/CX', [/\bux\b/, /\bui\b/, /\bcx\b/]]
  ]);

  const activity = withoutNetworkingFallback(
    collectTaxonomy(hay, [
      ['co-working', [/\bcowork/i, /\bco-working\b/]],
      ['discussion', [/\bdiscussion\b/, /\btherapy\b/, /\bmeeting\b/, /\broundtable\b/]],
      ['hangout event', [/\bhangout\b/, /\bopen house\b/, /\bhappy hour\b/, /\bsocial\b/]],
      ['networking', [/\bnetworking\b/, /\bmixer\b/, /\bconnect\b/, /\bmeetup\b/, /\bcommunity\b/]],
      ['pitching or demo', [/\bpitch\b/, /\bdemo\b/, /1 million cups/i]],
      ['speaker panel or fireside', [/\bpanel\b/, /\bfireside\b/, /\bsummit\b/, /\bq&a\b/]]
    ])
  );

  return { audience, industry, topic, activity };
}

function mapToRow(event, fallbackUrl, fallbackImage) {
  const mode = String(event.eventAttendanceMode || '').toLowerCase();
  const online = mode.includes('online') ? 'TRUE' : 'FALSE';
  const title = decodeHtmlEntities(event.name || '') || null;
  const description = decodeHtmlEntities(event.description || '');
  const eventUrl = canonicalizeUrl(event.url || event['@id'] || fallbackUrl);
  const location = normalizeLocation(event.location);
  const row = {
    title,
    start_datetime: event.startDate || null,
    Online: online,
    ...inferEventTaxonomy(title, description, [
      location,
      eventUrl,
      fallbackUrl
    ]),
    image_url: Array.isArray(event.image) ? event.image[0] : event.image || fallbackImage,
    eventUrl,
    location,
    google_maps_url: null
  };

  return row;
}

// ---------------------------------------------------------------------------
// Extract event URLs from an HTML listing page (Luma, Eventbrite, Meetup).
// Scans for <a href="..."> links that look like individual event pages.
// ---------------------------------------------------------------------------
function extractEventUrlsFromListing(html) {
  const urls = new Set();
  const linkRe = /<a[^>]+href=["']([^"']+)["'][^>]*>/gi;
  let m;
  while ((m = linkRe.exec(html)) !== null) {
    const href = m[1];
    try {
      const resolved = href.startsWith('http') ? href : `https://luma.com${href}`;
      const u = new URL(resolved);
      const host = u.hostname.toLowerCase();
      const path = u.pathname;

      // Luma event pages: /slug-id (single path segment, not a known non-event route)
      if (host.includes('luma.com') || host.includes('lu.ma')) {
        const parts = path.split('/').filter(Boolean);
        if (parts.length === 1 && !parts[0].startsWith('@') && !LUMA_NON_EVENT_ROUTES.test(parts[0])) {
          urls.add(`https://luma.com/${parts[0]}`);
        }
      }

      // Meetup event pages: /<group>/events/<id>
      if (host.includes('meetup.com')) {
        const parts = path.split('/').filter(Boolean);
        const evIdx = parts.findIndex((p) => p.toLowerCase() === 'events');
        const eventId = parts[evIdx + 1];
        if (evIdx >= 1 && eventId && /^\d+$/.test(eventId) && !MEETUP_NON_EVENT_SEGMENTS.has(eventId.toLowerCase())) {
          urls.add(`https://www.meetup.com/${parts[evIdx - 1]}/events/${eventId}`);
        }
      }

      // Eventbrite event pages: /e/<slug-id>
      if (host.includes('eventbrite.com') && /^\/e\//.test(path)) {
        urls.add(`https://www.eventbrite.com${path.replace(/\/+$/, '')}`);
      }

      // mHUB event pages
      if (host.includes('mhubchicago.com') && /\/event/i.test(path)) {
        urls.add(`https://www.mhubchicago.com${path.replace(/\/+$/, '')}`);
      }
    } catch {
      // Not a valid URL, skip.
    }
  }

  for (const event of extractJsonLdEvents(html)) {
    const eventUrl = canonicalizeUrl(event.url || event['@id']);
    if (eventUrl) urls.add(eventUrl);
  }

  return [...urls];
}

// ---------------------------------------------------------------------------
// Extract Luma calendar / organizer page URLs from a listing page.
// These are pages like lu.ma/calendar/cal-XXXX or lu.ma/@organizer.
// ---------------------------------------------------------------------------
function extractCalendarUrlsFromListing(html) {
  const urls = new Set();
  const linkRe = /<a[^>]+href=["']([^"']+)["'][^>]*>/gi;
  let m;
  while ((m = linkRe.exec(html)) !== null) {
    const href = m[1];
    try {
      const resolved = href.startsWith('http') ? href : `https://luma.com${href}`;
      const u = new URL(resolved);
      const host = u.hostname.toLowerCase();
      const path = u.pathname;

      if (host.includes('luma.com') || host.includes('lu.ma')) {
        // Calendar pages: /calendar/cal-XXXX
        if (/^\/calendar\/cal-/i.test(path)) {
          urls.add(`https://luma.com${path}`);
        }
        // Organizer pages: /@handle
        if (/^\/@[^/]+$/.test(path)) {
          urls.add(`https://luma.com${path}`);
        }
      }
    } catch {
      // skip
    }
  }
  return [...urls];
}

// ---------------------------------------------------------------------------
// Extract organizer/community seed pages from an individual event's HTML.
// Looks for links to organizer profiles and related pages.
// ---------------------------------------------------------------------------
function extractSeedPagesFromHtml(html) {
  const pages = new Set();
  const linkRe = /<a[^>]+href=["']([^"']+)["'][^>]*>/gi;
  let m;
  while ((m = linkRe.exec(html)) !== null) {
    const href = m[1];
    try {
      const resolved = href.startsWith('http') ? href : new URL(href, 'https://luma.com').href;
      const u = new URL(resolved);
      const host = u.hostname.toLowerCase();
      const path = u.pathname;

      // Luma organizer/calendar pages
      if (host.includes('luma.com') || host.includes('lu.ma')) {
        if (/^\/calendar\/cal-/i.test(path) || /^\/@[^/]+$/.test(path)) {
          pages.add(`https://luma.com${path}`);
        }
      }

      // Meetup group pages (not individual events)
      if (host.includes('meetup.com')) {
        const parts = path.split('/').filter(Boolean);
        if (parts.length === 1 && !/^(find|topics|cities|apps|help|about)$/i.test(parts[0])) {
          pages.add(`https://www.meetup.com/${parts[0]}`);
        }
        if (parts.length >= 2 && parts[1].toLowerCase() === 'events' && !parts[2]) {
          pages.add(`https://www.meetup.com/${parts[0]}/events`);
        }
      }

      // Eventbrite organizer pages
      if (host.includes('eventbrite.com') && /^\/o\//i.test(path)) {
        pages.add(`https://www.eventbrite.com${path.replace(/\/+$/, '')}`);
      }
    } catch {
      // skip
    }
  }
  return [...pages];
}

// ---------------------------------------------------------------------------
// Extract organizer/group URLs from DB history event URLs.
// Derives the org listing page from each event URL pattern.
// ---------------------------------------------------------------------------
function extractOrgUrlsFromEventUrls(eventUrls) {
  const orgUrls = new Set();

  for (const url of eventUrls) {
    try {
      const u = new URL(url);
      const host = u.hostname.toLowerCase();
      const path = u.pathname;

      // Meetup: /group-name/events/12345 → /group-name/events (upcoming list)
      if (host.includes('meetup.com')) {
        const parts = path.split('/').filter(Boolean);
        const evIdx = parts.findIndex((p) => p.toLowerCase() === 'events');
        if (evIdx >= 1) {
          orgUrls.add(`https://www.meetup.com/${parts[evIdx - 1]}/events`);
        }
      }

      // Eventbrite: /e/event-slug → can't derive org, but we can try /o/ links found in HTML later

      // Luma: single-segment paths are events; we can't derive the calendar from the event ID alone
      // but extractSeedPagesFromHtml will find calendar links when we fetch the event page

    } catch {
      // skip
    }
  }

  return [...orgUrls];
}

// ---------------------------------------------------------------------------
// Known venue overrides for ambiguous addresses.
// ---------------------------------------------------------------------------
const VENUE_OVERRIDES = {
  '100 S State St': 'CIC Chicago Innovation Center, 100 S State St, Chicago, IL'
};

// ---------------------------------------------------------------------------
// Let's Do Fun Things — scrape their listing page for tech-relevant events.
// They rarely have tech events, but when they do we want to catch them.
// ---------------------------------------------------------------------------
async function fetchLdftEvents() {
  const rows = [];
  try {
    const html = await fetchText('https://www.letsdofunthings.org/events');
    // Their Next.js RSC payload embeds event JSON with escaped quotes.
    // Unescape and extract event objects.
    const unescaped = html.replace(/\\"/g, '"');
    const eventRe = /"slug":"([^"]+)","name":"([^"]+)","image_url":"([^"]*)","start_at":"([^"]+)","venue_name":"([^"]*)","address":"([^"]*)","short_description":"([^"]*)"/g;
    let m;
    while ((m = eventRe.exec(unescaped)) !== null) {
      const [, slug, name, imageUrl, startAt, venueName, address, description] = m;
      const cls = classifyEvent(name, description);
      if (!cls.relevant) continue;

      const eventUrl = `https://www.letsdofunthings.org/events/${slug}`;
      let location = cleanLocationString(
        venueName && venueName !== address.split(',')[0]
          ? `${venueName}, ${address}`
          : address
      );
      // Apply venue overrides for ambiguous addresses.
      for (const [pattern, override] of Object.entries(VENUE_OVERRIDES)) {
        if (location.includes(pattern)) {
          location = override;
          break;
        }
      }

      rows.push({
        title: name.trim(),
        start_datetime: startAt,
        Online: 'FALSE',
        ...inferEventTaxonomy(name, description, [location, eventUrl]),
        image_url: imageUrl || null,
        eventUrl,
        location,
        google_maps_url: null
      });
    }
  } catch (err) {
    console.log(`Let's Do Fun Things scrape failed: ${err.message}`);
  }
  return rows;
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

  // Fetch calendar pages sequentially (all luma.com — avoid rate limits).
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

function loadCuratedSeedPages() {
  const filePath = path.resolve(__dirname, '..', 'discovery', CURATED_SEED_FILE);
  if (!fs.existsSync(filePath)) return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (!Array.isArray(parsed.seed_pages)) return [];
    return parsed.seed_pages.map((value) => canonicalizeUrl(String(value || '').trim())).filter(Boolean);
  } catch (err) {
    console.log(`Curated seed load failed (${filePath}): ${err.message}`);
    return [];
  }
}

// ---------------------------------------------------------------------------
// Load current/future seed event URLs from DB. Routine discovery relies on
// upcoming events instead of re-mining the full event history each run.
// ---------------------------------------------------------------------------
async function loadSeedUrlsFromDb(supabase, scanLimit, weeklyMode = false) {
  const out = new Set();
  const tables = [
    process.env.SUPABASE_TABLE || 'beta_chiirl_events',
    process.env.SUPABASE_INACCURATE_TABLE || 'CTC Current Events'
  ];
  const ctcW3WBoost = [];
  const now = new Date().toISOString();

  for (const table of tables) {
    const { data, error } = await supabase
      .from(table)
      .select('eventUrl,title,start_datetime')
      .limit(5000);
    if (error) continue;

    for (const row of data || []) {
      const normalized = canonicalizeEventUrl(String(row.eventUrl || '').trim());
      if (!normalized) continue;

      const dt = row.start_datetime || '';
      if (dt && dt < now) continue;

      out.add(normalized);

      const marker = `${row.title || ''} ${row.eventUrl || ''}`.toLowerCase();
      if (/\bw3w\b|what ?3 ?words|grassroots tech|chicago tech community|ctc/.test(marker)) {
        ctcW3WBoost.push(normalized);
      }
    }
  }

  const prioritized = [...new Set([...ctcW3WBoost, ...out])];
  return {
    seedUrls: prioritized.slice(0, weeklyMode ? scanLimit : Math.max(scanLimit, prioritized.length))
  };
}

async function expandCandidatesFromSeeds(baseUrls, seedPageUrls, max, concurrency = 6) {
  const all = new Set(baseUrls.map(canonicalizeEventUrl).filter(Boolean));
  const queue = [...seedPageUrls];

  await parallelMap(
    queue,
    async (url) => {
      if (all.size >= max) return;
      try {
        const html = await fetchText(url);
        const eventUrls = extractEventUrlsFromListing(html);
        for (const eventUrl of eventUrls) {
          const canonical = canonicalizeEventUrl(eventUrl);
          if (canonical) all.add(canonical);
        }
      } catch {
        // Ignore failed seed pages.
      }
    },
    concurrency
  );

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

async function hasTaxonomyColumns(supabase, table) {
  for (const column of ['audience', 'industry', 'topic', 'activity']) {
    const { error } = await supabase.from(table).select(column).limit(1);
    if (error) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Upsert rows — insert new events, update changed fields for existing ones.
// ---------------------------------------------------------------------------
async function upsertEventRows(supabase, table, rows) {
  const stats = { inserted: 0, updated: 0, unchanged: 0 };
  const eventUrls = rows.map((r) => r.eventUrl);
  const existingMap = new Map();

  // Fetch existing rows with full data for comparison.
  for (const part of chunk(eventUrls, 100)) {
    const { data, error } = await supabase
      .from(table)
      .select('id,title,start_datetime,Online,audience,industry,topic,activity,image_url,eventUrl,location')
      .in('eventUrl', part);
    if (error) throw new Error(`Upsert lookup failed: ${error.message}`);
    for (const row of data || []) {
      if (row.eventUrl) existingMap.set(row.eventUrl, row);
    }
  }

  const toInsert = [];
  const toUpdate = [];

  for (const row of rows) {
    const existing = existingMap.get(row.eventUrl);
    if (!existing) {
      toInsert.push(row);
      continue;
    }

    // Check if any field has changed.
    const changed =
      existing.title !== row.title ||
      existing.start_datetime !== row.start_datetime ||
      existing.Online !== row.Online ||
      existing.location !== row.location ||
      existing.image_url !== row.image_url ||
      JSON.stringify(existing.audience) !== JSON.stringify(row.audience) ||
      JSON.stringify(existing.industry) !== JSON.stringify(row.industry) ||
      JSON.stringify(existing.topic) !== JSON.stringify(row.topic) ||
      JSON.stringify(existing.activity) !== JSON.stringify(row.activity);

    if (changed) {
      toUpdate.push({ id: existing.id, ...row });
    } else {
      stats.unchanged++;
    }
  }

  if (toInsert.length > 0) {
    const { data, error } = await supabase.from(table).insert(toInsert).select('title,eventUrl');
    if (error) throw new Error(`Insert failed: ${error.message}`);
    stats.inserted = (data || []).length;
  }

  for (const row of toUpdate) {
    const { id, ...fields } = row;
    const { error } = await supabase.from(table).update(fields).eq('id', id);
    if (error) {
      console.log(`Update failed for id=${id}: ${error.message}`);
    } else {
      stats.updated++;
    }
  }

  return stats;
}

async function runCli(argv = process.argv.slice(2)) {
  const opts = parseArgs(argv);
  const scrapeStartedAt = new Date();
  resetHostRuntimePolicies(opts);
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
    let seedPageCachePath = null;
    let newSeedPagesDiscovered = 0;
    let newlyMinedEventUrls = 0;
    if (opts.strictUrls && opts.urls.length > 0) {
      candidateUrls = [...new Set(opts.urls.map(canonicalizeUrl).filter(Boolean))];
      console.log(`Using strict URL mode with ${candidateUrls.length} candidate URLs.`);
    } else {
      let cityCandidateUrls = [];
      try {
        cityCandidateUrls = await loadCandidateUrls(opts);
        console.log(`City listing found ${cityCandidateUrls.length} direct candidates.`);
      } catch (err) {
        console.log(`City listing unavailable (${err.message}); continuing with DB seeds.`);
      }

      const { seedUrls: dbSeedEventUrls } = await loadSeedUrlsFromDb(
        supabase,
        opts.seedScan,
        opts.weekly
      );
      console.log(`DB current seeds: ${dbSeedEventUrls.length} event URLs.`);

      // Derive org/group listing pages from current/upcoming event URLs.
      const orgUrls = extractOrgUrlsFromEventUrls(dbSeedEventUrls);
      console.log(`Derived ${orgUrls.length} unique org/group listing URLs from current DB events.`);

      const seedPageCache = loadSeedPageCache();
      const cachedSeedPages = new Set(seedPageCache.seed_pages || []);
      const minedEventUrls = new Set(seedPageCache.mined_event_urls || []);
      const curatedSeedPages = loadCuratedSeedPages();
      const seedPageUrls = new Set([...orgUrls, ...cachedSeedPages, ...curatedSeedPages]);
      const lumaSeedUrls = dbSeedEventUrls.filter((u) => isLumaUrl(u));
      const unminedLumaSeedUrls = lumaSeedUrls.filter((u) => !minedEventUrls.has(u));
      console.log(
        `Using ${cachedSeedPages.size} cached seed page(s). Mining ${unminedLumaSeedUrls.length} new Luma event page(s) for org links...`
      );
      if (curatedSeedPages.length > 0) {
        console.log(`Loaded ${curatedSeedPages.length} curated seed page(s).`);
      }
      await parallelMap(
        unminedLumaSeedUrls,
        async (eventUrl) => {
          try {
            const html = await fetchText(eventUrl);
            const pages = extractSeedPagesFromHtml(html);
            newlyMinedEventUrls += 1;
            for (const p of pages) {
              if (!seedPageUrls.has(p)) {
                seedPageUrls.add(p);
                newSeedPagesDiscovered += 1;
              }
            }
          } catch {
            // Ignore individual failed event pages while mining seeds.
          } finally {
            minedEventUrls.add(eventUrl);
          }
        },
        opts.concurrency
      );
      seedPageCachePath = saveSeedPageCache({
        seed_pages: [...seedPageUrls],
        mined_event_urls: [...minedEventUrls]
      });
      console.log(
        `Seed page cache updated: ${seedPageCachePath} (${seedPageUrls.size} seed page(s), ${minedEventUrls.size} mined Luma event(s), +${newSeedPagesDiscovered} new page(s)).`
      );
      console.log(`Total seed/org pages to expand: ${seedPageUrls.size}`);

      candidateUrls = await expandCandidatesFromSeeds(
        [...new Set([...cityCandidateUrls, ...dbSeedEventUrls])],
        [...seedPageUrls].slice(0, Math.max(opts.seedPages, seedPageUrls.size)),
        opts.max,
        opts.concurrency
      );
      console.log(`Found ${candidateUrls.length} candidate URLs (city+current-db-seeds+orgs).`);
    }

    const includeTaxonomyColumns = await hasTaxonomyColumns(supabase, table);
    if (!includeTaxonomyColumns) throw new Error('Missing taxonomy columns on target table.');

    const { rows: hydratedRows, skipped } = await fetchEventRows(candidateUrls, opts.strictUrls, opts.concurrency);

    // Scrape Let's Do Fun Things for tech-relevant events.
    if (!opts.strictUrls) {
      const ldftRows = await fetchLdftEvents();
      if (ldftRows.length > 0) {
        console.log(`Let's Do Fun Things: found ${ldftRows.length} tech-relevant event(s).`);
        hydratedRows.push(...ldftRows);
      }
    }

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

    const now = new Date().toISOString();
    const seen = new Set();
    const normalizedRows = hydratedRows.filter((r) => {
      if (!r.title || !r.start_datetime || !r.eventUrl) return false;
      if (r.start_datetime < now) return false;
      // Dedupe by title + date so the same event listed on multiple group
      // pages (e.g. two Meetup groups for the same organizer) only appears once.
      const key = `${r.title.toLowerCase().trim()}|${r.start_datetime.slice(0, 16)}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    const baseDump = {
      scraped_at: scrapeStartedAt.toISOString(),
      finished_at: new Date().toISOString(),
      dry_run: opts.dryRun,
      strict_urls_mode: opts.strictUrls,
      city: opts.city,
      concurrency: opts.concurrency,
      host_policies: {
        luma: getHostPolicy('luma.com'),
        meetup: getHostPolicy('www.meetup.com'),
        eventbrite: getHostPolicy('www.eventbrite.com')
      },
      host_stats: Object.fromEntries(_hostStats.entries()),
      seed_page_cache_path: seedPageCachePath,
      newly_mined_event_url_count: newlyMinedEventUrls,
      new_seed_page_count: newSeedPagesDiscovered,
      candidate_url_count: candidateUrls.length,
      candidate_urls: candidateUrls,
      hydrated_row_count: hydratedRows.length,
      normalized_row_count: normalizedRows.length,
      skipped_count: skipped.length,
      skipped,
      rows: normalizedRows
    };

    if (opts.dryRun) {
      // In dry-run mode, still check against DB to show what WOULD be new.
      const existing = await findExistingEventUrls(
        supabase,
        table,
        normalizedRows.map((r) => r.eventUrl)
      );
      const newRows = normalizedRows.filter((r) => !existing.has(r.eventUrl));
      const existingRows = normalizedRows.filter((r) => existing.has(r.eventUrl));
      const dumpPath = writeScrapeDump({
        ...baseDump,
        existing_row_count: existingRows.length,
        new_row_count: newRows.length,
        new_rows: newRows,
        existing_rows: existingRows.map((row) => row.eventUrl)
      });

      console.log(`\n--- DRY RUN RESULTS ---`);
      console.log(`Total relevant events scraped: ${normalizedRows.length}`);
      console.log(`Already in DB: ${existingRows.length}`);
      console.log(`NEW events that would be added: ${newRows.length}`);
      console.log(`Scrape dump written: ${dumpPath}`);

      if (newRows.length > 0) {
        console.log('\nNew events:');
        newRows.forEach((row) => {
          const summary = [
            `audience=${(row.audience || []).join('|') || '-'}`,
            `industry=${(row.industry || []).join('|') || '-'}`,
            `topic=${(row.topic || []).join('|') || '-'}`,
            `activity=${(row.activity || []).join('|') || '-'}`
          ].join(' ');
          console.log(`  + ${row.start_datetime} | ${summary} | ${row.title}`);
          console.log(`    ${row.eventUrl}`);
        });
      }

      console.log('\nDry run payload (full):');
      console.log(JSON.stringify(newRows, null, 2));
      return;
    }

    // Use upsert to insert new and update changed events.
    const stats = await upsertEventRows(supabase, table, normalizedRows);
    const dumpPath = writeScrapeDump({
      ...baseDump,
      upsert_stats: stats
    });
    console.log(`\nUpsert complete: ${stats.inserted} inserted, ${stats.updated} updated, ${stats.unchanged} unchanged.`);
    console.log(`Scrape dump written: ${dumpPath}`);
  } finally {
    await closeMeetupFallback(globalMeetupFallback);
    globalMeetupFallback = null;
  }
}

module.exports = {
  parseArgs,
  runCli
};

if (require.main === module) {
  runCli().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
