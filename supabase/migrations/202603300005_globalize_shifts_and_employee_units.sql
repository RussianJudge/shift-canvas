alter table employees add column if not exists unit_id text;

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'schedules'
      and column_name = 'unit_id'
  ) then
    update employees e
    set unit_id = s.unit_id
    from schedules s
    where e.schedule_id = s.id
      and e.unit_id is null;
  end if;
end
$$;

update employees e
set unit_id = c.unit_id
from employee_competencies ec
join competencies c on c.id = ec.competency_id
where e.id = ec.employee_id
  and e.unit_id is null;

update employees e
set unit_id = fallback.id
from (
  select id
  from production_units
  order by id
  limit 1
) fallback
where e.unit_id is null;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'employees_unit_id_fkey'
  ) then
    alter table employees
    add constraint employees_unit_id_fkey
    foreign key (unit_id) references production_units (id) on delete cascade;
  end if;
end
$$;

create index if not exists employees_unit_id_idx on employees (unit_id);

alter table employees alter column unit_id set not null;

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'schedules'
      and column_name = 'unit_id'
  ) then
    drop index if exists schedules_unit_id_idx;
    alter table schedules drop column unit_id;
  end if;
end
$$;

insert into schedules (id, name, start_date, day_shift_days, night_shift_days, off_days)
values
  ('schedule-601', '601', '2026-01-01', 3, 3, 6),
  ('schedule-602', '602', '2026-01-04', 3, 3, 6),
  ('schedule-603', '603', '2026-01-07', 3, 3, 6),
  ('schedule-604', '604', '2026-01-10', 3, 3, 6)
on conflict (id) do update
set
  name = excluded.name,
  start_date = excluded.start_date,
  day_shift_days = excluded.day_shift_days,
  night_shift_days = excluded.night_shift_days,
  off_days = excluded.off_days;

update employees e
set schedule_id = concat(
  'schedule-',
  coalesce(
    substring(e.schedule_id from '(601|602|603|604)'),
    substring(s.name from '(601|602|603|604)'),
    '601'
  )
)
from schedules s
where s.id = e.schedule_id;

delete from schedules
where id not in ('schedule-601', 'schedule-602', 'schedule-603', 'schedule-604');
