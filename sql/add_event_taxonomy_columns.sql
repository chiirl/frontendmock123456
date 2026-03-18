alter table public.beta_chiirl_events
  add column if not exists audience text[] default '{}'::text[],
  add column if not exists industry text[] default '{}'::text[],
  add column if not exists topic text[] default '{}'::text[],
  add column if not exists activity text[] default '{}'::text[];

create index if not exists beta_chiirl_events_audience_gin_idx
  on public.beta_chiirl_events using gin (audience);

create index if not exists beta_chiirl_events_industry_gin_idx
  on public.beta_chiirl_events using gin (industry);

create index if not exists beta_chiirl_events_topic_gin_idx
  on public.beta_chiirl_events using gin (topic);

create index if not exists beta_chiirl_events_activity_gin_idx
  on public.beta_chiirl_events using gin (activity);
