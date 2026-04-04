# Workorder

Current workorder status: no open items.

Completed:

- Reorganized the repo into `apps/scraper` and `apps/frontend`
- Moved the active scraper and frontend entrypoints into those app folders
- Added explicit weekly commands for:
  - `scraper:discover`
  - `scraper:ingest`
  - `scraper:audit`
  - `scraper:reconcile`
- Added a shared scraper DB client module
- Folded duplicate and data-quality checks into the scraper audit command
- Archived one-off research scripts into `archive/manual-research`
- Moved the Eventbrite sample page into `apps/scraper/fixtures`
- Rewrote the root README around the new operating model

If new work is needed, create a fresh workorder rather than appending stale items here.
