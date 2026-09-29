-- The backfill stamped every pre-existing notification with now(), and the
-- daily send budget counts rows stamped since midnight. On the day it ran,
-- hundreds of historical rows therefore read as emails already sent, the
-- budget was exhausted before a single real one went out, and the flush
-- returned early — sending nothing and stamping nothing.
--
-- For those rows "handled" means when they were written, not when the backfill
-- happened to run.
--
-- A send stamps at most one run's worth of rows at an instant, so a timestamp
-- shared by more than that many rows cannot be a send. 40 is the per-run cap in
-- app/actions.ts; the threshold here is deliberately above it so a full run is
-- never mistaken for a bulk write.
update public.notifications
set emailed_at = created_at
where emailed_at in (
  select emailed_at
  from public.notifications
  where emailed_at is not null
  group by emailed_at
  having count(*) > 50
);
