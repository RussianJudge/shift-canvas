create table if not exists public.user_schedule_pins (
  user_id uuid not null references public.profiles (id) on delete cascade,
  schedule_id text not null references public.schedules (id) on delete cascade,
  employee_id text not null references public.employees (id) on delete cascade,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, schedule_id, employee_id)
);

create index if not exists user_schedule_pins_user_schedule_idx
  on public.user_schedule_pins (user_id, schedule_id, sort_order);

drop trigger if exists user_schedule_pins_updated_at on public.user_schedule_pins;

create trigger user_schedule_pins_updated_at
before update on public.user_schedule_pins
for each row execute function public.set_current_timestamp_updated_at();

alter table public.user_schedule_pins enable row level security;

drop policy if exists "users manage own schedule pins" on public.user_schedule_pins;

create policy "users manage own schedule pins"
on public.user_schedule_pins
for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);
