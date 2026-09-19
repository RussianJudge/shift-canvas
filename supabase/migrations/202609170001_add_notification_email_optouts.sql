create table if not exists public.notification_email_optouts (
  employee_id text not null references public.employees (id) on delete cascade,
  notification_type text not null,
  created_at timestamptz not null default now(),
  primary key (employee_id, notification_type)
);

alter table public.notification_email_optouts enable row level security;

drop policy if exists "authenticated manage notification email optouts" on public.notification_email_optouts;

create policy "authenticated manage notification email optouts"
on public.notification_email_optouts
for all
to authenticated
using (true)
with check (true);
