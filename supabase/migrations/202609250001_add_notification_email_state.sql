-- When a notification's email actually went out.
--
-- Null means "still owed an email", which makes the table its own small outbox:
-- Resend's daily allowance is finite, so a burst sends what it can now and the
-- next save picks up the rest, instead of the overflow being dropped.
alter table public.notifications
  add column if not exists emailed_at timestamptz;

create index if not exists notifications_email_pending_idx
on public.notifications (emailed_at, dismissed_at, resolved_at, created_at)
where emailed_at is null;
