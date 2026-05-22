alter table public.schedules
add column if not exists is_active boolean not null default true;

update public.schedules
set is_active = true
where is_active is distinct from true;
