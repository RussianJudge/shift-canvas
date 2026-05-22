alter table public.schedule_assignments
add column if not exists schedule_id text references public.schedules(id) on delete cascade;

update public.schedule_assignments as assignment
set schedule_id = employees.schedule_id
from public.employees as employees
where assignment.employee_id = employees.id
  and assignment.schedule_id is null;

update public.schedule_assignments as assignment
set schedule_id = overtime_claims.schedule_id
from public.overtime_claims as overtime_claims
where assignment.assignment_date = overtime_claims.assignment_date
  and assignment.employee_id = overtime_claims.employee_id
  and assignment.notes like ('OT|claimant:' || overtime_claims.employee_id || '|claim:' || overtime_claims.competency_id || '%')
  and (
    assignment.schedule_id is null
    or assignment.schedule_id <> overtime_claims.schedule_id
  );

update public.schedule_assignments
set schedule_id = nullif(split_part(split_part(notes, 'target:', 2), '|', 1), '')
where notes like 'MUT|posting:%|target:%'
  and (
    schedule_id is null
    or schedule_id <> nullif(split_part(split_part(notes, 'target:', 2), '|', 1), '')
  );

alter table public.schedule_assignments
drop constraint if exists schedule_assignments_employee_id_assignment_date_key;

drop index if exists public.schedule_assignments_employee_id_assignment_date_key;

alter table public.schedule_assignments
alter column schedule_id set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'schedule_assignments_schedule_employee_date_key'
  ) then
    alter table public.schedule_assignments
    add constraint schedule_assignments_schedule_employee_date_key
    unique (schedule_id, employee_id, assignment_date);
  end if;
end
$$;

create index if not exists assignments_schedule_date_idx
on public.schedule_assignments (schedule_id, assignment_date, employee_id);
