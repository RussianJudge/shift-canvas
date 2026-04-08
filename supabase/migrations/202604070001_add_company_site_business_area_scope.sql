create table if not exists public.companies (
  id text primary key,
  name text not null unique,
  created_at timestamptz not null default now()
);

create table if not exists public.sites (
  id text primary key,
  company_id text not null references public.companies(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now(),
  unique (company_id, name)
);

create table if not exists public.business_areas (
  id text primary key,
  site_id text not null references public.sites(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now(),
  unique (site_id, name)
);

insert into public.companies (id, name)
values ('company-suncor', 'Suncor')
on conflict (id) do update
set name = excluded.name;

insert into public.sites (id, company_id, name)
values ('site-mildred-lake', 'company-suncor', 'Mildred Lake')
on conflict (id) do update
set
  company_id = excluded.company_id,
  name = excluded.name;

insert into public.business_areas (id, site_id, name)
values ('business-area-sgd', 'site-mildred-lake', 'SG&D')
on conflict (id) do update
set
  site_id = excluded.site_id,
  name = excluded.name;

alter table public.production_units add column if not exists company_id text references public.companies(id);
alter table public.production_units add column if not exists site_id text references public.sites(id);
alter table public.production_units add column if not exists business_area_id text references public.business_areas(id);

alter table public.schedules add column if not exists company_id text references public.companies(id);
alter table public.schedules add column if not exists site_id text references public.sites(id);
alter table public.schedules add column if not exists business_area_id text references public.business_areas(id);

alter table public.competencies add column if not exists company_id text references public.companies(id);
alter table public.competencies add column if not exists site_id text references public.sites(id);
alter table public.competencies add column if not exists business_area_id text references public.business_areas(id);

alter table public.time_codes add column if not exists company_id text references public.companies(id);
alter table public.time_codes add column if not exists site_id text references public.sites(id);
alter table public.time_codes add column if not exists business_area_id text references public.business_areas(id);

alter table public.employees add column if not exists company_id text references public.companies(id);
alter table public.employees add column if not exists site_id text references public.sites(id);
alter table public.employees add column if not exists business_area_id text references public.business_areas(id);

alter table public.employee_competencies add column if not exists company_id text references public.companies(id);
alter table public.employee_competencies add column if not exists site_id text references public.sites(id);
alter table public.employee_competencies add column if not exists business_area_id text references public.business_areas(id);

alter table public.schedule_assignments add column if not exists company_id text references public.companies(id);
alter table public.schedule_assignments add column if not exists site_id text references public.sites(id);
alter table public.schedule_assignments add column if not exists business_area_id text references public.business_areas(id);

alter table public.overtime_claims add column if not exists company_id text references public.companies(id);
alter table public.overtime_claims add column if not exists site_id text references public.sites(id);
alter table public.overtime_claims add column if not exists business_area_id text references public.business_areas(id);

alter table public.completed_sets add column if not exists company_id text references public.companies(id);
alter table public.completed_sets add column if not exists site_id text references public.sites(id);
alter table public.completed_sets add column if not exists business_area_id text references public.business_areas(id);

alter table public.profiles add column if not exists company_id text references public.companies(id);
alter table public.profiles add column if not exists site_id text references public.sites(id);
alter table public.profiles add column if not exists business_area_id text references public.business_areas(id);

alter table public.user_schedule_pins add column if not exists company_id text references public.companies(id);
alter table public.user_schedule_pins add column if not exists site_id text references public.sites(id);
alter table public.user_schedule_pins add column if not exists business_area_id text references public.business_areas(id);

alter table public.mutual_shift_postings add column if not exists company_id text references public.companies(id);
alter table public.mutual_shift_postings add column if not exists site_id text references public.sites(id);
alter table public.mutual_shift_postings add column if not exists business_area_id text references public.business_areas(id);

alter table public.mutual_shift_posting_dates add column if not exists company_id text references public.companies(id);
alter table public.mutual_shift_posting_dates add column if not exists site_id text references public.sites(id);
alter table public.mutual_shift_posting_dates add column if not exists business_area_id text references public.business_areas(id);

alter table public.mutual_shift_applications add column if not exists company_id text references public.companies(id);
alter table public.mutual_shift_applications add column if not exists site_id text references public.sites(id);
alter table public.mutual_shift_applications add column if not exists business_area_id text references public.business_areas(id);

alter table public.mutual_shift_application_dates add column if not exists company_id text references public.companies(id);
alter table public.mutual_shift_application_dates add column if not exists site_id text references public.sites(id);
alter table public.mutual_shift_application_dates add column if not exists business_area_id text references public.business_areas(id);

update public.production_units
set
  company_id = coalesce(company_id, 'company-suncor'),
  site_id = coalesce(site_id, 'site-mildred-lake'),
  business_area_id = coalesce(business_area_id, 'business-area-sgd');

update public.schedules
set
  company_id = coalesce(company_id, 'company-suncor'),
  site_id = coalesce(site_id, 'site-mildred-lake'),
  business_area_id = coalesce(business_area_id, 'business-area-sgd');

update public.competencies
set
  company_id = coalesce(company_id, 'company-suncor'),
  site_id = coalesce(site_id, 'site-mildred-lake'),
  business_area_id = coalesce(business_area_id, 'business-area-sgd');

update public.time_codes
set
  company_id = coalesce(company_id, 'company-suncor'),
  site_id = coalesce(site_id, 'site-mildred-lake'),
  business_area_id = coalesce(business_area_id, 'business-area-sgd');

update public.employees as employees
set
  company_id = coalesce(employees.company_id, schedules.company_id, 'company-suncor'),
  site_id = coalesce(employees.site_id, schedules.site_id, 'site-mildred-lake'),
  business_area_id = coalesce(employees.business_area_id, schedules.business_area_id, 'business-area-sgd')
from public.schedules as schedules
where schedules.id = employees.schedule_id;

update public.employee_competencies as employee_competencies
set
  company_id = coalesce(employee_competencies.company_id, employees.company_id, 'company-suncor'),
  site_id = coalesce(employee_competencies.site_id, employees.site_id, 'site-mildred-lake'),
  business_area_id = coalesce(employee_competencies.business_area_id, employees.business_area_id, 'business-area-sgd')
from public.employees as employees
where employees.id = employee_competencies.employee_id;

update public.schedule_assignments as schedule_assignments
set
  company_id = coalesce(schedule_assignments.company_id, employees.company_id, 'company-suncor'),
  site_id = coalesce(schedule_assignments.site_id, employees.site_id, 'site-mildred-lake'),
  business_area_id = coalesce(schedule_assignments.business_area_id, employees.business_area_id, 'business-area-sgd')
from public.employees as employees
where employees.id = schedule_assignments.employee_id;

update public.overtime_claims as overtime_claims
set
  company_id = coalesce(overtime_claims.company_id, schedules.company_id, 'company-suncor'),
  site_id = coalesce(overtime_claims.site_id, schedules.site_id, 'site-mildred-lake'),
  business_area_id = coalesce(overtime_claims.business_area_id, schedules.business_area_id, 'business-area-sgd')
from public.schedules as schedules
where schedules.id = overtime_claims.schedule_id;

update public.completed_sets as completed_sets
set
  company_id = coalesce(completed_sets.company_id, schedules.company_id, 'company-suncor'),
  site_id = coalesce(completed_sets.site_id, schedules.site_id, 'site-mildred-lake'),
  business_area_id = coalesce(completed_sets.business_area_id, schedules.business_area_id, 'business-area-sgd')
from public.schedules as schedules
where schedules.id = completed_sets.schedule_id;

update public.profiles
set
  company_id = coalesce(company_id, 'company-suncor'),
  site_id = coalesce(site_id, 'site-mildred-lake'),
  business_area_id = coalesce(business_area_id, 'business-area-sgd');

update public.user_schedule_pins as user_schedule_pins
set
  company_id = coalesce(user_schedule_pins.company_id, schedules.company_id, 'company-suncor'),
  site_id = coalesce(user_schedule_pins.site_id, schedules.site_id, 'site-mildred-lake'),
  business_area_id = coalesce(user_schedule_pins.business_area_id, schedules.business_area_id, 'business-area-sgd')
from public.schedules as schedules
where schedules.id = user_schedule_pins.schedule_id;

update public.mutual_shift_postings as mutual_shift_postings
set
  company_id = coalesce(mutual_shift_postings.company_id, schedules.company_id, 'company-suncor'),
  site_id = coalesce(mutual_shift_postings.site_id, schedules.site_id, 'site-mildred-lake'),
  business_area_id = coalesce(mutual_shift_postings.business_area_id, schedules.business_area_id, 'business-area-sgd')
from public.schedules as schedules
where schedules.id = mutual_shift_postings.owner_schedule_id;

update public.mutual_shift_posting_dates as mutual_shift_posting_dates
set
  company_id = coalesce(mutual_shift_posting_dates.company_id, mutual_shift_postings.company_id, 'company-suncor'),
  site_id = coalesce(mutual_shift_posting_dates.site_id, mutual_shift_postings.site_id, 'site-mildred-lake'),
  business_area_id = coalesce(mutual_shift_posting_dates.business_area_id, mutual_shift_postings.business_area_id, 'business-area-sgd')
from public.mutual_shift_postings as mutual_shift_postings
where mutual_shift_postings.id = mutual_shift_posting_dates.posting_id;

update public.mutual_shift_applications as mutual_shift_applications
set
  company_id = coalesce(mutual_shift_applications.company_id, schedules.company_id, 'company-suncor'),
  site_id = coalesce(mutual_shift_applications.site_id, schedules.site_id, 'site-mildred-lake'),
  business_area_id = coalesce(mutual_shift_applications.business_area_id, schedules.business_area_id, 'business-area-sgd')
from public.schedules as schedules
where schedules.id = mutual_shift_applications.applicant_schedule_id;

update public.mutual_shift_application_dates as mutual_shift_application_dates
set
  company_id = coalesce(mutual_shift_application_dates.company_id, mutual_shift_applications.company_id, 'company-suncor'),
  site_id = coalesce(mutual_shift_application_dates.site_id, mutual_shift_applications.site_id, 'site-mildred-lake'),
  business_area_id = coalesce(mutual_shift_application_dates.business_area_id, mutual_shift_applications.business_area_id, 'business-area-sgd')
from public.mutual_shift_applications as mutual_shift_applications
where mutual_shift_applications.id = mutual_shift_application_dates.application_id;

alter table public.competencies drop constraint if exists competencies_code_key;
alter table public.time_codes drop constraint if exists time_codes_code_key;

alter table public.production_units alter column company_id set not null;
alter table public.production_units alter column site_id set not null;
alter table public.production_units alter column business_area_id set not null;

alter table public.schedules alter column company_id set not null;
alter table public.schedules alter column site_id set not null;
alter table public.schedules alter column business_area_id set not null;

alter table public.competencies alter column company_id set not null;
alter table public.competencies alter column site_id set not null;
alter table public.competencies alter column business_area_id set not null;

alter table public.time_codes alter column company_id set not null;
alter table public.time_codes alter column site_id set not null;
alter table public.time_codes alter column business_area_id set not null;

alter table public.employees alter column company_id set not null;
alter table public.employees alter column site_id set not null;
alter table public.employees alter column business_area_id set not null;

alter table public.employee_competencies alter column company_id set not null;
alter table public.employee_competencies alter column site_id set not null;
alter table public.employee_competencies alter column business_area_id set not null;

alter table public.schedule_assignments alter column company_id set not null;
alter table public.schedule_assignments alter column site_id set not null;
alter table public.schedule_assignments alter column business_area_id set not null;

alter table public.overtime_claims alter column company_id set not null;
alter table public.overtime_claims alter column site_id set not null;
alter table public.overtime_claims alter column business_area_id set not null;

alter table public.completed_sets alter column company_id set not null;
alter table public.completed_sets alter column site_id set not null;
alter table public.completed_sets alter column business_area_id set not null;

alter table public.profiles alter column company_id set not null;
alter table public.profiles alter column site_id set not null;
alter table public.profiles alter column business_area_id set not null;

alter table public.user_schedule_pins alter column company_id set not null;
alter table public.user_schedule_pins alter column site_id set not null;
alter table public.user_schedule_pins alter column business_area_id set not null;

alter table public.mutual_shift_postings alter column company_id set not null;
alter table public.mutual_shift_postings alter column site_id set not null;
alter table public.mutual_shift_postings alter column business_area_id set not null;

alter table public.mutual_shift_posting_dates alter column company_id set not null;
alter table public.mutual_shift_posting_dates alter column site_id set not null;
alter table public.mutual_shift_posting_dates alter column business_area_id set not null;

alter table public.mutual_shift_applications alter column company_id set not null;
alter table public.mutual_shift_applications alter column site_id set not null;
alter table public.mutual_shift_applications alter column business_area_id set not null;

alter table public.mutual_shift_application_dates alter column company_id set not null;
alter table public.mutual_shift_application_dates alter column site_id set not null;
alter table public.mutual_shift_application_dates alter column business_area_id set not null;

create unique index if not exists competencies_business_area_code_idx
  on public.competencies (business_area_id, code);

create unique index if not exists time_codes_business_area_code_idx
  on public.time_codes (business_area_id, code);

create index if not exists production_units_business_area_idx on public.production_units (business_area_id, name);
create index if not exists schedules_company_idx on public.schedules (company_id, name);
create index if not exists schedules_business_area_idx on public.schedules (business_area_id, name);
create index if not exists competencies_company_idx on public.competencies (company_id, code);
create index if not exists time_codes_company_idx on public.time_codes (company_id, code);
create index if not exists employees_business_area_idx on public.employees (business_area_id, schedule_id, full_name);
create index if not exists employee_competencies_business_area_idx on public.employee_competencies (business_area_id, employee_id, competency_id);
create index if not exists assignments_business_area_date_idx on public.schedule_assignments (business_area_id, assignment_date, employee_id);
create index if not exists overtime_claims_business_area_date_idx on public.overtime_claims (business_area_id, assignment_date, schedule_id);
create index if not exists completed_sets_business_area_month_idx on public.completed_sets (business_area_id, month_key, schedule_id);
create index if not exists profiles_company_role_idx on public.profiles (company_id, role);
create index if not exists user_schedule_pins_business_area_idx on public.user_schedule_pins (business_area_id, user_id, schedule_id);
create index if not exists mutual_shift_postings_company_status_idx on public.mutual_shift_postings (company_id, status, month_key);
create index if not exists mutual_shift_applications_business_area_status_idx on public.mutual_shift_applications (business_area_id, posting_id, status);

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
    role,
    company_id,
    site_id,
    business_area_id
  )
  values (
    new.id,
    coalesce(new.email, ''),
    next_display_name,
    next_role,
    'company-suncor',
    'site-mildred-lake',
    'business-area-sgd'
  )
  on conflict (id) do update
  set
    email = excluded.email,
    display_name = excluded.display_name,
    company_id = coalesce(public.profiles.company_id, excluded.company_id),
    site_id = coalesce(public.profiles.site_id, excluded.site_id),
    business_area_id = coalesce(public.profiles.business_area_id, excluded.business_area_id);

  return new;
end;
$$;

update public.profiles
set
  company_id = coalesce(company_id, 'company-suncor'),
  site_id = coalesce(site_id, 'site-mildred-lake'),
  business_area_id = coalesce(business_area_id, 'business-area-sgd');

create or replace function public.current_company_id()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select company_id
  from public.profiles
  where id = auth.uid()
$$;

create or replace function public.current_site_id()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select site_id
  from public.profiles
  where id = auth.uid()
$$;

create or replace function public.current_business_area_id()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select business_area_id
  from public.profiles
  where id = auth.uid()
$$;

alter table public.companies enable row level security;
alter table public.sites enable row level security;
alter table public.business_areas enable row level security;

drop policy if exists "authenticated read companies" on public.companies;
drop policy if exists "authenticated read sites" on public.sites;
drop policy if exists "authenticated read business areas" on public.business_areas;

create policy "authenticated read companies"
on public.companies
for select
to authenticated
using (true);

create policy "authenticated read sites"
on public.sites
for select
to authenticated
using (true);

create policy "authenticated read business areas"
on public.business_areas
for select
to authenticated
using (true);
