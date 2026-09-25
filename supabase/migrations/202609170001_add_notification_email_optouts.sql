create table if not exists public.notification_email_optouts (
  employee_id text not null references public.employees (id) on delete cascade,
  notification_type text not null,
  created_at timestamptz not null default now(),
  primary key (employee_id, notification_type)
);

-- RLS on with no policy: only the service role, which bypasses RLS, can reach
-- this table. Every read and write goes through server code that takes the
-- employee from the session, so a signed-in user calling the REST API directly
-- cannot mute or inspect anyone else's email preferences.
alter table public.notification_email_optouts enable row level security;
