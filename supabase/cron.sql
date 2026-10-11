-- ============================================================
-- Scratch & Save — run the payday reminders every hour.
-- Before running: replace the two values marked CHANGE ME below.
-- Paste into Supabase → SQL Editor → New query → Run.
-- ============================================================

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Remove an older copy of this job if you're re-running the file.
select cron.unschedule('payday-reminders')
where exists (select 1 from cron.job where jobname = 'payday-reminders');

select cron.schedule(
  'payday-reminders',
  '0 * * * *',  -- at the top of every hour
  $$
  select net.http_post(
    url     := 'https://YOUR-PROJECT-REF.supabase.co/functions/v1/payday-reminders',  -- CHANGE ME
    headers := jsonb_build_object(
      'content-type', 'application/json',
      'x-cron-secret', 'YOUR-CRON-SECRET'                                         -- CHANGE ME
    ),
    body    := '{}'::jsonb
  );
  $$
);

-- To check it's running later:
--   select * from cron.job_run_details order by start_time desc limit 10;
