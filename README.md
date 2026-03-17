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
SUPABASE_PUBLISHABLE_KEY=<anon_or_publishable_key>
SUPABASE_SECRET_KEY=<service_role_or_secret_key>
SUPABASE_TABLE=beta_chiirl_events
APP_BASE_URL=http://localhost:3000
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

### 1. Discovery mode (routine crawl)

Scrapes the Luma city listing, expands from current/upcoming event seeds already in Supabase, filters to relevant Chicago ecosystem events, then inserts new rows.

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

## Auth + Profiles

The Express app now includes a minimal Supabase Auth flow for CHIIRL:
- `GET /auth` shows email magic-link sign-in
- `GET /auth/callback` verifies the magic-link token and creates a session
- `GET /me` shows the authenticated user and bootstrapped profile
- `GET /api/me` returns the current auth user + profile as JSON

This app follows the server-side Supabase email flow using `token_hash`.
The default Supabase magic-link template that returns `#access_token=...` in the URL fragment is not used here.

Before using those routes, create the shared `ctc_v2_profiles` table:

```bash
psql "$DATABASE_URL" -f sql/create_ctc_v2_profiles_table.sql
```

The first successful sign-in creates a `ctc_v2_profiles` row with:
- `id` = Supabase Auth user id
- `email`
- `display_name`
- `profile_type = person`
- optional `avatar_url`

`username` can be edited later on `/me`.

### Supabase Email Template

In Supabase `Authentication` -> `Email Templates` -> Magic Link, use a link that sends `token_hash` to this app's callback via `{{ .RedirectTo }}`:

```html
<a href="{{ .RedirectTo }}&token_hash={{ .TokenHash }}&type=email">
  Sign in to CHIIRL
</a>
```

Recommended URL setup:
- `Site URL`: `http://localhost:3000` in local dev
- Redirect allowlist should include `http://localhost:3000/auth/callback`

When CHIIRL sends the email, it sets `redirectTo` to `http://localhost:3000/auth/callback?next=%2Fme`, and the email template appends the one-time `token_hash` for server-side verification.

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
