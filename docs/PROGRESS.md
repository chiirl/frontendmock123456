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
npm run scraper:ingest -- --city chicago --max 30
```
- Uses Luma city/listing + seed expansion.
- Applies relevance + Chicago-area filters.

### Strict URL mode (targeted)
```bash
npm run scraper:reconcile -- --urls "<url1>,<url2>,..."
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
- Added Eventbrite host support to the scraper entrypoint now located at `apps/scraper/src/cli/discover.js`:
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

## Taxonomy Migration + Prototype Filters (March 18, 2026)

### Taxonomy decision
- Moved away from the old single flat `tags` filter model for the prototype.
- Adopted four structured taxonomy fields for listings:
  - `audience`
  - `industry`
  - `topic`
  - `activity`
- Explicitly dropped `stage` from the current prototype because the source data does not support it reliably.
- Kept taxonomy values multi-select.
- Treated `networking` as fallback-only for `activity` when no stronger activity is present.

### Database changes
- Added new taxonomy columns to `public.beta_chiirl_events`:
  - `audience text[]`
  - `industry text[]`
  - `topic text[]`
  - `activity text[]`
- Added helper SQL file:
  - `sql/add_event_taxonomy_columns.sql`
- Backfilled taxonomy onto all current rows in `beta_chiirl_events` using:
  - `scripts/backfill-event-taxonomy.js`
- Added proposal/exploration helper:
  - `scripts/propose-event-taxonomy.js`

### Prototype UI changes
- Replaced old tag-link filtering on `/` with dropdown filters for:
  - `audience`
  - `industry`
  - `topic`
  - `activity`
  - `mode`
- Event cards now display the structured taxonomy values instead of relying on old tag labels for filtering.
- Filtering on the `Events` tab is now client-side:
  - the full upcoming event list is rendered once
  - dropdown changes re-filter rows in the browser without a server round trip
  - URL query params are kept in sync via `history.replaceState`

### Dropdown behavior
- Removed explicit `all` from the `Audience` filter options.
- `All audiences` is now only the blank/default dropdown state.
- Dropdown options show event counts, for example `AI (24)` or `founders (45)`.
- Zero-result dropdown options are hidden unless currently selected.

### Current caveats
- Taxonomy is rule-based and still has some noisy classifications in edge cases.
- Example: some events may still pick up overlapping `activity` values such as `discussion` plus `speaker panel or fireside`.
- Next cleanup pass should tighten heuristics now that the UI and DB shape are in place.
