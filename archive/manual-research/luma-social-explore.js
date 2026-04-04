#!/usr/bin/env node
// Agentic Luma social graph explorer.
// Starts from a seed user, finds their events, finds attendees of those events,
// and branches out to discover new events across the network.
require('dotenv').config();
const fs = require('fs');
const path = require('path');

const AUTH_STATE = path.resolve(process.cwd(), '.auth', 'luma-state.json');
const DUMPS_DIR = path.resolve(process.cwd(), '.scrape-dumps');
const OUTPUT_FILE = path.join(DUMPS_DIR, 'social-explore.json');
const SEED_CACHE_PATH = path.join(DUMPS_DIR, 'seed-pages-cache.json');

const NON_EVENT_RE = /^\/(user|calendar|discover|home|signin|signup|create|pricing|blog|about|help|terms|privacy|ios|android|app|explore|search)($|\/)/i;
const NON_EVENT_HOSTS = /help\.luma\.com/i;

function isEventUrl(href) {
  try {
    const u = new URL(href);
    if (NON_EVENT_HOSTS.test(u.hostname)) return false;
    if (!(u.hostname.includes('luma.com') || u.hostname.includes('lu.ma'))) return false;
    const parts = u.pathname.split('/').filter(Boolean);
    if (parts.length !== 1) return false;
    if (parts[0].startsWith('@')) return false;
    if (NON_EVENT_RE.test(u.pathname)) return false;
    return true;
  } catch { return false; }
}

function canonicalEvent(href) {
  try { return 'https://luma.com' + new URL(href).pathname; } catch { return null; }
}

// ---------------------------------------------------------------------------
// Playwright helpers
// ---------------------------------------------------------------------------
async function getPage(context) {
  const page = await context.newPage();
  page.setDefaultTimeout(30000);
  return page;
}

async function scrollLoad(page, scrolls = 10) {
  for (let i = 0; i < scrolls; i++) {
    const before = await page.evaluate(() => document.body.scrollHeight);
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(600);
    const after = await page.evaluate(() => document.body.scrollHeight);
    if (after === before && i > 2) break;
  }
}

async function tryClickTab(page, labels) {
  for (const label of labels) {
    try {
      const btn = page.getByRole('button', { name: new RegExp(label, 'i') }).first();
      if (await btn.isVisible({ timeout: 1500 })) {
        await btn.click();
        await page.waitForTimeout(1200);
        return label;
      }
    } catch { /* not found */ }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Scrape a user's profile: upcoming + past events
// ---------------------------------------------------------------------------
async function scrapeUserProfile(context, handle) {
  const page = await getPage(context);
  const url = `https://luma.com/user/${handle}`;
  const events = new Map(); // url → text

  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await page.waitForTimeout(2000);

    const title = await page.title();
    if (title.includes('Not Found') || title.includes('Page Not Found')) {
      return { handle, url, name: null, events: [] };
    }
    const name = title.replace(' · Luma', '').trim();

    // Collect events across tabs
    for (const tabGroup of [
      ['Upcoming', 'Going', 'Attending'],
      ['Past', 'Hosted', 'Attended'],
    ]) {
      await tryClickTab(page, tabGroup);
      await scrollLoad(page, 12);

      const found = await page.evaluate((nonEventRe) => {
        const re = new RegExp(nonEventRe);
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
            const eventUrl = 'https://luma.com' + new URL(a.href).pathname;
            let el = a;
            let text = '';
            for (let i = 0; i < 7; i++) {
              el = el.parentElement;
              if (!el) break;
              const t = (el.innerText || '').replace(/\s+/g, ' ').trim();
              if (t.length > 15 && t.length < 250) { text = t.slice(0, 150); break; }
            }
            return { url: eventUrl, text };
          })
          .filter((e, i, arr) => arr.findIndex(x => x.url === e.url) === i);
      }, NON_EVENT_RE.source);

      for (const e of found) events.set(e.url, e.text);
    }

    return { handle, url, name, events: [...events.entries()].map(([url, text]) => ({ url, text })) };
  } catch (err) {
    return { handle, url, name: null, events: [], error: err.message };
  } finally {
    await page.close();
  }
}

// ---------------------------------------------------------------------------
// Scrape an event's attendee list
// ---------------------------------------------------------------------------
async function scrapeEventAttendees(context, eventUrl) {
  const page = await getPage(context);
  try {
    await page.goto(eventUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await page.waitForTimeout(2000);

    const title = await page.evaluate(() => document.querySelector('h1')?.innerText?.trim() || '');

    // Try to open full guest list
    await tryClickTab(page, ['Guests', 'See all guests', 'See all', 'Attendees', 'Going']);
    await scrollLoad(page, 15);

    // Organizers from JSON-LD
    const organizers = await page.evaluate(() => {
      for (const s of document.querySelectorAll('script[type="application/ld+json"]')) {
        try {
          const d = JSON.parse(s.textContent);
          if (d.organizer) {
            const orgs = Array.isArray(d.organizer) ? d.organizer : [d.organizer];
            return orgs.map(o => ({ name: o.name, profileUrl: o.url }));
          }
        } catch { /* skip */ }
      }
      return [];
    });

    // Attendee profile links
    const attendees = await page.evaluate(() =>
      [...new Set([...document.querySelectorAll('a[href*="/user/"]')]
        .map(a => a.href.split('?')[0])
        .filter(h => h.includes('/user/') && !h.includes('/undefined'))
      )]
    );

    return { url: eventUrl, title, organizers, attendees };
  } catch (err) {
    return { url: eventUrl, title: '', organizers: [], attendees: [], error: err.message };
  } finally {
    await page.close();
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  let chromium;
  try { ({ chromium } = require('playwright')); }
  catch { throw new Error('playwright not installed. Run: npm i -D playwright && npx playwright install chromium'); }

  if (!fs.existsSync(AUTH_STATE)) {
    throw new Error(`No session found at ${AUTH_STATE}. Run: npm run luma:login`);
  }

  fs.mkdirSync(DUMPS_DIR, { recursive: true });

  const seedUsers = ['evbogue', 'zecco'];
  const maxAttendeeDepth = 2;
  const maxAttendeesPerEvent = 20;
  const maxEventsPerUser = 15;

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ storageState: AUTH_STATE });

  const visitedUsers = new Set();
  const visitedEvents = new Set();
  const allEvents = new Map();   // url → { text, foundVia, organizers }
  const userProfiles = new Map(); // handle → profile data

  async function exploreUser(handle, depth) {
    if (visitedUsers.has(handle) || depth > maxAttendeeDepth) return;
    visitedUsers.add(handle);

    console.log(`\n${'  '.repeat(depth)}👤 ${handle} (depth ${depth})`);
    const profile = await scrapeUserProfile(context, handle);
    userProfiles.set(handle, profile);

    if (!profile.name) {
      console.log(`${'  '.repeat(depth)}  (not found or error)`);
      return;
    }
    console.log(`${'  '.repeat(depth)}  Name: ${profile.name} | Events: ${profile.events.length}`);

    const techEvents = profile.events
      .filter(e => /AI|tech|cup|hack|build|code|data|startup|crypto|ETH|Collective|1871|dev|product|design|engineer|cloud|founder|SaaS|ML|LLM|agent|web3/i.test(e.text) || !e.text)
      .slice(0, maxEventsPerUser);

    for (const event of techEvents) {
      if (!allEvents.has(event.url)) {
        allEvents.set(event.url, { text: event.text, foundVia: handle, organizers: [] });
        console.log(`${'  '.repeat(depth)}  📅 NEW: ${event.url} | ${event.text.slice(0, 70)}`);
      }
    }

    // Explore attendees of their events at next depth
    if (depth < maxAttendeeDepth) {
      for (const event of techEvents.slice(0, 5)) {
        if (visitedEvents.has(event.url)) continue;
        visitedEvents.add(event.url);

        const { title, organizers, attendees } = await scrapeEventAttendees(context, event.url);
        if (allEvents.has(event.url)) {
          allEvents.get(event.url).organizers = organizers.map(o => o.name);
          allEvents.get(event.url).title = title;
        }
        console.log(`${'  '.repeat(depth)}  🎟  "${title}" — ${attendees.length} attendees`);

        for (const attendeeUrl of attendees.slice(0, maxAttendeesPerEvent)) {
          const attHandle = attendeeUrl.replace(/.*\/user\//, '').replace(/[/?#].*/, '');
          if (attHandle && !visitedUsers.has(attHandle)) {
            await exploreUser(attHandle, depth + 1);
          }
        }
      }
    }
  }

  try {
    for (const user of seedUsers) {
      await exploreUser(user, 0);
    }
  } finally {
    await browser.close();
  }

  // Save results
  const output = {
    scrapedAt: new Date().toISOString(),
    seedUsers,
    totalUsersVisited: visitedUsers.size,
    totalEventsDiscovered: allEvents.size,
    users: Object.fromEntries(userProfiles),
    events: Object.fromEntries(allEvents),
  };
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2));

  // Update seed cache with new event URLs
  let seedCache = { seed_pages: [], mined_event_urls: [] };
  try { seedCache = JSON.parse(fs.readFileSync(SEED_CACHE_PATH, 'utf8')); } catch {}
  const existingMined = new Set(seedCache.mined_event_urls);
  let added = 0;
  for (const url of allEvents.keys()) {
    if (!existingMined.has(url)) { seedCache.mined_event_urls.push(url); added++; }
  }
  seedCache.mined_event_urls.sort();
  seedCache.updated_at = new Date().toISOString();
  fs.writeFileSync(SEED_CACHE_PATH, JSON.stringify(seedCache, null, 2));

  console.log('\n========================================');
  console.log(`Users explored:     ${visitedUsers.size}`);
  console.log(`Events discovered:  ${allEvents.size}`);
  console.log(`New seed URLs added: ${added}`);
  console.log(`Output: ${OUTPUT_FILE}`);
  console.log('========================================\n');

  // Print summary
  for (const [url, data] of allEvents) {
    const org = data.organizers?.length ? ` [${data.organizers.join(', ')}]` : '';
    console.log(`  ${url}${org}`);
    if (data.title || data.text) console.log(`    ${(data.title || data.text).slice(0, 100)}`);
  }
}

main().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
