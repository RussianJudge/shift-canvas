create table if not exists production_units (
  id text primary key,
  name text not null,
  description text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists schedules (
  id text primary key,
  name text not null,
  start_date date not null,
  day_shift_days integer not null check (day_shift_days >= 0),
  night_shift_days integer not null check (night_shift_days >= 0),
  off_days integer not null check (off_days >= 0),
  created_at timestamptz not null default now()
);

create table if not exists competencies (
  id text primary key,
  code text not null,
  label text not null,
  color_token text not null default 'slate',
  required_staff integer not null default 1,
  created_at timestamptz not null default now(),
  unique (code)
);

create table if not exists time_codes (
  id text primary key,
  code text not null,
  label text not null,
  color_token text not null default 'slate',
  created_at timestamptz not null default now(),
  unique (code)
);

create table if not exists employees (
  id text primary key,
  schedule_id text not null references schedules (id) on delete cascade,
  unit_id text not null references production_units (id) on delete cascade,
  full_name text not null,
  role_title text not null default 'Operator',
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists employee_competencies (
  employee_id text not null references employees (id) on delete cascade,
  competency_id text not null references competencies (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (employee_id, competency_id)
);

create table if not exists schedule_assignments (
  id bigint generated always as identity primary key,
  employee_id text not null references employees (id) on delete cascade,
  assignment_date date not null,
  competency_id text references competencies (id) on delete set null,
  time_code_id text references time_codes (id) on delete set null,
  shift_kind text not null check (shift_kind in ('DAY', 'NIGHT', 'OFF')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (num_nonnulls(competency_id, time_code_id) <= 1),
  unique (employee_id, assignment_date)
);

create table if not exists overtime_claims (
  id text primary key,
  schedule_id text not null references schedules (id) on delete cascade,
  employee_id text not null references employees (id) on delete cascade,
  competency_id text not null references competencies (id) on delete cascade,
  assignment_date date not null,
  created_at timestamptz not null default now(),
  unique (schedule_id, employee_id, assignment_date)
);

create table if not exists completed_sets (
  id bigint generated always as identity primary key,
  schedule_id text not null references schedules (id) on delete cascade,
  month_key text not null,
  start_date date not null,
  end_date date not null,
  created_at timestamptz not null default now(),
  check (start_date <= end_date),
  unique (schedule_id, month_key, start_date, end_date)
);

create index if not exists competencies_code_idx on competencies (code);
create index if not exists time_codes_code_idx on time_codes (code);
create index if not exists employees_schedule_active_idx on employees (schedule_id) where is_active = true;
create index if not exists employees_unit_id_idx on employees (unit_id);
create index if not exists assignments_date_employee_idx on schedule_assignments (assignment_date, employee_id);
create index if not exists overtime_claims_schedule_date_idx on overtime_claims (schedule_id, assignment_date);
create index if not exists completed_sets_schedule_month_idx on completed_sets (schedule_id, month_key, start_date);

create or replace function update_schedule_assignment_timestamp()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists schedule_assignments_updated_at on schedule_assignments;

create trigger schedule_assignments_updated_at
before update on schedule_assignments
for each row
execute function update_schedule_assignment_timestamp();

alter table production_units enable row level security;
alter table schedules enable row level security;
alter table competencies enable row level security;
alter table time_codes enable row level security;
alter table employees enable row level security;
alter table employee_competencies enable row level security;
alter table schedule_assignments enable row level security;
alter table overtime_claims enable row level security;
alter table completed_sets enable row level security;

create policy "authenticated read production units"
on production_units
for select
to authenticated
using (true);

create policy "authenticated read schedules"
on schedules
for select
to authenticated
using (true);

create policy "authenticated read competencies"
on competencies
for select
to authenticated
using (true);

create policy "authenticated read time codes"
on time_codes
for select
to authenticated
using (true);

create policy "authenticated read employees"
on employees
for select
to authenticated
using (is_active = true);

create policy "authenticated read employee competencies"
on employee_competencies
for select
to authenticated
using (true);

create policy "authenticated manage schedule assignments"
on schedule_assignments
for all
to authenticated
using (true)
with check (true);

create policy "authenticated manage overtime claims"
on overtime_claims
for all
to authenticated
using (true)
with check (true);

create policy "authenticated manage completed sets"
on completed_sets
for all
to authenticated
using (true)
with check (true);
