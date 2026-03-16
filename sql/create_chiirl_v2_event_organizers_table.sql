create table if not exists public.chiirl_v2_event_organizers (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.chiirl_v2_events (id) on delete cascade,
  organizer_profile_id uuid not null references public.ctc_v2_profiles (id) on delete restrict,
  organizer_role text not null default 'co_host' check (organizer_role in ('primary', 'co_host')),
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  unique (event_id, organizer_profile_id),
  unique (event_id, sort_order)
);

create unique index if not exists chiirl_v2_event_organizers_primary_idx
  on public.chiirl_v2_event_organizers (event_id)
  where organizer_role = 'primary';

create index if not exists chiirl_v2_event_organizers_profile_idx
  on public.chiirl_v2_event_organizers (organizer_profile_id);
