---
name: luma-crawl
description: Run the full Luma social graph crawl to discover new Chicago tech events via authenticated Playwright. Scrapes attendees from all known events, ranks frequent attendees, explores their profiles for undiscovered events, and saves results to .scrape-dumps/.
---

# Luma Social Graph Crawl

Use this skill when the user wants to discover new Luma events by crawling the Chicago tech social graph.

## How it works

Three complementary strategies, run in order:

1. **Attendee graph** (`luma-attendee-graph.js`) — best for depth. Takes all known events from `.scrape-dumps/`, scrapes every attendee, ranks by frequency, explores top 25 attendees' profiles for events we're missing.
2. **Social explore** (`luma-social-explore.js`) — best for breadth. Starts from seed users, follows their events, then follows attendees of those events 2 levels deep.
3. **chibot city page** — catches brand-new orgs we've never seen. Run separately via `/chibot`.

## Prerequisites

- `.auth/luma-state.json` must exist (saved Playwright session).
- If missing or expired, run login first:
  ```
  ! npm run luma:login
  ```
  A headed browser opens → log in with your email magic link → press Enter.

- `node_modules` must be installed (playwright is a devDependency):
  ```
  npm install
  ```

## Step 1 — Check session is valid

```bash
node -e "const f=require('fs'); const s=JSON.parse(f.readFileSync('.auth/luma-state.json','utf8')); console.log('cookies:', s.cookies?.length, '| localStorage keys:', Object.keys(s.origins?.[0]?.localStorage||{}).length)"
```

If it errors or shows 0 cookies, re-run login.

## Step 2 — Run attendee graph (primary crawl)

```bash
node scripts/luma-attendee-graph.js
```

- Scans all known events in `.scrape-dumps/luma-orgs.json`, `seed-pages-cache.json`, and `social-explore.json`
- Takes ~10-15 min depending on how many events are known
- Outputs: `.scrape-dumps/attendee-graph.json`
- Auto-saves new event URLs to `seed-pages-cache.json`

## Step 3 — Run social explore from key seed users

```bash
node scripts/luma-social-explore.js
```

Seed users are hardcoded as `evbogue` and `zecco` in the script. Edit the `seedUsers` array to add others.

- Outputs: `.scrape-dumps/social-explore.json`
- Auto-saves new event URLs to `seed-pages-cache.json`

## Step 4 — Feed discoveries into chibot

Once new event URLs are in the seed cache, run chibot in strict URL mode to scrape and upsert them:

```bash
node scripts/chibot.js --urls "<url1>,<url2>,..."
```

Or let chibot pick them up automatically on next discovery run — they're in the seed cache.

## Output files

| File | Contents |
|------|----------|
| `.scrape-dumps/attendee-graph.json` | Top attendees ranked by frequency + all new events found |
| `.scrape-dumps/social-explore.json` | Events + users found via social graph from seed users |
| `.scrape-dumps/luma-orgs.json` | Raw event URL → orgName mapping (resume-safe) |
| `.scrape-dumps/host-index.json` | Host name → { eventCount, events[], lumaPages[] } |
| `.scrape-dumps/seed-pages-cache.json` | Seed org pages + all mined event URLs for chibot |

## Key orgs / frequent attendees to know

These show up across the most events and are the best signal sources:

- `aicollective` — The AI Collective Chicago (31 events seen)
- `usr-6ZUXUBKgbDe5zmj` — Chicago Tech Collaborative (23 events)
- `AlexNova` — Alex Nova, 1 Million Cups + crypto scene (17 events)
- `1871` — 1871 Chicago (10 events)
- `maryg` — Mary Grygleski, AI Collective (10 events)
- `digitaldem` — Adem Arifi, crypto/web3 (9 events)
- `ChristianLuna` / `usr-NahcOZWdUAO5ldH` — mHUB organizers
- `The_Maple_Coder` — Hugo Seguin's AI Book Club

## Explore a specific user

```bash
node scripts/luma-explore.js --user <handle>
node scripts/luma-explore.js --user <handle> --depth 2 --save
```

## Session expiry

Luma magic link sessions typically last weeks but will eventually expire. Signs of expiry:
- Profile pages return 0 events
- Events consistently show 0 attendees
- Script completes unusually fast

Re-run `npm run luma:login` to refresh.
