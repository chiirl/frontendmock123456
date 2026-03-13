-- Run this after tags are fully backfilled and verified.
alter table public.beta_chiirl_events
  drop column if exists tech_category;
