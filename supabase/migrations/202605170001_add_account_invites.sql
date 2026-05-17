create table if not exists public.account_invites (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique,
  email text not null,
  first_name text not null default '',
  last_name text not null default '',
  display_name text not null default '',
  role text not null check (role in ('admin', 'leader', 'worker')),
  company_id text not null references public.companies(id) on delete cascade,
  site_id text not null references public.sites(id) on delete cascade,
  business_area_id text not null references public.business_areas(id) on delete cascade,
  schedule_id text references public.schedules(id) on delete set null,
  employee_id text references public.employees(id) on delete set null,
  created_by_profile_id uuid references public.profiles(id) on delete set null,
  expires_at timestamptz not null default (now() + interval '7 days'),
  used_at timestamptz,
  used_by_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  check (
    (role = 'admin' and company_id is not null and site_id is not null and business_area_id is not null)
    or
    (role in ('leader', 'worker') and employee_id is not null and schedule_id is not null)
  )
);

create index if not exists account_invites_email_idx on public.account_invites (email);
create index if not exists account_invites_employee_id_idx on public.account_invites (employee_id);
create index if not exists account_invites_expires_at_idx on public.account_invites (expires_at);
create index if not exists account_invites_used_at_idx on public.account_invites (used_at);

alter table public.account_invites enable row level security;
