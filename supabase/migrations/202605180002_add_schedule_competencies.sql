create table if not exists public.schedule_competencies (
  schedule_id text not null references public.schedules(id) on delete cascade,
  competency_id text not null references public.competencies(id) on delete cascade,
  company_id text not null,
  site_id text not null,
  business_area_id text not null,
  created_at timestamptz not null default timezone('utc', now()),
  primary key (schedule_id, competency_id)
);

alter table public.schedule_competencies enable row level security;

drop policy if exists "authenticated manage schedule competencies" on public.schedule_competencies;

create policy "authenticated manage schedule competencies"
on public.schedule_competencies
for all
to authenticated
using (true)
with check (true);

insert into public.schedule_competencies (
  schedule_id,
  competency_id,
  company_id,
  site_id,
  business_area_id
)
select
  schedules.id,
  competencies.id,
  schedules.company_id,
  schedules.site_id,
  schedules.business_area_id
from public.schedules
join public.competencies
  on competencies.company_id = schedules.company_id
 and competencies.site_id = schedules.site_id
 and competencies.business_area_id = schedules.business_area_id
on conflict (schedule_id, competency_id) do nothing;

create index if not exists schedule_competencies_schedule_idx
  on public.schedule_competencies (schedule_id);
