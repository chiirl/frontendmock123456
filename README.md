# CHIIRL Supa Hookup

CHIIRL Supa Hookup is the ingestion and API workspace for Chicago tech/startup event data.

It currently supports scraping and inserting events into Supabase from:
- Luma
- Meetup
- mHUB (direct event pages)
- Eventbrite

## What This Repo Contains

- `scripts/chibot.js`
  - Main event ingestion script.
  - Discovery mode (city + seed expansion) and strict URL mode.
- `scripts/meetup-login-headed.js`
  - Creates Meetup Playwright auth state for gated Meetup pages.
- `index.js`
  - Express API/server for reading event data.
- `docs/PROGRESS.md`
  - Working log of what has been implemented and validated.
- `sql/`
  - Table/schema migration helpers.

## Requirements

- Node.js 18+
- A Supabase project + keys
- Optional: Playwright Chromium (for Meetup auth fallback)

## Environment

Create `.env`:

```bash
SUPABASE_URL=https://<project>.supabase.co
SUPABASE_SECRET_KEY=<service_role_or_secret_key>
SUPABASE_TABLE=beta_chiirl_events
SUPABASE_INACCURATE_TABLE=CTC Current Events
```

## Install

```bash
npm install
```

If you will use Meetup authenticated fallback:

```bash
npx playwright install chromium
```

## How To Use

### 1. Discovery mode (broad crawl)

Scrapes Luma city listing + seed expansion, filters to relevant Chicago ecosystem events, then inserts new rows.

```bash
node scripts/chibot.js --city chicago --max 30
```

Dry run:

```bash
node scripts/chibot.js --city chicago --max 30 --dry-run
```

### 2. Strict URL mode (targeted ingest)

Only processes the URLs you provide.

```bash
node scripts/chibot.js --urls "https://luma.com/abc123,https://www.meetup.com/group/events/123456789,https://www.mhubchicago.com/events/example,https://www.eventbrite.com/e/example-123"
```

Dry run:

```bash
node scripts/chibot.js --dry-run --urls "https://www.eventbrite.com/e/example-123"
```

### 3. Meetup auth fallback (optional)

Needed for Meetup pages that hide event JSON-LD unless logged in.

Generate login state (headed browser):

```bash
npm run meetup:login -- --email <your_meetup_email>
```

Then run ingestion with auth enabled:

```bash
node scripts/chibot.js --meetup-auth --meetup-state .auth/meetup-state.json --urls "https://www.meetup.com/group/events/123456789"
```

## Run API Server

```bash
npm start
```

Dev mode:

```bash
npm run dev
```

## Data Notes

`chibot` writes rows to `beta_chiirl_events` using fields like:
- `title`
- `start_datetime`
- `Online`
- `tags`
- `image_url`
- `eventUrl`
- `location`
- `google_maps_url`

It de-duplicates by existing `eventUrl` values before insert.

## Troubleshooting

- `Missing SUPABASE_URL or SUPABASE_SECRET_KEY in .env`
  - Check `.env` names and values.
- `missing event JSON-LD`
  - Some pages are gated or malformed; try Meetup auth mode for Meetup links.
- `unsupported host`
  - Current first-class hosts: Luma, Meetup, mHUB, Eventbrite.

