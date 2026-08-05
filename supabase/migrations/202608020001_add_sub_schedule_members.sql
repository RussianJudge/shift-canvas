alter table public.sub_schedules
add column if not exists carry_workers_across_months boolean not null default false;

create table if not exists public.sub_schedule_members (
  sub_schedule_id text not null references public.sub_schedules(id) on delete cascade,
  employee_id text not null references public.employees(id) on delete cascade,
  created_at timestamptz not null default timezone('utc', now()),
  company_id text not null references public.companies(id),
  site_id text not null references public.sites(id),
  business_area_id text not null references public.business_areas(id),
  primary key (sub_schedule_id, employee_id)
);

create index if not exists sub_schedule_members_scope_idx
on public.sub_schedule_members (business_area_id, sub_schedule_id, employee_id);

alter table public.sub_schedule_members enable row level security;
