alter table public.manual_overtime_postings
add column if not exists slot_count integer not null default 1;

alter table public.manual_overtime_postings
drop constraint if exists manual_overtime_postings_slot_count_check;

alter table public.manual_overtime_postings
add constraint manual_overtime_postings_slot_count_check
check (slot_count >= 1);
