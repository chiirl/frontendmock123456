#!/usr/bin/env node
// Explore Luma via authenticated browser session.
//
// Modes:
//   --user <handle>     Show all events a user is hosting or attending
//   --event <url>       Show all attendees of an event
//   --depth <n>         Recursively follow attendees (default: 1)
//   --save              Append discovered event URLs to seed-pages-cache.json
//
// Examples:
//   node scripts/luma-explore.js --user zecco
//   node scripts/luma-explore.js --user maryg --depth 2 --save
//   node scripts/luma-explore.js --event https://luma.com/aic-ch-3-19
//
require('dotenv').config();
const fs = require('fs');
const path = require('path');

const DUMPS_DIR = path.resolve(process.cwd(), '.scrape-dumps');
const SEED_CACHE_PATH = path.join(DUMPS_DIR, 'seed-pages-cache.json');
const AUTH_STATE = path.resolve(process.cwd(), '.auth', 'luma-state.json');

// ---------------------------------------------------------------------------
// Arg parsing
// ---------------------------------------------------------------------------
function getArg(name, fallback = null) {
  const idx = process.argv.indexOf(name);
  if (idx === -1) return fallback;
  return process.argv[idx + 1] ?? fallback;
}

const opts = {
  user: getArg('--user'),
  event: getArg('--event'),
  depth: parseInt(getArg('--depth', '1'), 10),
  save: process.argv.includes('--save'),
  state: getArg('--state', AUTH_STATE),
};

if (!opts.user && !opts.event) {
  console.error('Usage: node luma-explore.js --user <handle> | --event <url> [--depth n] [--save]');
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Seed cache helpers
// ---------------------------------------------------------------------------
function loadSeedCache() {
  try { return JSON.parse(fs.readFileSync(SEED_CACHE_PATH, 'utf8')); } catch { return { seed_pages: [], mined_event_urls: [] }; }
}

function saveSeedCache(cache) {
  fs.mkdirSync(DUMPS_DIR, { recursive: true });
  fs.writeFileSync(SEED_CACHE_PATH, JSON.stringify({
    seed_pages: [...new Set(cache.seed_pages)].sort(),
    mined_event_urls: [...new Set(cache.mined_event_urls)].sort(),
    updated_at: new Date().toISOString(),
  }, null, 2));
}

// ---------------------------------------------------------------------------
// Playwright helpers
// ---------------------------------------------------------------------------
async function withBrowser(statePath, fn) {
  let chromium;
  try {
    ({ chromium } = require('playwright'));
  } catch {
    throw new Error('Missing playwright. Run: npm i -D playwright && npx playwright install chromium');
  }

  if (!fs.existsSync(statePath)) {
    throw new Error(`No saved session at ${statePath}. Run: node scripts/luma-login-headed.js`);
  }

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ storageState: statePath });
  const page = await context.newPage();
  try {
    return await fn(page);
  } finally {
    await browser.close();
  }
}

// Wait for a selector or timeout gracefully.
async function waitForAny(page, selectors, timeout = 8000) {
  try {
    await Promise.race(selectors.map(s => page.waitForSelector(s, { timeout })));
    return true;
  } catch {
    return false;
  }
}

// Extract all luma event URLs visible on the current page.
async function extractEventUrls(page) {
  const hrefs = await page.evaluate(() => {
    return [...document.querySelectorAll('a[href]')]
      .map(a => a.href)
      .filter(h => h.includes('luma.com/') || h.includes('lu.ma/'));
  });

  const events = new Set();
  const NON_EVENT = /\/(discover|about|help|login|signin|signup|user|calendar|terms|privacy|chicago|blog|pricing|ios|android|app|create|search|explore|@)/i;
  for (const href of hrefs) {
    try {
      const u = new URL(href);
      const parts = u.pathname.split('/').filter(Boolean);
      if (parts.length === 1 && !NON_EVENT.test(u.pathname)) {
        events.add(`https://luma.com/${parts[0]}`);
      }
    } catch { /* skip */ }
  }
  return [...events];
}

// Extract all attendee profile URLs visible on the current page.
async function extractAttendeeUrls(page) {
  const hrefs = await page.evaluate(() => {
    return [...document.querySelectorAll('a[href]')]
      .map(a => a.href)
      .filter(h => (h.includes('luma.com/user/') || h.includes('lu.ma/user/')));
  });
  return [...new Set(hrefs.map(h => h.replace('lu.ma', 'luma.com').split('?')[0]))];
}

// Scroll to bottom to trigger lazy loading.
async function scrollToBottom(page, maxScrolls = 10) {
  for (let i = 0; i < maxScrolls; i++) {
    const before = await page.evaluate(() => document.body.scrollHeight);
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(800);
    const after = await page.evaluate(() => document.body.scrollHeight);
    if (after === before) break;
  }
}

// ---------------------------------------------------------------------------
// Core: scrape a user profile page for their events
// ---------------------------------------------------------------------------
async function scrapeUserEvents(page, username) {
  const url = `https://luma.com/user/${username}`;
  console.log(`\nLoading profile: ${url}`);
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await waitForAny(page, ['[class*="event"]', '[class*="card"]', 'main', 'h1'], 6000);
  await scrollToBottom(page);

  const result = { username, profileUrl: url, hosting: [], attending: [], calendarPages: [] };

  // Try to find tab buttons (Hosting / Going / Past etc.)
  const tabs = await page.evaluate(() => {
    return [...document.querySelectorAll('button, [role="tab"], nav a')]
      .map(el => ({ text: el.textContent?.trim(), role: el.getAttribute('role'), tag: el.tagName }))
      .filter(t => t.text && t.text.length < 40);
  });
  console.log('  Tabs/buttons found:', tabs.map(t => t.text).join(', ') || '(none)');

  // Try clicking each meaningful tab and collecting events
  const tabKeywords = [
    { label: 'hosting', patterns: [/hosting/i, /organized/i, /host/i] },
    { label: 'attending', patterns: [/going/i, /attending/i, /registered/i, /upcoming/i] },
    { label: 'past', patterns: [/past/i, /attended/i, /previous/i] },
  ];

  for (const { label, patterns } of tabKeywords) {
    const clicked = await page.evaluate((patterns) => {
      const strPatterns = patterns.map(p => p.toString());
      const all = [...document.querySelectorAll('button, [role="tab"], nav a, a')];
      for (const el of all) {
        const text = el.textContent?.trim() || '';
        for (const ps of strPatterns) {
          const re = new RegExp(ps.replace(/^\/|\/[gi]*$/g, ''), 'i');
          if (re.test(text)) {
            el.click();
            return text;
          }
        }
      }
      return null;
    }, patterns.map(p => p.toString()));

    if (clicked) {
      console.log(`  Clicked tab: "${clicked}"`);
      await page.waitForTimeout(1500);
      await scrollToBottom(page, 15);
    }

    const found = await extractEventUrls(page);
    if (label === 'hosting') result.hosting.push(...found);
    else result.attending.push(...found);
  }

  // Deduplicate
  result.hosting = [...new Set(result.hosting)];
  result.attending = [...new Set(result.attending)];

  // Also grab any calendar/org page links on their profile
  const calLinks = await page.evaluate(() => {
    return [...document.querySelectorAll('a[href]')]
      .map(a => a.href)
      .filter(h => h.includes('/calendar/cal-') || (h.includes('luma.com/@') || h.includes('lu.ma/@')));
  });
  result.calendarPages = [...new Set(calLinks)];

  return result;
}

// ---------------------------------------------------------------------------
// Core: scrape an event page for its attendees
// ---------------------------------------------------------------------------
async function scrapeEventAttendees(page, eventUrl) {
  console.log(`\nLoading event: ${eventUrl}`);
  await page.goto(eventUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await waitForAny(page, ['h1', '[class*="event"]', 'main'], 6000);

  // Try to click "See All Guests" or similar
  const clicked = await page.evaluate(() => {
    const btns = [...document.querySelectorAll('button, a')];
    for (const btn of btns) {
      const text = btn.textContent?.trim() || '';
      if (/see all|view all|guests|attendees/i.test(text)) {
        btn.click();
        return text;
      }
    }
    return null;
  });
  if (clicked) {
    console.log(`  Clicked: "${clicked}"`);
    await page.waitForTimeout(1500);
  }

  await scrollToBottom(page, 20);

  // Get event title
  const title = await page.evaluate(() => document.querySelector('h1')?.textContent?.trim() || '');

  // Get organizer info from JSON-LD
  const organizers = await page.evaluate(() => {
    const scripts = [...document.querySelectorAll('script[type="application/ld+json"]')];
    for (const s of scripts) {
      try {
        const d = JSON.parse(s.textContent);
        if (d.organizer) {
          const orgs = Array.isArray(d.organizer) ? d.organizer : [d.organizer];
          return orgs.map(o => ({ name: o.name, url: o.url }));
        }
      } catch { /* skip */ }
    }
    return [];
  });

  const attendees = await extractAttendeeUrls(page);

  return { eventUrl, title, organizers, attendees };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  await withBrowser(opts.state, async (page) => {

    if (opts.user) {
      // ---- User mode: show what they're hosting and attending ----
      const visited = new Set();
      const queue = [opts.user];
      const allEvents = new Set();

      for (let depth = 0; depth < opts.depth && queue.length; depth++) {
        const batch = [...queue];
        queue.length = 0;

        for (const username of batch) {
          if (visited.has(username)) continue;
          visited.add(username);

          const result = await scrapeUserEvents(page, username);

          console.log(`\n=== ${result.username} (${result.profileUrl}) ===`);
          console.log(`  Hosting (${result.hosting.length}):`);
          result.hosting.forEach(e => { console.log(`    ${e}`); allEvents.add(e); });
          console.log(`  Attending (${result.attending.length}):`);
          result.attending.forEach(e => { console.log(`    ${e}`); allEvents.add(e); });
          if (result.calendarPages.length) {
            console.log(`  Calendar/org pages:`);
            result.calendarPages.forEach(c => console.log(`    ${c}`));
          }

          // If going deeper, enqueue event attendees for next depth
          if (depth + 1 < opts.depth) {
            for (const eventUrl of [...result.hosting, ...result.attending].slice(0, 10)) {
              const ev = await scrapeEventAttendees(page, eventUrl);
              for (const attendeeUrl of ev.attendees) {
                const handle = attendeeUrl.replace(/.*\/user\//, '');
                if (!visited.has(handle)) queue.push(handle);
              }
            }
          }

          if (opts.save && (result.hosting.length || result.attending.length)) {
            const cache = loadSeedCache();
            for (const e of [...result.hosting, ...result.attending]) {
              if (!cache.mined_event_urls.includes(e)) cache.mined_event_urls.push(e);
            }
            for (const c of result.calendarPages) {
              if (!cache.seed_pages.includes(c)) cache.seed_pages.push(c);
            }
            saveSeedCache(cache);
            console.log(`  Saved to seed cache.`);
          }
        }
      }

      if (allEvents.size) {
        console.log(`\n=== All discovered events (${allEvents.size}) ===`);
        [...allEvents].sort().forEach(e => console.log(`  ${e}`));
      }

    } else if (opts.event) {
      // ---- Event mode: show who's going ----
      const result = await scrapeEventAttendees(page, opts.event);

      console.log(`\n=== "${result.title}" ===`);
      console.log(`  URL: ${result.eventUrl}`);
      if (result.organizers.length) {
        console.log(`  Organizers:`);
        result.organizers.forEach(o => console.log(`    ${o.name}  ${o.url || ''}`));
      }
      console.log(`  Attendees (${result.attendees.length}):`);
      result.attendees.forEach(a => console.log(`    ${a}`));

      if (opts.save && result.attendees.length) {
        const cache = loadSeedCache();
        if (!cache.mined_event_urls.includes(opts.event)) {
          cache.mined_event_urls.push(opts.event);
        }
        saveSeedCache(cache);
        console.log(`\n  Saved event to seed cache.`);
      }
    }
  });
}

main().catch((err) => {
  console.error('\nError:', err.message);
  process.exit(1);
});
