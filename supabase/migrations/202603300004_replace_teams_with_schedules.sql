do $$
begin
  if to_regclass('public.teams') is null then
    return;
  end if;

  if to_regclass('public.schedules') is null then
    create table schedules (
      id text primary key,
      unit_id text not null references production_units (id) on delete cascade,
      name text not null,
      start_date date not null,
      day_shift_days integer not null check (day_shift_days >= 0),
      night_shift_days integer not null check (night_shift_days >= 0),
      off_days integer not null check (off_days >= 0),
      created_at timestamptz not null default now()
    );
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'schedules'
      and column_name = 'unit_id'
  ) then
    create index if not exists schedules_unit_id_idx on schedules (unit_id);
  end if;

  alter table schedules enable row level security;

  drop policy if exists "authenticated read schedules" on schedules;

  create policy "authenticated read schedules"
  on schedules
  for select
  to authenticated
  using (true);

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'schedules'
      and column_name = 'unit_id'
  ) then
    insert into schedules (id, unit_id, name, start_date, day_shift_days, night_shift_days, off_days)
    select distinct
      concat('schedule-', replace(t.unit_id, 'unit-', ''), '-', e.schedule_code) as id,
      t.unit_id,
      concat(
        upper(left(replace(t.unit_id, 'unit-', ''), 1)),
        substring(replace(t.unit_id, 'unit-', '') from 2),
        ' ',
        e.schedule_code
      ) as name,
      (date '2026-01-01' + case e.schedule_code when '601' then 0 when '602' then 3 when '603' then 6 when '604' then 9 else 0 end),
      3,
      3,
      6
    from employees e
    join teams t on t.id = e.team_id
    where e.schedule_code is not null
    on conflict (id) do nothing;
  end if;

  alter table employees add column if not exists schedule_id text;

  update employees e
  set schedule_id = concat('schedule-', replace(t.unit_id, 'unit-', ''), '-', e.schedule_code)
  from teams t
  where e.team_id = t.id
    and (e.schedule_id is null or e.schedule_id = '');

  if not exists (
    select 1 from pg_constraint where conname = 'employees_schedule_id_fkey'
  ) then
    alter table employees
    add constraint employees_schedule_id_fkey
    foreign key (schedule_id) references schedules (id) on delete cascade;
  end if;

  create index if not exists employees_schedule_active_idx on employees (schedule_id) where is_active = true;

  alter table employees drop column if exists team_id cascade;
  alter table employees drop column if exists schedule_code cascade;
  alter table employees drop column if exists rotation_anchor cascade;

  drop table if exists teams cascade;
end
$$;
