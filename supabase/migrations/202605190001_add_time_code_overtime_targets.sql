alter table public.manual_overtime_postings
add column if not exists time_code_id text references public.time_codes(id) on delete set null;

alter table public.manual_overtime_postings
alter column competency_id drop not null;

alter table public.manual_overtime_postings
drop constraint if exists manual_overtime_postings_assignment_check;

alter table public.manual_overtime_postings
add constraint manual_overtime_postings_assignment_check
check (num_nonnulls(competency_id, time_code_id) = 1);

create index if not exists manual_overtime_postings_time_code_idx
on public.manual_overtime_postings (time_code_id)
where time_code_id is not null;

alter table public.overtime_claims
add column if not exists time_code_id text references public.time_codes(id) on delete set null;

alter table public.overtime_claims
alter column competency_id drop not null;

alter table public.overtime_claims
drop constraint if exists overtime_claims_assignment_check;

alter table public.overtime_claims
add constraint overtime_claims_assignment_check
check (num_nonnulls(competency_id, time_code_id) = 1);

create index if not exists overtime_claims_time_code_idx
on public.overtime_claims (time_code_id)
where time_code_id is not null;
