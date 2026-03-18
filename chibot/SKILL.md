---
name: chibot
description: Scrape Chicago-area events (Luma + Meetup + direct mHUB + Eventbrite event pages) for founder/startup/tech/AI ecosystem activity and insert clean rows into the beta_chiirl_events Supabase table.
---

# Chibot

Use this skill when the user wants to ingest Chicago tech/startup events into Supabase with CHIIRL filters.

## Scope

- Include: founder/startup/tech/AI ecosystem events.
- Exclude: entertainment/social-only events (music, parties, film, arts showcases, etc.).
- Ambiguous events are skipped in discovery mode; in strict URL mode, direct URLs are ingested without category/location filtering.

## Prerequisites

- Repo root: `/home/ev/chiirl-supa-hookup`
- `.env` contains:
  - `SUPABASE_URL`
  - `SUPABASE_SECRET_KEY`
  - `SUPABASE_TABLE=beta_chiirl_events`
- Table exists in Supabase (`beta_chiirl_events`).

## Primary Command (Discovery Mode)

Scrape `luma.com/chicago`, expand from known seed pages, filter relevant events, de-duplicate by `eventUrl`, and insert:

```bash
node scripts/chibot.js --city chicago --max 30
```

## Safer Review Mode

Preview payload and skip reasons before writing:

```bash
node scripts/chibot.js --city chicago --max 30 --dry-run
```

Then run without `--dry-run` to insert.

## Targeted URL Mode (Strict)

Use explicit URLs when the user sends specific listings. This mode skips seed expansion and ingests only the provided URLs:

```bash
node scripts/chibot.js --urls "https://luma.com/abc12345,https://www.meetup.com/group/events/123456789,https://www.mhubchicago.com/events/some-event-123456,https://www.eventbrite.com/e/example-event-123456789"
```

## Optional Meetup Auth Fallback

Meetup auth fallback is optional and off by default. Enable it only when needed for member-gated Meetup pages that do not expose JSON-LD in normal fetches.

```bash
node scripts/chibot.js --meetup-auth --meetup-state .auth/meetup-state.json --urls "https://www.meetup.com/group/events/123456789"
```

- Requires a saved Playwright storage state file.
- Generate/update state with:

```bash
npm run meetup:login -- --email <your_email>
```

## Behavior Notes

- Reads Luma event metadata from `application/ld+json` (schema `Event`).
- Reads Meetup event metadata from `application/ld+json` (schema `Event`).
- Reads mHUB event pages from HTML/meta fields (`evTitle`, `startDate`, `evLocation`, `og:image`).
- Optionally reads Meetup `__NEXT_DATA__` via authenticated Playwright fallback when `--meetup-auth` is enabled.
- Network fetch has timeout + retry behavior.
- Maps to CHIIRL columns:
  - `title`
  - `start_datetime`
  - `Online`
  - `audience` (`text[]`)
  - `industry` (`text[]`)
  - `topic` (`text[]`)
  - `activity` (`text[]`)
  - `image_url`
  - `eventUrl`
  - `location`
  - `google_maps_url`
- Skips rows lacking required fields (`title`, `start_datetime`, `eventUrl`).
- Avoids duplicates by checking existing `eventUrl` values before insert.
- Writes taxonomy during ingest; `scripts/backfill-event-taxonomy.js` remains a repair tool for older rows, not a required second step for fresh scrapes.

## If Insert Fails

- Verify table name and keys in `.env`.
- Confirm the table exists in Supabase SQL Editor.
- Re-run with `--dry-run` to validate extracted payload.
