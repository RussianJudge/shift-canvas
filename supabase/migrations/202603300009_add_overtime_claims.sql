create table if not exists overtime_claims (
  id text primary key,
  schedule_id text not null references schedules (id) on delete cascade,
  employee_id text not null references employees (id) on delete cascade,
  competency_id text not null references competencies (id) on delete cascade,
  assignment_date date not null,
  created_at timestamptz not null default now(),
  unique (schedule_id, employee_id, assignment_date)
);

create index if not exists overtime_claims_schedule_date_idx on overtime_claims (schedule_id, assignment_date);

alter table overtime_claims enable row level security;

drop policy if exists "authenticated manage overtime claims" on overtime_claims;

create policy "authenticated manage overtime claims"
on overtime_claims
for all
to authenticated
using (true)
with check (true);
