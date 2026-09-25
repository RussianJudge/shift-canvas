-- Two ways a notification stops being shown, kept apart on purpose.
--
-- resolved_at is the system's: the overtime it announced is no longer open, so
-- the row is hidden rather than deleted, which keeps the id that marks the
-- announcement as already made. If the same overtime opens again the row is
-- shown again without a second email.
--
-- dismissed_at is the reader's, and outranks resolved_at: something they
-- cleared stays cleared even if the underlying overtime reopens.
alter table public.notifications
  add column if not exists resolved_at timestamptz,
  add column if not exists dismissed_at timestamptz;

create index if not exists notifications_recipient_visible_idx
on public.notifications (recipient_employee_id, dismissed_at, resolved_at, created_at desc);
