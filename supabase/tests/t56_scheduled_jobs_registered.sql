-- t56: every scheduled job is actually registered with pg_cron.
--
-- The original schedules sat behind an "is pg_cron installed" guard that skipped
-- without an error, so production ran for months with no jobs at all. This pins
-- the extension, each job's cadence and command, and that each job is active.

BEGIN;
\i _helpers.psql
SELECT plan(6);

DO $$
BEGIN
  PERFORM tap_ok(
    EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron'),
    'pg_cron is installed'
  );
END;
$$;

DO $$
DECLARE
  v_expected RECORD;
BEGIN
  FOR v_expected IN
    SELECT * FROM (VALUES
      ('cleanup-stale-trusted-browsers', '0 3 * * *',    'SELECT cleanup_stale_trusted_browsers()'),
      ('streak-reminder-cron',           '*/15 * * * *', 'SELECT streak_reminder_cron_dispatch()'),
      ('subscription-tier-expiry',       '17 3 * * *',   'SELECT expire_lapsed_subscription_tiers()'),
      ('account-deletion-completion',    '23 4 * * *',   'SELECT complete_pending_account_deletions()'),
      ('operational-health-cron',        '*/30 * * * *', 'SELECT operational_health_cron_dispatch()')
    ) AS t(jobname, schedule, command)
  LOOP
    PERFORM tap_ok(
      EXISTS (
        SELECT 1
        FROM cron.job j
        WHERE j.jobname = v_expected.jobname
          AND j.schedule = v_expected.schedule
          AND j.command = v_expected.command
          AND j.active
      ),
      v_expected.jobname || ' is scheduled and active'
    );
  END LOOP;
END;
$$;

SELECT * FROM tap_emit();
SELECT * FROM finish();
ROLLBACK;
