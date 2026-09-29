-- Email becomes opt-in rather than opt-out.
--
-- Absence meant "send", so every eligible worker was emailed by default —
-- hundreds of messages a week against an allowance of a hundred a day, most of
-- them to a domain that files them as junk. A row now means somebody asked for
-- email, and nobody is emailed until they do.
--
-- A rename rather than a new table: it is empty, so no preference is lost, and
-- the old name would describe the opposite of what the rows now mean.
alter table if exists public.notification_email_optouts
  rename to notification_email_subscriptions;

alter index if exists notification_email_optouts_pkey
  rename to notification_email_subscriptions_pkey;
