alter table public.schedule_assignments
add column if not exists schedule_id text references public.schedules(id) on delete cascade;

update public.schedule_assignments as schedule_assignments
set schedule_id = employees.schedule_id
from public.employees as employees
where employees.id = schedule_assignments.employee_id
  and schedule_assignments.schedule_id is null;

update public.schedule_assignments as schedule_assignments
set schedule_id = overtime_claims.schedule_id
from public.overtime_claims as overtime_claims
where schedule_assignments.assignment_date = overtime_claims.assignment_date
  and schedule_assignments.company_id = overtime_claims.company_id
  and schedule_assignments.site_id = overtime_claims.site_id
  and schedule_assignments.business_area_id = overtime_claims.business_area_id
  and schedule_assignments.notes like ('OT|claimant:' || overtime_claims.employee_id || '|claim:' || overtime_claims.competency_id || '%');

update public.schedule_assignments
set schedule_id = nullif(split_part(split_part(notes, 'target:', 2), '|', 1), '')
where notes like 'MUT|posting:%|target:%'
  and (
    schedule_id is null
    or schedule_id <> nullif(split_part(split_part(notes, 'target:', 2), '|', 1), '')
  );

create index if not exists assignments_schedule_date_idx
on public.schedule_assignments (schedule_id, assignment_date, employee_id);
