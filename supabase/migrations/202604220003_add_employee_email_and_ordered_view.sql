alter table public.employees
  add column if not exists email text;

update public.employees
set email = lower(btrim(email))
where email is not null;

create unique index if not exists employees_email_unique_idx
on public.employees (lower(btrim(email)))
where email is not null and btrim(email) <> '';

create or replace view public.employees_ordered
with (security_invoker = true)
as
select
  id,
  first_name,
  last_name,
  email,
  schedule_id,
  role_title,
  is_active,
  company_id,
  site_id,
  business_area_id,
  created_at
from public.employees;

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  next_role text;
  next_display_name text;
  matched_employee_id text;
  matched_schedule_id text;
  matched_company_id text;
  matched_site_id text;
  matched_business_area_id text;
  matched_first_name text;
  matched_last_name text;
begin
  select
    employees.id,
    employees.schedule_id,
    employees.company_id,
    employees.site_id,
    employees.business_area_id,
    employees.first_name,
    employees.last_name
  into
    matched_employee_id,
    matched_schedule_id,
    matched_company_id,
    matched_site_id,
    matched_business_area_id,
    matched_first_name,
    matched_last_name
  from public.employees
  where lower(btrim(employees.email)) = lower(btrim(coalesce(new.email, '')))
    and employees.is_active = true
  limit 1;

  next_role := case
    when new.raw_user_meta_data ->> 'role' in ('admin', 'leader', 'worker')
      then new.raw_user_meta_data ->> 'role'
    else 'worker'
  end;

  next_display_name := coalesce(
    nullif(new.raw_user_meta_data ->> 'display_name', ''),
    nullif(btrim(concat_ws(' ', matched_first_name, matched_last_name)), ''),
    split_part(coalesce(new.email, ''), '@', 1)
  );

  insert into public.profiles (
    id,
    email,
    display_name,
    role,
    schedule_id,
    employee_id,
    company_id,
    site_id,
    business_area_id
  )
  values (
    new.id,
    lower(btrim(coalesce(new.email, ''))),
    next_display_name,
    next_role,
    matched_schedule_id,
    matched_employee_id,
    coalesce(matched_company_id, 'company-suncor'),
    coalesce(matched_site_id, 'site-mildred-lake'),
    coalesce(matched_business_area_id, 'business-area-sgd')
  )
  on conflict (id) do update
  set
    email = excluded.email,
    display_name = excluded.display_name,
    schedule_id = coalesce(public.profiles.schedule_id, excluded.schedule_id),
    employee_id = coalesce(public.profiles.employee_id, excluded.employee_id),
    company_id = coalesce(public.profiles.company_id, excluded.company_id),
    site_id = coalesce(public.profiles.site_id, excluded.site_id),
    business_area_id = coalesce(public.profiles.business_area_id, excluded.business_area_id);

  return new;
end;
$$;

update public.profiles as profile
set
  employee_id = coalesce(profile.employee_id, employee.id),
  schedule_id = coalesce(profile.schedule_id, employee.schedule_id),
  company_id = employee.company_id,
  site_id = employee.site_id,
  business_area_id = employee.business_area_id
from public.employees as employee
where lower(btrim(profile.email)) = lower(btrim(employee.email))
  and employee.email is not null
  and btrim(employee.email) <> ''
  and profile.role = 'worker';
