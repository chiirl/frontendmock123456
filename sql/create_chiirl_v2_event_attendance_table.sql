create table if not exists public.chiirl_v2_event_attendance (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.chiirl_v2_events (id) on delete cascade,
  profile_id uuid not null references public.ctc_v2_profiles (id) on delete cascade,
  attendance_state text not null default 'going' check (attendance_state in ('going')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (event_id, profile_id)
);

create index if not exists chiirl_v2_event_attendance_profile_idx
  on public.chiirl_v2_event_attendance (profile_id);

create index if not exists chiirl_v2_event_attendance_event_idx
  on public.chiirl_v2_event_attendance (event_id);

create or replace function public.set_chiirl_v2_event_attendance_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_chiirl_v2_event_attendance_updated_at on public.chiirl_v2_event_attendance;

create trigger set_chiirl_v2_event_attendance_updated_at
before update on public.chiirl_v2_event_attendance
for each row
execute function public.set_chiirl_v2_event_attendance_updated_at();
