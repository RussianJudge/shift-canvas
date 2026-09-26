-- Where a worker would rather receive notification email.
--
-- Separate from employees.email, which stays the address Personnel manages and
-- the one invites go to. A personal address belongs to the worker, not to the
-- personnel record their leader reads and edits.
--
-- A table rather than a column on employees: every scheduler query selects the
-- employee columns, so an unmigrated column would take those queries down,
-- while a missing table simply reads as "no override".
create table if not exists public.notification_email_overrides (
  employee_id text primary key references public.employees (id) on delete cascade,
  email text not null,
  -- Null until the address is confirmed. Mail keeps going to the personnel
  -- address until then, so a typo can never silence someone.
  verified_at timestamptz,
  token_hash text unique,
  token_expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Service role only, like the opt-out table: every read and write goes through
-- server code that takes the employee from the session.
alter table public.notification_email_overrides enable row level security;
