alter table public.time_codes
add column if not exists work_status text not null default 'working'
check (work_status in ('working', 'off'));

update public.time_codes
set work_status = case
  when upper(code) in ('V', 'TR', 'SB', 'OFF', 'ILL') then 'off'
  else 'working'
end;
