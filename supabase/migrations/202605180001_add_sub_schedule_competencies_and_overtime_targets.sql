create table if not exists public.sub_schedule_competencies (
  sub_schedule_id text not null references public.sub_schedules(id) on delete cascade,
  competency_id text not null references public.competencies(id) on delete cascade,
  created_at timestamptz not null default timezone('utc', now()),
  company_id text not null references public.companies(id),
  site_id text not null references public.sites(id),
  business_area_id text not null references public.business_areas(id),
  primary key (sub_schedule_id, competency_id)
);

create index if not exists sub_schedule_competencies_scope_idx
on public.sub_schedule_competencies (business_area_id, sub_schedule_id, competency_id);

alter table public.sub_schedule_competencies enable row level security;

drop policy if exists "authenticated manage sub schedule competencies" on public.sub_schedule_competencies;
create policy "authenticated manage sub schedule competencies"
on public.sub_schedule_competencies
for all
to authenticated
using (true)
with check (true);

alter table public.manual_overtime_postings
add column if not exists sub_schedule_id text references public.sub_schedules(id) on delete cascade;

alter table public.manual_overtime_postings
alter column schedule_id drop not null;

alter table public.manual_overtime_postings
drop constraint if exists manual_overtime_postings_target_check;

alter table public.manual_overtime_postings
add constraint manual_overtime_postings_target_check
check (
  (schedule_id is not null and sub_schedule_id is null)
  or (schedule_id is null and sub_schedule_id is not null)
);

create index if not exists manual_overtime_postings_month_sub_schedule_idx
on public.manual_overtime_postings (company_id, site_id, business_area_id, month_key, sub_schedule_id);

alter table public.overtime_claims
add column if not exists sub_schedule_id text references public.sub_schedules(id) on delete cascade;

alter table public.overtime_claims
alter column schedule_id drop not null;

alter table public.overtime_claims
drop constraint if exists overtime_claims_schedule_id_employee_id_assignment_date_key;

alter table public.overtime_claims
drop constraint if exists overtime_claims_target_check;

alter table public.overtime_claims
add constraint overtime_claims_target_check
check (
  (schedule_id is not null and sub_schedule_id is null)
  or (schedule_id is null and sub_schedule_id is not null)
);

create unique index if not exists overtime_claims_schedule_employee_date_unique
on public.overtime_claims (schedule_id, employee_id, assignment_date)
where sub_schedule_id is null;

create unique index if not exists overtime_claims_sub_schedule_employee_date_unique
on public.overtime_claims (sub_schedule_id, employee_id, assignment_date)
where schedule_id is null;

create index if not exists overtime_claims_sub_schedule_date_idx
on public.overtime_claims (sub_schedule_id, assignment_date);
