create table if not exists time_codes (
  id text primary key,
  code text not null,
  label text not null,
  color_token text not null default 'slate',
  category text not null default 'General',
  created_at timestamptz not null default now(),
  unique (code)
);

create index if not exists time_codes_code_idx on time_codes (code);

alter table time_codes enable row level security;

drop policy if exists "authenticated read time codes" on time_codes;

create policy "authenticated read time codes"
on time_codes
for select
to authenticated
using (true);

alter table schedule_assignments add column if not exists time_code_id text references time_codes (id) on delete set null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'schedule_assignments_single_code_check'
  ) then
    alter table schedule_assignments
    add constraint schedule_assignments_single_code_check
    check (num_nonnulls(competency_id, time_code_id) <= 1);
  end if;
end
$$;

insert into time_codes (id, code, label, color_token, category)
values
  ('time-ill', 'ILL', 'Illness', 'rose', 'Absence'),
  ('time-absa', 'ABSA', 'Absent', 'orange', 'Absence'),
  ('time-bot', 'BOT', 'Booked off', 'amber', 'Leave'),
  ('time-days', 'DAYS', 'Day assignment', 'blue', 'Coverage'),
  ('time-nights', 'NIGHTS', 'Night assignment', 'violet', 'Coverage'),
  ('time-sim', 'SIM', 'Simulation', 'teal', 'Training'),
  ('time-v', 'V', 'Vacation', 'lime', 'Leave')
on conflict (id) do update
set
  code = excluded.code,
  label = excluded.label,
  color_token = excluded.color_token,
  category = excluded.category;
