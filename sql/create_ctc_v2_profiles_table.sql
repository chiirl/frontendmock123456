create extension if not exists citext;

create table if not exists public.ctc_v2_profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email citext unique not null,
  username citext unique,
  display_name text not null,
  profile_type text not null check (profile_type in ('person', 'organization')),
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists ctc_v2_profiles_profile_type_idx
  on public.ctc_v2_profiles (profile_type);

create or replace function public.set_ctc_v2_profiles_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

do $$
begin
  if not exists (
    select 1
    from pg_trigger
    where tgname = 'set_ctc_v2_profiles_updated_at'
      and tgrelid = 'public.ctc_v2_profiles'::regclass
  ) then
    create trigger set_ctc_v2_profiles_updated_at
    before update on public.ctc_v2_profiles
    for each row
    execute function public.set_ctc_v2_profiles_updated_at();
  end if;
end
$$;

alter table public.ctc_v2_profiles enable row level security;

grant select, insert, update on public.ctc_v2_profiles to authenticated;
revoke all on public.ctc_v2_profiles from anon;

drop policy if exists "profiles_select_own" on public.ctc_v2_profiles;
create policy "profiles_select_own"
on public.ctc_v2_profiles
for select
to authenticated
using ((select auth.uid()) = id);

drop policy if exists "profiles_insert_own" on public.ctc_v2_profiles;
create policy "profiles_insert_own"
on public.ctc_v2_profiles
for insert
to authenticated
with check ((select auth.uid()) = id);

drop policy if exists "profiles_update_own" on public.ctc_v2_profiles;
create policy "profiles_update_own"
on public.ctc_v2_profiles
for update
to authenticated
using ((select auth.uid()) = id)
with check ((select auth.uid()) = id);
