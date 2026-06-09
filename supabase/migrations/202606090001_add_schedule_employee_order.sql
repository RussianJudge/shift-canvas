create table if not exists public.schedule_employee_order (
  schedule_id text not null references public.schedules (id) on delete cascade,
  employee_id text not null references public.employees (id) on delete cascade,
  sort_order integer not null default 0,
  company_id text not null references public.companies(id),
  site_id text not null references public.sites(id),
  business_area_id text not null references public.business_areas(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (schedule_id, employee_id)
);

create index if not exists schedule_employee_order_schedule_idx
  on public.schedule_employee_order (schedule_id, sort_order);

create index if not exists schedule_employee_order_business_area_idx
  on public.schedule_employee_order (business_area_id, schedule_id, sort_order);

create or replace function public.update_schedule_employee_order_timestamp()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists schedule_employee_order_updated_at on public.schedule_employee_order;

create trigger schedule_employee_order_updated_at
before update on public.schedule_employee_order
for each row execute function public.update_schedule_employee_order_timestamp();

alter table public.schedule_employee_order enable row level security;

drop policy if exists "authenticated manage schedule employee order" on public.schedule_employee_order;

create policy "authenticated manage schedule employee order"
on public.schedule_employee_order
for all
to authenticated
using (true)
with check (true);
