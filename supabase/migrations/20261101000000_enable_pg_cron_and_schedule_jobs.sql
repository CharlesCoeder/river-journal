-- Migration: install pg_cron and register every scheduled job.
--
-- Earlier migrations each scheduled their job inside a guard of the form
-- `IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron')`, on the
-- assumption that the extension was already enabled on hosted projects. It is
-- available there but not enabled by default, and nothing ever enabled it, so
-- every one of those blocks was skipped without an error and no job was ever
-- registered. Those migrations are already applied and will not run again, so
-- the schedules are registered here.
--
-- This migration is deliberately NOT guarded: if pg_cron cannot be installed or
-- a job cannot be scheduled, the migration fails and the deploy says so, rather
-- than leaving the scheduled work silently absent.
--
-- cron.schedule(name, ...) upserts by job name, so this is safe if a job already
-- exists. Names, cadences and commands match the original migrations.
--
-- Registering a dispatcher here does not by itself deliver anything:
-- streak_reminder_cron_dispatch and operational_health_cron_dispatch return
-- early until the `edge_base_url` and `service_role_key` Vault secrets are set.

CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;

GRANT USAGE ON SCHEMA cron TO postgres;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA cron TO postgres;

SELECT cron.schedule(
  'cleanup-stale-trusted-browsers',
  '0 3 * * *',
  'SELECT cleanup_stale_trusted_browsers()'
);

SELECT cron.schedule(
  'streak-reminder-cron',
  '*/15 * * * *',
  'SELECT streak_reminder_cron_dispatch()'
);

SELECT cron.schedule(
  'subscription-tier-expiry',
  '17 3 * * *',
  'SELECT expire_lapsed_subscription_tiers()'
);

SELECT cron.schedule(
  'account-deletion-completion',
  '23 4 * * *',
  'SELECT complete_pending_account_deletions()'
);

SELECT cron.schedule(
  'operational-health-cron',
  '*/30 * * * *',
  'SELECT operational_health_cron_dispatch()'
);
