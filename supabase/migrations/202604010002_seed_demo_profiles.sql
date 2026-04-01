with schedule_lookup as (
  select id, name
  from public.schedules
  order by name
),
worker_employee as (
  select id, full_name, schedule_id
  from public.employees
  where is_active = true
  order by full_name
  limit 1
),
demo_auth_users as (
  select id, email
  from auth.users
  where email in (
    'admin@shiftcanvas.demo',
    'leader@shiftcanvas.demo',
    'worker@shiftcanvas.demo'
  )
)
insert into public.profiles (
  id,
  email,
  display_name,
  role,
  schedule_id,
  employee_id
)
select
  u.id,
  u.email,
  case
    when u.email = 'admin@shiftcanvas.demo' then 'Morgan Admin'
    when u.email = 'leader@shiftcanvas.demo' then 'Jordan Leader'
    when u.email = 'worker@shiftcanvas.demo' then coalesce((select full_name from worker_employee), 'Demo Worker')
    else split_part(u.email, '@', 1)
  end as display_name,
  case
    when u.email = 'admin@shiftcanvas.demo' then 'admin'
    when u.email = 'leader@shiftcanvas.demo' then 'leader'
    else 'worker'
  end as role,
  case
    when u.email = 'worker@shiftcanvas.demo' then (select schedule_id from worker_employee)
    else null
  end as schedule_id,
  case
    when u.email = 'worker@shiftcanvas.demo' then (select id from worker_employee)
    else null
  end as employee_id
from demo_auth_users u
on conflict (id) do update
set
  email = excluded.email,
  display_name = excluded.display_name,
  role = excluded.role,
  schedule_id = excluded.schedule_id,
  employee_id = excluded.employee_id,
  updated_at = now();
