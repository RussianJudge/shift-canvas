alter table public.sub_schedule_assignments
add column if not exists time_code_id text references public.time_codes(id) on delete set null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'sub_schedule_assignments_single_code_check'
      and conrelid = 'public.sub_schedule_assignments'::regclass
  ) then
    alter table public.sub_schedule_assignments
    add constraint sub_schedule_assignments_single_code_check
    check (num_nonnulls(competency_id, time_code_id) <= 1);
  end if;
end;
$$;
