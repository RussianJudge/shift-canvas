create table if not exists public.notifications (
  id text primary key,
  recipient_employee_id text not null references public.employees (id) on delete cascade,
  type text not null,
  title text not null,
  body text not null,
  href text,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  company_id text not null references public.companies (id),
  site_id text not null references public.sites (id),
  business_area_id text not null references public.business_areas (id)
);

create index if not exists notifications_recipient_unread_idx
on public.notifications (recipient_employee_id, read_at, created_at desc);

create index if not exists notifications_scope_created_idx
on public.notifications (company_id, site_id, business_area_id, created_at desc);

alter table public.notifications enable row level security;

drop policy if exists "authenticated manage notifications" on public.notifications;

create policy "authenticated manage notifications"
on public.notifications
for all
to authenticated
using (true)
with check (true);
