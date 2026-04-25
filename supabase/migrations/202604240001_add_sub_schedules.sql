alter table public.time_codes
add column if not exists usage_mode text not null default 'manual'
check (usage_mode in ('manual', 'projected_only', 'both'));

create table if not exists public.sub_schedules (
  id text primary key,
  name text not null,
  summary_time_code_id text not null references public.time_codes(id),
  is_archived boolean not null default false,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  company_id text not null references public.companies(id),
  site_id text not null references public.sites(id),
  business_area_id text not null references public.business_areas(id)
);

create table if not exists public.sub_schedule_assignments (
  id text primary key,
  sub_schedule_id text not null references public.sub_schedules(id) on delete cascade,
  employee_id text not null references public.employees(id) on delete cascade,
  assignment_date date not null,
  competency_id text references public.competencies(id) on delete set null,
  notes text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  company_id text not null references public.companies(id),
  site_id text not null references public.sites(id),
  business_area_id text not null references public.business_areas(id),
  unique (sub_schedule_id, employee_id, assignment_date),
  unique (employee_id, assignment_date)
);

create index if not exists sub_schedules_business_area_name_idx
on public.sub_schedules (business_area_id, is_archived, name);

create index if not exists sub_schedule_assignments_business_area_date_idx
on public.sub_schedule_assignments (business_area_id, assignment_date, sub_schedule_id, employee_id);

create or replace function public.update_sub_schedule_timestamp()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

drop trigger if exists sub_schedules_updated_at on public.sub_schedules;
create trigger sub_schedules_updated_at
before update on public.sub_schedules
for each row
execute function public.update_sub_schedule_timestamp();

drop trigger if exists sub_schedule_assignments_updated_at on public.sub_schedule_assignments;
create trigger sub_schedule_assignments_updated_at
before update on public.sub_schedule_assignments
for each row
execute function public.update_sub_schedule_timestamp();

alter table public.sub_schedules enable row level security;
alter table public.sub_schedule_assignments enable row level security;

drop policy if exists "authenticated manage sub schedules" on public.sub_schedules;
create policy "authenticated manage sub schedules"
on public.sub_schedules
for all
to authenticated
using (true)
with check (true);

drop policy if exists "authenticated manage sub schedule assignments" on public.sub_schedule_assignments;
create policy "authenticated manage sub schedule assignments"
on public.sub_schedule_assignments
for all
to authenticated
using (true)
with check (true);
