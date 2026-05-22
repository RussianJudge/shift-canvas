drop trigger if exists employees_sync_name_columns on public.employees;

drop function if exists public.sync_employee_name_columns();

drop index if exists public.employees_business_area_idx;

create index if not exists employees_business_area_idx
on public.employees (business_area_id, schedule_id, last_name, first_name);

alter table public.employees
  drop column if exists full_name;
