create table if not exists public.manual_overtime_postings (
  id text primary key,
  schedule_id text not null references public.schedules (id) on delete cascade,
  competency_id text not null references public.competencies (id) on delete cascade,
  month_key text not null,
  shift_kind text not null check (shift_kind in ('DAY', 'NIGHT')),
  posting_dates text[] not null,
  created_at timestamptz not null default now(),
  company_id text not null references public.companies (id),
  site_id text not null references public.sites (id),
  business_area_id text not null references public.business_areas (id)
);

create index if not exists manual_overtime_postings_month_scope_idx
on public.manual_overtime_postings (company_id, site_id, business_area_id, month_key, schedule_id);

alter table public.manual_overtime_postings enable row level security;

drop policy if exists "authenticated manage manual overtime postings" on public.manual_overtime_postings;

create policy "authenticated manage manual overtime postings"
on public.manual_overtime_postings
for all
to authenticated
using (true)
with check (true);

alter table public.overtime_claims
add column if not exists manual_posting_id text references public.manual_overtime_postings (id) on delete set null;

create index if not exists overtime_claims_manual_posting_idx
on public.overtime_claims (manual_posting_id);
