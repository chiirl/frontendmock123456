#!/usr/bin/env node
// Walk all historical Luma events from Supabase, fetch each page,
// extract the host org name and their Luma profile/calendar URL,
// and save a deduplicated report plus a rich host index for later mining.
require('dotenv').config();
const fs = require('fs');
const https = require('https');
const http = require('http');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const DUMPS_DIR = path.resolve(process.cwd(), '.scrape-dumps');
const OUTPUT_FILE = path.join(DUMPS_DIR, 'luma-orgs.json');
const HOST_INDEX_FILE = path.join(DUMPS_DIR, 'host-index.json');
const DELAY_MS = 800;
const CONCURRENCY = 3;

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY
);

const TABLES = [
  process.env.SUPABASE_TABLE || 'beta_chiirl_events',
  process.env.SUPABASE_INACCURATE_TABLE || 'CTC Current Events',
];

function fetchText(url) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http;
    const req = lib.get(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; chiirl-bot/1.0)', Accept: 'text/html' },
      timeout: 15000,
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchText(new URL(res.headers.location, url).href).then(resolve).catch(reject);
      }
      if (res.statusCode === 429) return reject(new Error('429'));
      if (res.statusCode >= 400) return reject(new Error(`HTTP ${res.statusCode}`));
      let data = '';
      res.on('data', (d) => { data += d; });
      res.on('end', () => resolve(data));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
  });
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

// Extract organizer name from Luma event page HTML
function extractOrgName(html) {
  const jsonLdMatch = html.match(/<script[^>]+type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/i);
  if (jsonLdMatch) {
    try {
      const data = JSON.parse(jsonLdMatch[1]);
      const organizer = data.organizer;
      if (organizer) {
        return Array.isArray(organizer)
          ? organizer.map((o) => o.name).filter(Boolean).join(', ')
          : organizer.name || null;
      }
    } catch { /* fall through */ }
  }
  const metaMatch = html.match(/<meta[^>]+property="og:site_name"[^>]+content="([^"]+)"/i);
  if (metaMatch) return metaMatch[1];
  return null;
}

// Extract org Luma profile/calendar URLs from event page
function extractOrgPages(html) {
  const pages = new Set();
  const linkRe = /href=["']([^"']+)["']/gi;
  let m;
  while ((m = linkRe.exec(html)) !== null) {
    try {
      const resolved = m[1].startsWith('http') ? m[1] : new URL(m[1], 'https://luma.com').href;
      const u = new URL(resolved);
      const host = u.hostname.toLowerCase();
      const p = u.pathname;
      if (host.includes('luma.com') || host.includes('lu.ma')) {
        if (/^\/calendar\/cal-/i.test(p) || /^\/@[^/]+$/.test(p)) {
          pages.add(`https://luma.com${p}`);
        }
      }
    } catch { /* ignore */ }
  }
  return [...pages];
}

// Build a host index from the full event→org mapping.
// host-index.json: { "Host Name": { eventCount, events: [...], lumaPages: [...] } }
function buildHostIndex(eventMap) {
  const index = {};

  for (const [eventUrl, result] of Object.entries(eventMap)) {
    if (result.error || !result.orgName) continue;

    const names = result.orgName.split(',').map((n) => n.trim()).filter(Boolean);
    for (const name of names) {
      if (!index[name]) {
        index[name] = { eventCount: 0, events: [], lumaPages: [] };
      }
      index[name].eventCount += 1;
      if (!index[name].events.includes(eventUrl)) {
        index[name].events.push(eventUrl);
      }
      for (const page of result.orgPages || []) {
        if (!index[name].lumaPages.includes(page)) {
          index[name].lumaPages.push(page);
        }
      }
    }
  }

  // Sort each host's events and pages for stable output
  for (const entry of Object.values(index)) {
    entry.events.sort();
    entry.lumaPages.sort();
  }

  return index;
}

async function main() {
  fs.mkdirSync(DUMPS_DIR, { recursive: true });

  // Load existing results so we can resume
  let existing = {};
  try { existing = JSON.parse(fs.readFileSync(OUTPUT_FILE, 'utf8')); } catch { /* fresh start */ }

  const allLumaUrls = new Set();
  for (const table of TABLES) {
    console.log(`Fetching Luma event URLs from "${table}"...`);
    const { data, error } = await supabase.from(table).select('eventUrl,title').limit(5000);
    if (error) { console.warn(`  Skipped (${error.message})`); continue; }
    for (const row of data || []) {
      const url = (row.eventUrl || '').trim();
      if (url.includes('luma.com') || url.includes('lu.ma')) allLumaUrls.add(url);
    }
    console.log(`  Got ${data?.length || 0} rows`);
  }

  const toFetch = [...allLumaUrls].filter((u) => !existing[u]);
  console.log(`\nTotal Luma event URLs: ${allLumaUrls.size}`);
  console.log(`Already fetched: ${Object.keys(existing).length}`);
  console.log(`To fetch: ${toFetch.length}\n`);

  let done = 0;
  let consecutive429s = 0;
  const MAX_CONSECUTIVE_429S = 3;

  for (let i = 0; i < toFetch.length; i++) {
    const url = toFetch[i];
    if (i > 0) await sleep(DELAY_MS + Math.random() * 200);
    try {
      const html = await fetchText(url);
      const orgName = extractOrgName(html);
      const orgPages = extractOrgPages(html);
      existing[url] = { orgName, orgPages };
      consecutive429s = 0;
      done++;
      if (done % 10 === 0 || done === toFetch.length) {
        console.log(`  [${done}/${toFetch.length}] ${url} → ${orgName || '(unknown)'} ${orgPages.length ? orgPages.join(', ') : ''}`);
        fs.writeFileSync(OUTPUT_FILE, JSON.stringify(existing, null, 2));
      } else {
        process.stdout.write(`  ${done}/${toFetch.length}: ${orgName || '?'}\r`);
      }
    } catch (err) {
      if (err.message === '429') {
        consecutive429s++;
        console.log(`\n  [${i + 1}/${toFetch.length}] 429 rate limited — ${url} (${consecutive429s} consecutive)`);
        if (consecutive429s >= MAX_CONSECUTIVE_429S) {
          console.log(`  Hit ${MAX_CONSECUTIVE_429S} consecutive 429s — saving progress and stopping.`);
          console.log(`  Re-run to pick up where we left off (${done} done, ${toFetch.length - done} remaining).`);
          fs.writeFileSync(OUTPUT_FILE, JSON.stringify(existing, null, 2));
          break;
        }
        await sleep(5000);
      } else {
        existing[url] = { error: err.message };
      }
    }
  }

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(existing, null, 2));

  // Build and save the host index
  const hostIndex = buildHostIndex(existing);
  fs.writeFileSync(HOST_INDEX_FILE, JSON.stringify(hostIndex, null, 2));

  // Print ranked host list
  const sorted = Object.entries(hostIndex).sort((a, b) => b[1].eventCount - a[1].eventCount || a[0].localeCompare(b[0]));

  console.log(`\n=== ${sorted.length} unique hosts found across ${Object.keys(existing).length} events ===\n`);
  sorted.slice(0, 100).forEach(([name, data], i) => {
    const pages = data.lumaPages.length ? `  →  ${data.lumaPages.join(', ')}` : '';
    console.log(`  ${String(i + 1).padStart(3)}. ${name} (${data.eventCount})${pages}`);
  });

  console.log(`\nFull event map:  ${OUTPUT_FILE}`);
  console.log(`Host index:      ${HOST_INDEX_FILE}`);
  if (consecutive429s > 0) console.log(`Rate limited on some URLs — re-run to retry them.`);
}

main().catch((err) => { console.error(err); process.exit(1); });
