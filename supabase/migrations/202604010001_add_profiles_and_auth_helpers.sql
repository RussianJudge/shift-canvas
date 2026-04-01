create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null unique,
  display_name text not null default '',
  role text not null default 'worker' check (role in ('admin', 'leader', 'worker')),
  schedule_id text references public.schedules (id) on delete set null,
  employee_id text references public.employees (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists profiles_role_idx on public.profiles (role);
create index if not exists profiles_schedule_id_idx on public.profiles (schedule_id);
create index if not exists profiles_employee_id_idx on public.profiles (employee_id);

create or replace function public.update_profile_timestamp()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_updated_at on public.profiles;

create trigger profiles_updated_at
before update on public.profiles
for each row
execute function public.update_profile_timestamp();

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  next_role text;
  next_display_name text;
begin
  next_role := case
    when new.raw_user_meta_data ->> 'role' in ('admin', 'leader', 'worker')
      then new.raw_user_meta_data ->> 'role'
    else 'worker'
  end;

  next_display_name := coalesce(
    nullif(new.raw_user_meta_data ->> 'display_name', ''),
    split_part(coalesce(new.email, ''), '@', 1)
  );

  insert into public.profiles (
    id,
    email,
    display_name,
    role
  )
  values (
    new.id,
    coalesce(new.email, ''),
    next_display_name,
    next_role
  )
  on conflict (id) do update
  set
    email = excluded.email,
    display_name = excluded.display_name;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;

create trigger on_auth_user_created
after insert on auth.users
for each row
execute function public.handle_new_auth_user();

insert into public.profiles (id, email, display_name, role)
select
  users.id,
  coalesce(users.email, ''),
  split_part(coalesce(users.email, ''), '@', 1),
  'worker'
from auth.users as users
on conflict (id) do update
set
  email = excluded.email,
  display_name = case
    when public.profiles.display_name = '' then excluded.display_name
    else public.profiles.display_name
  end;

create or replace function public.current_app_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select role
  from public.profiles
  where id = auth.uid()
$$;

create or replace function public.current_schedule_id()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select schedule_id
  from public.profiles
  where id = auth.uid()
$$;

create or replace function public.current_employee_id()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select employee_id
  from public.profiles
  where id = auth.uid()
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.current_app_role() = 'admin', false)
$$;

alter table public.profiles enable row level security;

drop policy if exists "admins manage all profiles" on public.profiles;
drop policy if exists "users read own profile" on public.profiles;

create policy "admins manage all profiles"
on public.profiles
for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

create policy "users read own profile"
on public.profiles
for select
to authenticated
using (id = auth.uid());
