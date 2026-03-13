---
name: chibot
description: Scrape Chicago-area Luma events for founder/startup/tech/AI ecosystem activity and insert clean rows into the beta_chiirl_events Supabase table. Use this when the user asks to collect or sync Luma listings into CHIIRL while excluding entertainment events.
---

# Chibot

Use this skill when the user wants to ingest Luma events into Supabase with CHIIRL filters.

## Scope

- Include: founder/startup/tech/AI ecosystem events.
- Exclude: entertainment/social-only events (music, parties, film, arts showcases, etc.).
- If an event is ambiguous (both tech and entertainment signals), stop and ask the user before inserting.

## Prerequisites

- Repo root: `/home/ev/chiirl-supa-hookup`
- `.env` contains:
  - `SUPABASE_URL`
  - `SUPABASE_SECRET_KEY`
  - `SUPABASE_TABLE=beta_chiirl_events`
- Table exists in Supabase (`beta_chiirl_events`).

## Primary Command

Scrape `luma.com/chicago`, filter relevant events, de-duplicate by `eventUrl`, and insert:

```bash
node scripts/chibot.js --city chicago --max 30
```

## Safer Review Mode

Preview payload and skip reasons before writing:

```bash
node scripts/chibot.js --city chicago --max 30 --dry-run
```

Then run without `--dry-run` to insert.

## Targeted URL Mode

Use explicit URLs when the user sends specific listings:

```bash
node scripts/chibot.js --urls "https://luma.com/abc12345,https://luma.com/def67890"
```

## Behavior Notes

- Reads Luma event metadata from `application/ld+json` (schema `Event`).
- Maps to CHIIRL columns:
  - `title`
  - `start_datetime`
  - `Online`
  - `tech_category`
  - `image_url`
  - `eventUrl`
  - `location`
  - `google_maps_url`
- Skips rows lacking required fields (`title`, `start_datetime`, `eventUrl`).
- Avoids duplicates by checking existing `eventUrl` values before insert.

## If Insert Fails

- Verify table name and keys in `.env`.
- Confirm the table exists in Supabase SQL Editor.
- Re-run with `--dry-run` to validate extracted payload.
