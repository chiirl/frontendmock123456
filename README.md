# CHI IRL

This repo now has two maintained products:

- `apps/scraper`
  - weekly Chicago IRL event discovery, ingestion, auditing, and reconciliation
- `apps/frontend`
  - Express frontend and API for the curated event set in Supabase

Everything maintained in the active repo should support one of those two products.
Old one-off research scripts have been moved to `archive/manual-research/`.

## Repo Layout

```text
apps/
  frontend/
  scraper/
archive/
  manual-research/
docs/
sql/
```

## Requirements

- Node.js 18+
- Supabase project + keys
- Optional: Playwright Chromium for login-assisted scraping

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

If you need headed login helpers:

```bash
npx playwright install chromium
```

## Frontend Commands

```bash
npm start
npm run dev
```

## Scraper Commands

Discovery only, no writes:

```bash
npm run scraper:discover -- --city chicago --max 30
```

Ingest new or changed events:

```bash
npm run scraper:ingest -- --city chicago --max 30
```

Audit the upcoming DB for duplicates, online rows, non-Chicago rows, and missing fields:

```bash
npm run scraper:audit
```

Reconcile candidate discoveries against the DB:

```bash
npm run scraper:reconcile -- --urls "https://luma.com/abc123"
```

## Login Helpers

```bash
npm run meetup:login -- --email <your_meetup_email>
npm run luma:login
```

## Current Weekly Operating Loop

1. Run `scraper:discover` or `scraper:reconcile`
2. Review the dry-run output and scrape dump
3. Run `scraper:ingest`
4. Run `scraper:audit`
5. Investigate anything reported as stale, unsupported, duplicate, online, or non-Chicago

## Notes

- The scraper writes to `beta_chiirl_events` by default.
- The frontend reads from the same table.
- SQL migrations remain in `sql/`.
- Working notes remain in `docs/`.
