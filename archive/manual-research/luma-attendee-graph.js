#!/usr/bin/env node
// Mine attendees from all known Luma events, rank by frequency,
// then explore the top attendees' profiles to find events we're missing.
require('dotenv').config();
const fs = require('fs');
const path = require('path');

const AUTH_STATE = path.resolve(process.cwd(), '.auth', 'luma-state.json');
const DUMPS_DIR = path.resolve(process.cwd(), '.scrape-dumps');
const LUMA_ORGS_FILE = path.join(DUMPS_DIR, 'luma-orgs.json');
const SOCIAL_FILE = path.join(DUMPS_DIR, 'social-explore.json');
const SEED_CACHE_PATH = path.join(DUMPS_DIR, 'seed-pages-cache.json');
const OUTPUT_FILE = path.join(DUMPS_DIR, 'attendee-graph.json');

const NON_EVENT_RE = /^\/(user|calendar|discover|home|signin|signup|create|pricing|blog|about|help|terms|privacy|ios|android|app|explore|search)($|\/)/i;

function loadKnownEventUrls() {
  const urls = new Set();

  // From luma-orgs.json
  try {
    const orgs = JSON.parse(fs.readFileSync(LUMA_ORGS_FILE, 'utf8'));
    for (const url of Object.keys(orgs)) {
      if (url.includes('luma.com') || url.includes('lu.ma')) urls.add(url.split('?')[0]);
    }
  } catch { /* skip */ }

  // From seed cache mined_event_urls
  try {
    const cache = JSON.parse(fs.readFileSync(SEED_CACHE_PATH, 'utf8'));
    for (const url of cache.mined_event_urls || []) urls.add(url.split('?')[0]);
  } catch { /* skip */ }

  // From social-explore.json
  try {
    const social = JSON.parse(fs.readFileSync(SOCIAL_FILE, 'utf8'));
    for (const url of Object.keys(social.events || {})) urls.add(url);
  } catch { /* skip */ }

  // Normalize to luma.com
  return [...urls]
    .map(u => { try { const p = new URL(u).pathname; return 'https://luma.com' + p; } catch { return null; } })
    .filter(Boolean)
    .filter(u => {
      const parts = new URL(u).pathname.split('/').filter(Boolean);
      return parts.length === 1 && !parts[0].startsWith('@') && !NON_EVENT_RE.test('/' + parts[0]);
    });
}

async function scrapeEventAttendees(page, eventUrl) {
  try {
    await page.goto(eventUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await page.waitForTimeout(1500);

    const title = await page.evaluate(() => document.querySelector('h1')?.innerText?.trim() || '');

    // Try to open guest list
    for (const label of ['Guests', 'See all guests', 'See all', 'Attendees']) {
      try {
        const btn = page.getByRole('button', { name: new RegExp(label, 'i') }).first();
        if (await btn.isVisible({ timeout: 1000 })) { await btn.click(); await page.waitForTimeout(1000); break; }
      } catch { /* not found */ }
    }

    // Scroll to load all attendees
    for (let i = 0; i < 10; i++) {
      const before = await page.evaluate(() => document.body.scrollHeight);
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await page.waitForTimeout(500);
      if (await page.evaluate(() => document.body.scrollHeight) === before && i > 2) break;
    }

    const attendees = await page.evaluate(() =>
      [...new Set([...document.querySelectorAll('a[href*="/user/"]')]
        .map(a => a.href.split('?')[0])
        .filter(h => h.includes('/user/') && !h.includes('/undefined') && !h.includes('/null'))
      )]
    );

    return { url: eventUrl, title, attendees, ok: true };
  } catch (err) {
    return { url: eventUrl, title: '', attendees: [], ok: false, error: err.message };
  }
}

async function scrapeUserEvents(page, handle) {
  try {
    await page.goto(`https://luma.com/user/${handle}`, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await page.waitForTimeout(1500);

    const title = await page.title();
    if (title.includes('Not Found')) return { handle, name: null, events: [] };
    const name = title.replace(' · Luma', '').trim();

    const events = new Map();

    for (const tabLabel of ['Past', 'Upcoming', 'Going', 'Hosted', 'Attended']) {
      try {
        const btn = page.getByRole('button', { name: new RegExp(tabLabel, 'i') }).first();
        if (await btn.isVisible({ timeout: 800 })) { await btn.click(); await page.waitForTimeout(1000); }
      } catch { /* skip */ }

      for (let i = 0; i < 10; i++) {
        const before = await page.evaluate(() => document.body.scrollHeight);
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
        await page.waitForTimeout(500);
        if (await page.evaluate(() => document.body.scrollHeight) === before && i > 2) break;
      }

      const found = await page.evaluate((reStr) => {
        const re = new RegExp(reStr);
        return [...document.querySelectorAll('a[href]')]
          .filter(a => {
            try {
              const u = new URL(a.href);
              if (!u.hostname.includes('luma.com') && !u.hostname.includes('lu.ma')) return false;
              const parts = u.pathname.split('/').filter(Boolean);
              if (parts.length !== 1 || parts[0].startsWith('@')) return false;
              return !re.test(u.pathname);
            } catch { return false; }
          })
          .map(a => {
            const url = 'https://luma.com' + new URL(a.href).pathname;
            let el = a, text = '';
            for (let i = 0; i < 7; i++) {
              el = el.parentElement; if (!el) break;
              const t = (el.innerText || '').replace(/\s+/g, ' ').trim();
              if (t.length > 15 && t.length < 250) { text = t.slice(0, 150); break; }
            }
            return { url, text };
          })
          .filter((e, i, arr) => arr.findIndex(x => x.url === e.url) === i);
      }, NON_EVENT_RE.source);

      for (const e of found) events.set(e.url, e.text);
    }

    return { handle, name, events: [...events.entries()].map(([url, text]) => ({ url, text })) };
  } catch (err) {
    return { handle, name: null, events: [], error: err.message };
  }
}

async function main() {
  let chromium;
  try { ({ chromium } = require('playwright')); }
  catch { throw new Error('playwright not installed'); }

  if (!fs.existsSync(AUTH_STATE)) throw new Error(`No session at ${AUTH_STATE}. Run: npm run luma:login`);

  const knownEvents = loadKnownEventUrls();
  console.log(`\nKnown Luma events to scan: ${knownEvents.length}`);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ storageState: AUTH_STATE });
  const page = await context.newPage();
  page.setDefaultTimeout(25000);

  // ---- Phase 1: scrape attendees for every known event ----
  console.log('\n=== Phase 1: Scraping attendees from known events ===\n');
  const attendeeCounts = new Map();   // handle → { name, count, events[] }
  const eventAttendees = {};

  for (let i = 0; i < knownEvents.length; i++) {
    const url = knownEvents[i];
    process.stdout.write(`[${i + 1}/${knownEvents.length}] ${url} ... `);
    const result = await scrapeEventAttendees(page, url);
    console.log(result.ok ? `"${result.title.slice(0, 50)}" — ${result.attendees.length} attendees` : `ERROR: ${result.error}`);

    eventAttendees[url] = { title: result.title, attendees: result.attendees };

    for (const attendeeUrl of result.attendees) {
      const handle = attendeeUrl.replace(/.*\/user\//, '').replace(/[/?#].*/, '');
      if (!handle) continue;
      if (!attendeeCounts.has(handle)) {
        attendeeCounts.set(handle, { handle, profileUrl: attendeeUrl, count: 0, events: [] });
      }
      const entry = attendeeCounts.get(handle);
      entry.count++;
      entry.events.push(url);
    }
  }

  // ---- Phase 2: rank attendees by frequency ----
  const ranked = [...attendeeCounts.values()]
    .sort((a, b) => b.count - a.count || a.handle.localeCompare(b.handle));

  console.log('\n=== Phase 2: Top attendees by event frequency ===\n');
  ranked.slice(0, 30).forEach((a, i) =>
    console.log(`  ${String(i + 1).padStart(3)}. ${a.handle.padEnd(35)} ${a.count} events`)
  );

  // ---- Phase 3: explore top attendees' profiles for unknown events ----
  const topN = 25;
  const knownEventSet = new Set(knownEvents);
  const newEvents = new Map();  // url → { text, foundVia }

  console.log(`\n=== Phase 3: Exploring top ${topN} attendees for unknown events ===\n`);

  for (const attendee of ranked.slice(0, topN)) {
    process.stdout.write(`👤 ${attendee.handle} (${attendee.count} events seen) ... `);
    const profile = await scrapeUserEvents(page, attendee.handle);
    console.log(profile.name ? `${profile.name} — ${profile.events.length} events on profile` : '(not found)');

    for (const event of profile.events) {
      if (!knownEventSet.has(event.url) && !newEvents.has(event.url)) {
        newEvents.set(event.url, { text: event.text, foundVia: attendee.handle });
        console.log(`  📅 NEW: ${event.url} | ${event.text.slice(0, 80)}`);
      }
    }
  }

  await browser.close();

  // ---- Save results ----
  fs.mkdirSync(DUMPS_DIR, { recursive: true });

  const output = {
    scrapedAt: new Date().toISOString(),
    knownEventsScanned: knownEvents.length,
    uniqueAttendeesFound: attendeeCounts.size,
    newEventsDiscovered: newEvents.size,
    topAttendees: ranked.slice(0, 50).map(a => ({ ...a, events: a.events.slice(0, 20) })),
    eventAttendees,
    newEvents: Object.fromEntries(newEvents),
  };
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2));

  // Update seed cache
  let seedCache = { seed_pages: [], mined_event_urls: [] };
  try { seedCache = JSON.parse(fs.readFileSync(SEED_CACHE_PATH, 'utf8')); } catch {}
  const existingMined = new Set(seedCache.mined_event_urls);
  let added = 0;
  for (const url of newEvents.keys()) {
    if (!existingMined.has(url)) { seedCache.mined_event_urls.push(url); added++; }
  }
  seedCache.mined_event_urls.sort();
  seedCache.updated_at = new Date().toISOString();
  fs.writeFileSync(SEED_CACHE_PATH, JSON.stringify(seedCache, null, 2));

  console.log('\n========================================');
  console.log(`Known events scanned:    ${knownEvents.length}`);
  console.log(`Unique attendees found:  ${attendeeCounts.size}`);
  console.log(`New events discovered:   ${newEvents.size}`);
  console.log(`Added to seed cache:     ${added}`);
  console.log(`Output: ${OUTPUT_FILE}`);
  console.log('========================================\n');

  console.log('Top 50 attendees:');
  ranked.slice(0, 50).forEach((a, i) =>
    console.log(`  ${String(i + 1).padStart(3)}. ${a.handle.padEnd(35)} ${a.count} events`)
  );

  if (newEvents.size) {
    console.log('\nNew events discovered:');
    for (const [url, data] of newEvents) {
      console.log(`  ${url}  [via ${data.foundVia}]`);
      console.log(`    ${data.text.slice(0, 100)}`);
    }
  }
}

main().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
