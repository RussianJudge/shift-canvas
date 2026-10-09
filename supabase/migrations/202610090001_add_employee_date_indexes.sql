-- The hottest read in the application is "these employees, this date range":
-- the snapshot loader filters schedule_assignments by employee_id IN (...) with
-- a date window, deliberately without the scope columns. The only index that
-- could serve it is assignments_date_employee_idx, which leads with
-- assignment_date — the columns the wrong way round for this shape, so Postgres
-- range-scans the window across every tenant in the table and then filters.
--
-- overtime_claims has no index leading with employee_id at all, though three
-- reads need one: a worker's own future claims, the stale-claim sweep, and the
-- competency-removal impact check.
--
-- Both are additive. The existing date-leading indexes stay, because the reads
-- that filter on a date range alone still use them.
create index if not exists assignments_employee_date_idx
  on public.schedule_assignments (employee_id, assignment_date);

create index if not exists overtime_claims_employee_date_idx
  on public.overtime_claims (employee_id, assignment_date);
