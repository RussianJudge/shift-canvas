-- Everything written before email existed is stamped as handled.
--
-- The outbox treats a null emailed_at as an email owed, so without this the
-- first save after deploying would mail people about overtime they were told
-- about days or weeks ago, arriving as one unexplained burst.
--
-- Separate from the migration that added the column because that one was
-- already applied; migrations are additive files and an applied one is never
-- edited.
update public.notifications
set emailed_at = now()
where emailed_at is null;
