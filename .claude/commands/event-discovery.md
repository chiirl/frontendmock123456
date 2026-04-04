---
name: event-discovery
description: Strategy guide for discovering Chicago tech events on Luma. Covers what works, what doesn't, and which approaches to use in which order.
---

# Chicago Tech Event Discovery — Strategy Guide

## What works, ranked by effectiveness

### 1. Attendee graph (best — most compounding)

`node scripts/luma-attendee-graph.js`

Take all known events → scrape every attendee → rank by frequency → explore top 25 attendees' profiles for events we don't have. Gets better every run because new events = new attendees = more surface area.

**Yield in first run:** 199 events scanned, 265 unique attendees, 47 new events found, 36 Chicago-relevant events inserted.

**Best signal sources** (most events seen across our corpus):
- `aicollective` — 31 events (The AI Collective Chicago)
- `usr-6ZUXUBKgbDe5zmj` — 23 events (Chicago Tech Collaborative)
- `AlexNova` — 17 events (1 Million Cups, crypto scene)
- `1871` — 10 events
- `maryg` — 10 events (Mary Grygleski, AI Collective)
- `digitaldem` — 9 events (Adem Arifi, crypto/web3)
- `ChristianLuna` / `usr-NahcOZWdUAO5ldH` — mHUB organizers
- `The_Maple_Coder` — Hugo Seguin's AI Book Club series

### 2. Social graph from seed users

`node scripts/luma-social-explore.js`

Start from known community members → their events → attendees of those events → their events. Best for breadth when you have good seeds.

**Yield in first run:** 80 events, 38 users across 2 depth levels starting from `evbogue` + `zecco`.

**Seed users to use:** Start from highly active community members, not yourself. `zecco`, `AlexNova`, `maryg`, `aicollective` are good seeds. Edit the `seedUsers` array in the script.

### 3. `luma.com/chicago` city page (chibot's existing approach)

`node scripts/chibot.js --city chicago --max 30`

Catches brand-new events from orgs we've never seen before. Only returns ~20-25 upcoming events at scrape time — no history, no depth. Keep running it but don't rely on it alone.

### 4. `map-orgs.js` — org name mapping

**Not a discovery tool.** Maps event URLs you already have to organizer names. Useful for building the host index but won't surface new events.

---

## What NOT to do

**Don't run chibot batches in parallel against Luma.**
We got 429 rate-limited immediately when 3 instances fired simultaneously. Always run as a single sequential job. Use `--luma-delay 1200` if hitting limits.

**Don't use `@theaicollective` as a seed page.**
Wrong handle — 404s. The correct handle is `@aicollective`. Fixed in seed-pages-cache.json.

**Don't rely on Luma `@` handle seed pages for HTML scraping.**
Luma is fully client-side rendered. Chibot gets zero event links from `@aicollective`, `@1871chicago`, etc. These seed pages only work via authenticated Playwright — not raw HTTP fetches.

**Don't seed the social graph from low-activity users.**
`evbogue` had 0 events on their profile — wasted a full traversal. Always seed from known active community members who show up at events regularly.

**Don't expect map-orgs.js to find new events.**
It only enriches URLs you already have. Run it after discovery, not instead of it.

**Don't run the attendee graph and social explore at the same time.**
Both hit Luma heavily. Run sequentially to avoid rate limits.

---

## Operational notes

**Session expiry:** `.auth/luma-state.json` will eventually expire. Signs: profiles return 0 events, attendee counts all zero, runs complete unusually fast. Fix: `npm run luma:login`.

**Non-Chicago noise:** The attendee graph will surface AI Collective Finland events, Toronto/NYC coffee clubs, etc. Chibot's location filter handles this automatically — just pass all URLs and let it filter.

**The attendee graph is self-expanding.** Every new event inserted into Supabase grows the known event corpus, which means more attendees to rank next run, which means more new events. Run it weekly for compounding returns.

**Private/deleted events** will fail with "missing event JSON-LD" — expected, not an error.

---

## Full workflow (run in this order)

```bash
# 1. Check Luma session is alive
node -e "const s=JSON.parse(require('fs').readFileSync('.auth/luma-state.json','utf8')); console.log('cookies:', s.cookies?.length)"

# 2. Primary crawl — attendee graph
node scripts/luma-attendee-graph.js

# 3. Social graph from active seed users
node scripts/luma-social-explore.js

# 4. City page for new unknowns
node scripts/chibot.js --city chicago --max 30

# 5. Insert all new discoveries into Supabase (single run, no parallelism)
node scripts/chibot.js --urls "<comma-separated URLs from scrape-dumps>"
```

See also: `/luma-crawl` for the full mechanics of each script.
