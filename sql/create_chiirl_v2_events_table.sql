create extension if not exists pgcrypto;

create table if not exists public.chiirl_v2_events (
  id uuid primary key default gen_random_uuid(),
  event_code text not null unique,
  title text not null,
  description text,
  start_datetime timestamptz not null,
  end_datetime timestamptz,
  location text,
  is_online boolean not null default false,
  external_event_url text,
  registration_mode text not null check (registration_mode in ('external_link', 'chiirl_hosted')),
  admission_mode text check (admission_mode in ('open', 'approval_required')),
  capacity integer check (capacity is null or capacity > 0),
  source_type text not null check (source_type in ('imported_external', 'chiirl_hosted')),
  created_by_profile_id uuid references public.ctc_v2_profiles (id) on delete set null,
  primary_organizer_profile_id uuid references public.ctc_v2_profiles (id) on delete set null,
  published boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_datetime is null or end_datetime >= start_datetime),
  check (
    (registration_mode = 'external_link' and external_event_url is not null)
    or registration_mode = 'chiirl_hosted'
  ),
  check (
    (source_type = 'chiirl_hosted' and registration_mode = 'chiirl_hosted')
    or source_type = 'imported_external'
  )
);

create index if not exists chiirl_v2_events_start_datetime_idx
  on public.chiirl_v2_events (start_datetime);

create index if not exists chiirl_v2_events_source_type_idx
  on public.chiirl_v2_events (source_type);

create index if not exists chiirl_v2_events_primary_organizer_idx
  on public.chiirl_v2_events (primary_organizer_profile_id);

create or replace function public.set_chiirl_v2_events_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_chiirl_v2_events_updated_at on public.chiirl_v2_events;

create trigger set_chiirl_v2_events_updated_at
before update on public.chiirl_v2_events
for each row
execute function public.set_chiirl_v2_events_updated_at();
