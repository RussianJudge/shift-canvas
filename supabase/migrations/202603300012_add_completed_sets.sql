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

create index if not exists completed_sets_schedule_month_idx
on completed_sets (schedule_id, month_key, start_date);

alter table completed_sets enable row level security;

drop policy if exists "authenticated manage completed sets" on completed_sets;

create policy "authenticated manage completed sets"
on completed_sets
for all
to authenticated
using (true)
with check (true);
