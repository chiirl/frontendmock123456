alter table public.beta_chiirl_events
  add column if not exists tags text[];

update public.beta_chiirl_events
set tags = string_to_array(tech_category, '|')
where (tags is null or cardinality(tags) = 0)
  and tech_category is not null
  and tech_category <> '';

create index if not exists beta_chiirl_events_tags_gin_idx
  on public.beta_chiirl_events using gin (tags);
