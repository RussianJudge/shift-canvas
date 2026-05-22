alter table public.mutual_shift_postings
add column if not exists owner_leader_approved_at timestamptz,
add column if not exists owner_leader_approved_by_employee_id text references public.employees(id) on delete set null,
add column if not exists owner_leader_approved_by_name text,
add column if not exists applicant_leader_approved_at timestamptz,
add column if not exists applicant_leader_approved_by_employee_id text references public.employees(id) on delete set null,
add column if not exists applicant_leader_approved_by_name text;

do $$
begin
  if exists (
    select 1
    from pg_constraint
    where conname = 'mutual_shift_postings_status_check'
      and conrelid = 'public.mutual_shift_postings'::regclass
  ) then
    alter table public.mutual_shift_postings
    drop constraint mutual_shift_postings_status_check;
  end if;
end;
$$;

alter table public.mutual_shift_postings
add constraint mutual_shift_postings_status_check
check (status in ('open', 'pending_leader_approval', 'accepted', 'withdrawn', 'cancelled', 'rejected'));
