create table if not exists production_units (
  id text primary key,
  name text not null,
  description text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists teams (
  id text primary key,
  unit_id text not null references production_units (id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now()
);

create table if not exists competencies (
  id text primary key,
  unit_id text not null references production_units (id) on delete cascade,
  code text not null,
  label text not null,
  color_token text not null default 'slate',
  created_at timestamptz not null default now(),
  unique (unit_id, code)
);

create table if not exists employees (
  id text primary key,
  team_id text not null references teams (id) on delete cascade,
  full_name text not null,
  role_title text not null default 'Operator',
  schedule_code text not null check (schedule_code in ('601', '602', '603', '604')),
  rotation_anchor integer not null default 0,
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
  shift_kind text not null check (shift_kind in ('DAY', 'NIGHT', 'OFF')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (employee_id, assignment_date)
);

create index if not exists teams_unit_id_idx on teams (unit_id);
create index if not exists competencies_unit_code_idx on competencies (unit_id, code);
create index if not exists employees_team_active_idx on employees (team_id) where is_active = true;
create index if not exists assignments_date_employee_idx on schedule_assignments (assignment_date, employee_id);

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
alter table teams enable row level security;
alter table competencies enable row level security;
alter table employees enable row level security;
alter table employee_competencies enable row level security;
alter table schedule_assignments enable row level security;

create policy "authenticated read production units"
on production_units
for select
to authenticated
using (true);

create policy "authenticated read teams"
on teams
for select
to authenticated
using (true);

create policy "authenticated read competencies"
on competencies
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
