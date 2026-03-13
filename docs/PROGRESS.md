# CHI IRL Progress Log (March 13, 2026)

## Objective
Track what event sources are already covered, identify missing platforms, and operationalize direct-link ingestion into Supabase.

## What We Did

1. Baseline and source mapping
- Reviewed CHI IRL front page output and source HTML.
- Confirmed the event widget is embedded (Elfsight), while inbound links point to multiple platforms.
- Started classifying remaining links by platform (Luma, Meetup, mHUB, etc.).

2. Gap analysis request
- Focus shifted to: "what is on Luma that we do not have" and then to unknown/unclassified links.
- Identified that some events were not on Luma and needed direct-source handling.

3. mHUB clarification
- Confirmed at least one event was hosted directly on mHUB's site (not a Luma page).
- Decision: ingest direct mHUB event links explicitly.

4. Chibot flow updates (implemented)
- Added strict direct URL mode path so `--urls` does not trigger seed/city expansion.
- Generalized URL canonicalization beyond Luma:
  - `luma.com/<id>` normalized to canonical event URL.
  - `mhubchicago.com/events/...` normalized to canonical mHUB URL.
- Added timeout-aware fetch behavior with retry (prevents hangs).
- Added direct mHUB parser:
  - title (`evTitle`/`og:title`)
  - start date (`startDate` -> ISO with Chicago offset)
  - location (`evLocation`)
  - image (`og:image`)
- Kept existing Luma JSON-LD ingestion logic.
- Ensured mapping writes `tags` (not `tech_category`).

5. Recovery/fix pass
- Removed accidental large wrapper-function bloat that was introduced during refactor.
- Restored missing `extractMetaContent` helper.
- Validated script syntax and dry-run behavior.

## Current Working Flow

### Discovery mode (broad crawl)
```bash
node scripts/chibot.js --city chicago --max 30
```
- Uses Luma city/listing + seed expansion.
- Applies relevance + Chicago-area filters.

### Strict URL mode (targeted)
```bash
node scripts/chibot.js --dry-run --urls "<url1>,<url2>,..."
```
- Ingests only provided URLs.
- Supports Luma + Meetup + direct mHUB event URLs.
- Good for manual catch-up of known missing events.

## Meetup Expansion (Added)
- Added direct Meetup URL support in strict mode:
  - Canonicalizes Meetup event URLs to stable `https://www.meetup.com/<group>/events/<id>`.
  - Parses Meetup `Event` JSON-LD for title, datetime, location, and attendance mode.
- Validated with live dry-run:
  - `https://www.meetup.com/chicago-data-night/events/313490854`
- Verified mixed-source strict mode works in one run:
  - Luma + Meetup + mHUB.

## Validation Snapshot
Dry run succeeded on mixed tests:
- Luma event URL
- Meetup event URL
- mHUB direct event URL

Both produced valid event rows with `title`, `start_datetime`, `tags`, `eventUrl`, `location`, `image_url`.

## Updated Docs
- `chibot/SKILL.md` now reflects:
  - Luma + Meetup + mHUB support
  - strict URL mode semantics
  - `tags` output schema
  - timeout/retry behavior

## Known Constraints
- Strict URL mode now supports Luma, Meetup, mHUB, and Eventbrite hosts.
- Meetup occasionally requires authenticated fallback for member-gated pages.

## Eventbrite Ingestion Added (March 13, 2026)

### What changed
- Added Eventbrite host support to `scripts/chibot.js`:
  - URL canonicalization now normalizes Eventbrite links.
  - Strict URL ingestion now accepts Eventbrite pages.
  - Unsupported-host message updated to include Eventbrite.
- Upgraded JSON-LD parsing to handle common non-`Event` schema types (e.g. `SocialEvent`) and nested structures (`@graph`/deep objects).
- Updated skill docs in `chibot/SKILL.md` to reflect Eventbrite support.

### Validation (real inserts)
- Inserted Eventbrite events into `beta_chiirl_events`:
  - `https://www.eventbrite.com/e/red-bull-basement-innovation-summit-tickets-1981690204748`
  - `https://www.eventbrite.com/e/chicago-climate-connect-tickets-1980519244374`

### Current Reconciliation Snapshot (CHIIRL front page vs DB)
- Canonical event links detected from CHIIRL: `68`
- Present in `beta_chiirl_events`: `66`
- Remaining unresolved: `2` (both known dead links):
  - `https://luma.com/mcpchicago` (404)
  - `https://www.meetup.com/chicago-tech-mixer-and-social-tech-ai-data/events/312412669` (dead)

## Frontend + Ops Updates (March 13, 2026)

### Documentation + licensing
- Added root `README.md` with:
  - project purpose
  - environment setup
  - ingestion commands (discovery + strict URL + Meetup auth)
  - API/server usage
- Added root `LICENSE` as MIT.

### New frontend views on `/`
- Added `Email Draft` tab button (next to Real/Inaccurate):
  - renders copy-ready plain text style in-page (`<pre>`)
  - event titles are clickable links to source `eventUrl`
  - includes `copy` action
- Added `Calendar` tab button:
  - monthly grid view with prev/next month navigation
  - each day lists event links with short time labels
  - calendar view is now hard-pinned to `beta_chiirl_events` (`real` source), even if `source=inaccurate` is present.

### Export route
- Added `GET /email.txt` (plus `?source=...`) to return plain-text email draft output.
- Email draft now includes all upcoming events from the selected source (not only current week), grouped by day.

### Data cleanup
- Found and removed duplicate `Founder’s Therapy - Coffee Roundtable` row in `beta_chiirl_events`.
- Kept canonical Meetup URL row and preserved fuller location details.
